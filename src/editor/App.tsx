/**
 * ============================================================
 * App —— 编辑器编排根组件
 * ============================================================
 * 状态架构：
 *   - schemaRef 是唯一数据源（可变引用 + version 计数触发重渲染）；
 *     选择 React 不可变更新的原因：渲染器 createScreen 是命令式的，
 *     拖拽中需要对同一份 schema 高频做 updateLayout，可变引用最直接；
 *   - historyRef 保存 JSON 快照（60 步撤销）；
 *   - 渲染模式 renderModeRef 区分全量/仅布局，拖拽时走轻量路径。
 */

import { useEffect, useRef, useState } from 'react'
import { createScreen, type ScreenHandle } from '../core/renderer'
import { INITIAL } from '../core/initial'
import { THEMES } from '../core/themes'
import { ALL_MATERIALS } from '../core/materials'
import type { ComponentItem, ScreenSchema } from '../core/schema'
import { clone, findComp, uid } from './utils/misc'
import { saltConfetti } from './utils/confetti'
import Topbar from './components/Topbar'
import Palette from './components/Palette'
import CanvasStage from './components/CanvasStage'
import Inspector from './components/Inspector'
import Preview from './components/Preview'

/** 物料速查表（addMaterial 用） */
const MATERIALS_MAP = Object.fromEntries(ALL_MATERIALS.map((m) => [m.type, m]))

export type RenderMode = 'full' | 'layout'

export interface EditorCtrl {
  schemaRef: React.MutableRefObject<ScreenSchema>
  sceneRef: React.MutableRefObject<ScreenHandle | null>
  selId: string | null
  select(id: string | null): void
  /** 触发一次重渲染；mode 决定走全量还是仅布局渲染 */
  bump(mode?: RenderMode): void
  renderModeRef: React.MutableRefObject<RenderMode>
  pushHistory(): void
  commit(): void
  undo(): void
  redo(): void
  canUndo(): boolean
  canRedo(): boolean
  setTheme(id: string): void
  addMaterial(type: string, at?: { x: number; y: number }): void
  layerAction(c: ComponentItem, act: string): void
  toast(msg: string): void
}

