/**
 * 画布舞台：16:9 letterbox 缩放 + 命令式渲染器挂载 + 指针交互（选中/拖拽/缩放/吸附）
 *
 * 坐标换算要点（原型踩过的坑）：
 *   画布被 transform:scale(k) 缩放，因此屏幕位移 ÷ k 才是设计稿位移；
 *   否则放大后拖拽距离会成倍放大。
 * 吸附（两者共用一套候选线与校准线绘制）：
 *   移动吸附 snapMove —— 被拖组件的起边/中心/止边与其它组件、画布的边和中心线
 *     靠近时自动吸附，因此上下左右四面都能贴；
 *   缩放吸附 snapResize —— 被拖动的边与上述候选线靠近时吸附。
 *   容差都按 scale 反算（8/scale），保证屏幕上手感恒定；按住 Alt 可临时关闭移动吸附。
 */

import { useEffect, useRef, useState } from 'react'
import { createScreen } from '../../core/renderer'
import type { ScreenHandle } from '../../core/schema'
import type { ComponentItem, Guide } from '../../core/schema'
import type { EditorCtrl } from '../App'
import { clone } from '../utils/misc'
import {
  CUR, DESIGN_H, DESIGN_W, HANDLES,
  handleAt, hitTest, resizeRect, snapMove, snapResize, type HandleKey,
} from '../utils/geometry'

interface DragState {
  id: string
  mode: 'move' | 'resize'
  handle: HandleKey | null
  /** 起点设计稿坐标 */
  sx: number
  sy: number
  orig: { x: number; y: number; w: number; h: number }
  moved: boolean
  pid: number
}

/** 两组校准线是否等价（顺序无关）：用于避免拖拽时每帧都触发 overlay 重渲染 */
function sameGuides(a: Guide[], b: Guide[]): boolean {
  if (a.length !== b.length) return false
  return a.every((g) => b.some((n) => n.axis === g.axis && n.pos === g.pos))
}

