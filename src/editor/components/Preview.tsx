/**
 * 全屏预览：与编辑器共用 createScreen 渲染同一份 schema 的克隆，
 * 等比缩放居中，Esc / 按钮退出。
 */

import { useEffect, useRef } from 'react'
import { createScreen, type ScreenHandle } from '../../core/renderer'
import { THEMES } from '../../core/themes'
import { clone } from '../utils/misc'
import { DESIGN_H, DESIGN_W } from '../utils/geometry'
import type { EditorCtrl } from '../App'

export default function Preview({ ctrl, onClose }: { ctrl: EditorCtrl; onClose(): void }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const exitRef = useRef<HTMLButtonElement>(null)
  const sceneRef = useRef<ScreenHandle | null>(null)

  useEffect(() => {
    if (!rootRef.current) return
    sceneRef.current = createScreen(rootRef.current, clone(ctrl.schemaRef.current), { themes: THEMES })
    const apply = () => {
      const k = Math.min(window.innerWidth / DESIGN_W, window.innerHeight / DESIGN_H)
      const w = wrapRef.current
      if (!w) return
      w.style.transform = `scale(${k})`
      w.style.left = Math.round((window.innerWidth - DESIGN_W * k) / 2) + 'px'
      w.style.top = Math.round((window.innerHeight - DESIGN_H * k) / 2) + 'px'
    }
    // resize 用 rAF 合并：拖动窗口时一帧只写一次 transform，不逐事件触发样式重算
    let raf = 0
    const fit = () => {
      if (raf) return
      raf = requestAnimationFrame(() => { raf = 0; apply() })
    }
    apply()
    window.addEventListener('resize', fit)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    exitRef.current?.focus() // 打开即把焦点交给退出按钮，键盘用户不会迷路
    return () => {
      sceneRef.current?.dispose()
      window.removeEventListener('resize', fit)
      window.removeEventListener('keydown', onKey)
      if (raf) cancelAnimationFrame(raf)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div id="previewLayer" role="dialog" aria-modal="true" aria-label="大屏全屏预览">
      <div id="previewWrap" ref={wrapRef}><div id="previewRoot" ref={rootRef} aria-hidden="true" /></div>
      <button id="exitPreview" ref={exitRef} onClick={onClose}>退出预览 · Esc</button>
    </div>
  )
}