export default function App() {
  const schemaRef = useRef<ScreenSchema>(clone(INITIAL))
  const sceneRef = useRef<ScreenHandle | null>(null)
  const renderModeRef = useRef<RenderMode>('full')
  const historyRef = useRef<{ stack: string[]; idx: number }>({ stack: [], idx: -1 })
  const [ver, setVer] = useState(0)
  const [selId, setSelId] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [toastMsg, setToastMsg] = useState('')
  const toastTimer = useRef<number | null>(null)

  const bump = (mode: RenderMode = 'full') => {
    renderModeRef.current = mode
    setVer((v) => v + 1)
  }

  /* ---- 撤销 / 重做（JSON 快照） ---- */
  const pushHistory = () => {
    const h = historyRef.current
    h.stack = h.stack.slice(0, h.idx + 1)
    h.stack.push(JSON.stringify(schemaRef.current))
    if (h.stack.length > 60) h.stack.shift()
    h.idx = h.stack.length - 1
  }
  const jump = (idx: number) => {
    const h = historyRef.current
    h.idx = idx
    schemaRef.current = JSON.parse(h.stack[idx])
    if (selId && !findComp(schemaRef.current, selId)) setSelId(null)
    bump('full')
  }
  const undo = () => { if (historyRef.current.idx > 0) jump(historyRef.current.idx - 1) }
  const redo = () => {
    const h = historyRef.current
    if (h.idx < h.stack.length - 1) jump(h.idx + 1)
  }
  const canUndo = () => historyRef.current.idx > 0
  const canRedo = () => historyRef.current.idx < historyRef.current.stack.length - 1

  /* ---- schema 变化 → 渲染器同步 ---- */
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    if (renderModeRef.current === 'layout') scene.updateLayout(schemaRef.current)
    else scene.update(schemaRef.current)
  }, [ver])

  /* ---- 快捷键 ---- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase() || ''
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select'
      if (e.key === 'Escape') { setPreviewOpen(false); return }
      if (typing) return
      const c = findComp(schemaRef.current, selId)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        e.shiftKey ? redo() : undo()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault(); redo()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        if (c) ctrl.layerAction(c, 'dup')
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (c) { e.preventDefault(); ctrl.layerAction(c, 'del') }
      } else if (e.key.startsWith('Arrow') && c) {
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        if (e.key === 'ArrowLeft') c.rect.x -= step
        if (e.key === 'ArrowRight') c.rect.x += step
        if (e.key === 'ArrowUp') c.rect.y -= step
        if (e.key === 'ArrowDown') c.rect.y += step
        bump('layout')
        pushHistory()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /* ---- 编辑动作 ---- */

  const toast = (msg: string) => {
    setToastMsg(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToastMsg(''), 2600)
  }

  const commit = () => { pushHistory(); bump('full') }

  /** 换肤：撒盐特效 + 全量刷新 */
  const setTheme = (id: string) => {
    schemaRef.current.page.theme = id
    schemaRef.current.page.background = ''
    saltConfetti(THEMES[id].palette)
    pushHistory()
    bump('full')
  }

  /** 拖入 / 点击添加物料 */
  const addMaterial = (type: string, at?: { x: number; y: number }) => {
    const m = { ...MATERIALS_MAP[type] }
    if (!m) return
    const comps = schemaRef.current.components
    const maxZ = Math.max(0, ...comps.map((c) => c.z || 1))
    let x = at ? Math.round(at.x - m.w / 2) : 120
    let y = at ? Math.round(at.y - m.h / 2) : 160
    x = Math.max(0, Math.min(1920 - m.w, x))
    y = Math.max(0, Math.min(1080 - m.h, y))
    const comp: ComponentItem = {
      id: uid(), type, name: m.name, rect: { x, y, w: m.w, h: m.h },
      z: maxZ + 1, props: clone(m.props), data: m.data ? clone(m.data) : undefined,
    }
    comps.push(comp)
    setSelId(comp.id)
    commit()
  }

  /** 图层操作 */
  const layerAction = (c: ComponentItem, act: string) => {
    const comps = schemaRef.current.components
    const maxZ = Math.max(0, ...comps.map((x) => x.z || 1))
    const minZ = Math.min(...comps.map((x) => x.z || 1))
    if (act === 'top') c.z = maxZ + 1
    if (act === 'bottom') c.z = minZ - 1
    if (act === 'lock') c.locked = !c.locked
    if (act === 'hide') c.hidden = !c.hidden
    if (act === 'del') {
      schemaRef.current.components = comps.filter((x) => x.id !== c.id)
      setSelId(null)
    }
    if (act === 'dup') {
      const copy = clone(c)
      copy.id = uid()
      copy.rect.x += 24
      copy.rect.y += 24
      copy.z = maxZ + 1
      copy.name = c.name + ' 副本'
      comps.push(copy)
      setSelId(copy.id)
    }
    commit()
  }

  /* ---- 导出（动态 import：导出模块含 1MB runtime 字符串与 jszip，
         静态引入会把它们全部打进首屏 bundle，首开白白多下载 ~1.8MB） ---- */
  const doExportHtml = async () => {
    toast('正在导出…')
    const { exportHtmlFile } = await import('../export/exportHtml')
    exportHtmlFile(schemaRef.current, THEMES)
    toast('已导出 screen.html · 双击即可打开')
  }
  const doExportProject = async (kind: 'vue' | 'react') => {
    toast(`正在生成 ${kind === 'vue' ? 'Vue' : 'React'} 工程…`)
    const { exportProject } = await import('../export/project')
    await exportProject(kind, schemaRef.current, THEMES)
    toast(`已导出 screen-${kind}.zip · 解压后 npm install && npm run dev`)
  }

  const ctrl: EditorCtrl = {
    schemaRef, sceneRef, selId,
    select: setSelId,
    bump, renderModeRef,
    pushHistory, commit, undo, redo, canUndo, canRedo,
    setTheme, addMaterial, layerAction, toast,
  }

  return (
    <>
      {/* 文档主标题：视觉上省略（顶栏已有品牌区），但给屏幕阅读器与搜索引擎一个明确的一级标题 */}
      <h1 className="sr-only">ScreenForge 可视化大屏搭建器</h1>
      <Topbar ctrl={ctrl} onPreview={() => setPreviewOpen(true)} onExportHtml={doExportHtml} onExportProject={doExportProject} />
      <main>
        <Palette ctrl={ctrl} />
        <CanvasStage ctrl={ctrl} />
        <Inspector ctrl={ctrl} />
      </main>
      {previewOpen && <Preview ctrl={ctrl} onClose={() => setPreviewOpen(false)} />}
      {/* role=status：导出进度、格式报错等提示由屏幕阅读器主动播报 */}
      <div id="toast" role="status" aria-live="polite" className={toastMsg ? 'show' : ''}>{toastMsg}</div>
    </>
  )
}
