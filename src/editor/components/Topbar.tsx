/**
 * 顶栏：品牌 / 撤销重做 / 主题色板（含自定义，点击触发撒盐特效）/ 预览 / 三种导出
 */

import { THEMES } from '../../core/themes'
import type { EditorCtrl } from '../App'

interface Props {
  ctrl: EditorCtrl
  onPreview(): void
  onExportHtml(): void
  onExportProject(kind: 'vue' | 'react'): void
  onExportJson(): void
}

export default function Topbar({ ctrl, onPreview, onExportHtml, onExportProject, onExportJson }: Props) {
  const schema = ctrl.schemaRef.current
  const cur = schema.page.theme

  return (
    <header id="topbar">
      <div className="brand">
        <i className="dot" />
        <span>ScreenForge</span>
        <small>开放大屏搭建器 · V1</small>
      </div>
      <div className="badge">画布 1920 × 1080 · 16:9</div>
      <button className="tb-btn" id="btnUndo" title="Ctrl+Z" onClick={ctrl.undo} disabled={!ctrl.canUndo()}>↶ 撤销</button>
      <button className="tb-btn" id="btnRedo" title="Ctrl+Shift+Z" onClick={ctrl.redo} disabled={!ctrl.canRedo()}>↷ 重做</button>
      <div className="spacer" />
      <div className="theme-swatches">
        {Object.keys(THEMES).map((k) => {
          const t = THEMES[k]
          return (
            <button
              key={k}
              className={'sw' + (cur === k ? ' active' : '')}
              data-theme={k}
              title={t.label}
              aria-label={`主题：${t.label}`}
              aria-pressed={cur === k}
              onClick={() => ctrl.setTheme(k)}
            >
              <i style={{ left: 0, top: 0, width: '100%', height: '100%', background: t.bg }} />
              <i style={{ left: 5, bottom: 5, width: 6, height: 6, background: t.accent, borderRadius: 1 }} />
              <i style={{ left: 14, bottom: 5, width: 6, height: 6, background: t.palette[1], borderRadius: 1 }} />
            </button>
          )
        })}
      </div>
      <button className="tb-btn" onClick={onPreview}>预览</button>
      <button className="tb-btn" id="btnExportJson" title="导出当前大屏的 schema 结构（JSON），可用于备份、迁移或查看数据结构" onClick={onExportJson}>导出 JSON</button>
      <button className="tb-btn primary" onClick={onExportHtml}>导出 HTML</button>
      <button className="tb-btn" onClick={() => onExportProject('vue')}>导出 Vue 工程</button>
      <button className="tb-btn" onClick={() => onExportProject('react')}>导出 React 工程</button>
    </header>
  )
}
