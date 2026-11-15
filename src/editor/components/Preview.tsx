/**
 * 全屏预览：与编辑器共用 createScreen 渲染同一份 schema 的克隆。
 *
 * 适配策略（与导出 HTML / 导出 Vue·React 完全一致，见 core/fit.ts）：
 *   ① 每个组件的外层盒子用百分比定位 —— 屏幕多宽多高，盒子就撑多宽多高，
 *      不裁切内容；整块内容四周留一圈固定留白（EDGE_GAP = 24px），不贴屏幕边；
 *   ② 盒子里的内容层按 k 等比缩放居中（k = min(盒宽/设计宽, 盒高/设计高)）——
 *      饼图/仪表盘/雷达图的圆永远是正圆，文字也不会被纵向拉长；
 *   ③ 背景画在预览层上（内容层透明），屏幕比例不同也不会露出黑边。
 */

import { useEffect, useRef } from 'react'
import { createScreen, type ScreenHandle } from '../../core/renderer'
import { THEMES } from '../../core/themes'
import { pageBackground } from '../../core/fit'
import { clone } from '../utils/misc'
import type { EditorCtrl } from '../App'

export default function Preview({ ctrl, onClose }: { ctrl: EditorCtrl; onClose(): void }) {
  const layerRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const exitRef = useRef<HTMLButtonElement>(null)
  const sceneRef = useRef<ScreenHandle | null>(null)

  useEffect(() => {
    if (!rootRef.current) return
    const snap = clone(ctrl.schemaRef.current)
    // fill:true —— 盒子百分比铺满视口；paintBackground:false —— 背景由预览层承担
    sceneRef.current = createScreen(rootRef.current, snap, {
      themes: THEMES,
      fill: true,
      paintBackground: false,
    })

    const layer = layerRef.current
    if (layer) {
      layer.style.background = pageBackground(snap, THEMES[snap.page.theme] || THEMES.custom)
      // background 简写会重置 size/position/repeat，必须随后单独设一次
      layer.style.backgroundSize = 'cover'
      layer.style.backgroundPosition = 'center'
      layer.style.backgroundRepeat = 'no-repeat'
    }

    // resize 用 rAF 合并：拖动窗口时一帧只重排一次
    let raf = 0
    const onResize = () => {
      if (raf) return
      raf = requestAnimationFrame(() => { raf = 0; sceneRef.current?.resize() })
    }
    window.addEventListener('resize', onResize)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    exitRef.current?.focus() // 打开即把焦点交给退出按钮，键盘用户不会迷路
    return () => {
      sceneRef.current?.dispose()
      window.removeEventListener('resize', onResize)
      window.removeEventListener('keydown', onKey)
      if (raf) cancelAnimationFrame(raf)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div id="previewLayer" ref={layerRef} role="dialog" aria-modal="true" aria-label="大屏全屏预览">
      <div id="previewRoot" ref={rootRef} aria-hidden="true" />
      <span id="previewFitHint" title="卡片按屏幕百分比铺满，卡片内容保持原比例（圆不会变形）">
        铺满屏幕 · 内容等比
      </span>
      <button id="exitPreview" ref={exitRef} onClick={onClose}>退出预览 · Esc</button>
    </div>
  )
}