export default function CanvasStage({ ctrl }: { ctrl: EditorCtrl }) {
  const stageRef = useRef<HTMLDivElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const [scale, setScale] = useState(1)
  const [guides, setGuides] = useState<Guide[]>([])
  /** 校准线更新：内容没变就复用旧引用，React 会自动跳过这次重渲染 */
  const applyGuides = (next: Guide[]) => setGuides((prev) => (sameGuides(prev, next) ? prev : next))
  const sel = ctrl.schemaRef.current.components.find((c) => c.id === ctrl.selId) || null

  /* ---- 渲染器挂载（只跑一次；schema 同步由 App 的 ver effect 负责） ---- */
  useEffect(() => {
    if (!rootRef.current) return
    ctrl.sceneRef.current = createScreen(rootRef.current, clone(ctrl.schemaRef.current))
    return () => {
      ctrl.sceneRef.current?.dispose()
      ctrl.sceneRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---- 16:9 letterbox：画布适配舞台 ----
   * 用 ResizeObserver 观察舞台盒子本身，而不是监听 window.resize：
   *   1) 侧栏随媒体查询变窄（窗口没变、盒子变了）也能立即重算，之前会漏；
   *   2) 回调只读一次 getBoundingClientRect，再用 rAF 合并 —— 拖动窗口时
   *      一帧最多算一次 setScale，不会每个 resize 事件都触发一次重渲染。
   */
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    let raf = 0
    const fit = () => {
      const r = el.getBoundingClientRect()
      const k = Math.max(0.12, Math.min((r.width - 60) / DESIGN_W, (r.height - 60) / DESIGN_H))
      setScale(k)
    }
    const schedule = () => {
      if (raf) return
      raf = requestAnimationFrame(() => { raf = 0; fit() })
    }
    fit() // 首帧同步算一次，避免以 scale=1 闪一下
    const ro = new ResizeObserver(schedule)
    ro.observe(el)
    return () => {
      ro.disconnect()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  /** 屏幕 → 设计稿坐标 */
  const toDesign = (e: { clientX: number; clientY: number }) => {
    const r = wrapRef.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale }
  }

  /* ---- 指针按下：命中手柄 → 缩放；命中组件 → 选中并拖拽；空白 → 取消选中 ---- */
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    const p = toDesign(e)
    const cur = sel
    const h = cur && !cur.locked ? handleAt(cur, p, scale) : null
    if (h && cur) {
      dragRef.current = { id: cur.id, mode: 'resize', handle: h, sx: p.x, sy: p.y, orig: { ...cur.rect }, moved: false, pid: e.pointerId }
      wrapRef.current?.setPointerCapture(e.pointerId)
      return
    }
    const hit = hitTest(ctrl.schemaRef.current.components, p)
    if (!hit) { ctrl.select(null); return }
    if (hit.id !== ctrl.selId) ctrl.select(hit.id)
    dragRef.current = { id: hit.id, mode: 'move', handle: null, sx: p.x, sy: p.y, orig: { ...hit.rect }, moved: false, pid: e.pointerId }
    wrapRef.current?.setPointerCapture(e.pointerId)
  }

  /* ---- 拖拽中：移动吸附 / 缩放吸附，走轻量 updateLayout ---- */
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current
      if (!drag || e.pointerId !== drag.pid) return
      const c = ctrl.schemaRef.current.components.find((x) => x.id === drag.id)
      if (!c) return
      const p = toDesign(e)
      const dx = p.x - drag.sx
      const dy = p.y - drag.sy
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) drag.moved = true

      // 容差按 scale 反算：设计稿 8px 在缩放到 40% 时屏幕上只有 3px，会「吸不住」；
      // 除以 scale 后屏幕上的手感恒定。按住 Alt 临时关闭吸附（T=0 即只做画布约束）。
      const T = e.altKey ? 0 : 8 / scale

      if (drag.mode === 'move') {
        const res = snapMove(ctrl.schemaRef.current.components, c.id, c.rect.w, c.rect.h, drag.orig.x + dx, drag.orig.y + dy, T)
        c.rect = { ...c.rect, x: res.x, y: res.y }
        applyGuides(res.guides)
      } else {
        const base = resizeRect(drag.orig, drag.handle!, dx, dy)
        const res = snapResize(ctrl.schemaRef.current.components, c.id, drag.handle!, drag.orig, base, 7 / scale)
        c.rect = res.rect
        applyGuides(res.guides)
      }
      ctrl.bump('layout')
    }
    const onUp = (e: PointerEvent) => {
      const drag = dragRef.current
      if (!drag || e.pointerId !== drag.pid) return
      try { wrapRef.current?.releasePointerCapture(drag.pid) } catch { /* 已释放 */ }
      const moved = drag.moved
      dragRef.current = null
      setGuides([])
      if (moved) { ctrl.pushHistory(); ctrl.bump('full') }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  })

  /* ---- 物料拖放 ---- */
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const type = e.dataTransfer.getData('text/plain')
    if (type) ctrl.addMaterial(type, toDesign(e))
  }

  /* ---- 画布空点：打开页面设置（取消选中） ---- */
  const stageClick = (e: React.MouseEvent) => {
    if (e.target === stageRef.current) ctrl.select(null)
  }

  /* ---- 覆盖层 JSX：选框 + 手柄 + 校准线 + 尺寸角标 ---- */
  const hs = 9 / scale
  const overlay: JSX.Element[] = []
  if (sel && !sel.hidden) {
    const r = sel.rect
    overlay.push(
      <div key="box" style={{ position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h, border: '1.5px solid #4C8DFF', pointerEvents: 'none' }} />,
    )
    if (!sel.locked) {
      HANDLES.forEach((h, i) => {
        overlay.push(
          <div key={'h' + i} style={{
            position: 'absolute', left: r.x + r.w * h.x - hs / 2, top: r.y + r.h * h.y - hs / 2,
            width: hs, height: hs, background: '#fff', border: '1.5px solid #4C8DFF', borderRadius: 1, pointerEvents: 'none',
          }} />,
        )
      })
    }
    overlay.push(
      <div key="badge" style={{
        position: 'absolute', left: r.x + 5, top: r.y + r.h - 15 / scale,
        font: `500 ${10 / scale}px/1 system-ui`, color: '#9DC0FF', whiteSpace: 'nowrap',
        pointerEvents: 'none', background: '#0B1524', padding: '2px 4px', borderRadius: 2,
      }}>
        {Math.round(r.w)} × {Math.round(r.h)}
      </div>,
    )
  }
  guides.forEach((g, i) => {
    overlay.push(
      g.axis === 'v'
        ? <div key={'g' + i} style={{ position: 'absolute', left: g.pos, top: 0, width: 1, height: DESIGN_H, background: '#FF4D7E', opacity: .85 }} />
        : <div key={'g' + i} style={{ position: 'absolute', top: g.pos, left: 0, height: 1, width: DESIGN_W, background: '#FF4D7E', opacity: .85 }} />,
    )
  })

  return (
    <section id="stage" ref={stageRef} onClick={stageClick}>
      <div
        id="wrap"
        ref={wrapRef}
        style={{ transform: `scale(${scale})`, left: `calc(50% - ${960 * scale}px)`, top: `calc(50% - ${540 * scale}px)` }}
        onPointerDown={onPointerDown}
        onPointerMove={(e) => {
          if (dragRef.current) return
          // 悬停光标提示
          const p = toDesign(e)
          const cur = sel && !sel.locked ? handleAt(sel, p, scale) : null
          wrapRef.current!.style.cursor = cur ? CUR[cur] : hitTest(ctrl.schemaRef.current.components, p) ? 'move' : 'default'
        }}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }}
        onDrop={onDrop}
      >
        <div id="screenRoot" ref={rootRef} />
        <div id="overlay">{overlay}</div>
      </div>
    </section>
  )
}
