/**
 * 物料库面板：按分类分组展示，支持拖拽进画布或点击直接添加。
 * 物料图标用轻量 SVG（编辑器专属，不影响 core）。
 */

import { ALL_MATERIALS, PALETTE_CATS } from '../../core/materials'
import type { EditorCtrl } from '../App'

/** 物料小图标（30×24 SVG） */
function icon(type: string): JSX.Element {
  const c = 'currentColor'
  switch (type) {
    case 'echarts.line':
      return <svg width="30" height="24" viewBox="0 0 30 24" fill="none"><polyline points="2,18 9,11 15,14 22,5 28,9" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><circle cx="22" cy="5" r="1.9" fill={c} /></svg>
    case 'echarts.bar':
      return <svg width="30" height="24" viewBox="0 0 30 24" fill="none"><rect x="3" y="12" width="5" height="9" fill={c} /><rect x="12" y="6" width="5" height="15" fill={c} /><rect x="21" y="9" width="5" height="12" fill={c} /></svg>
    case 'echarts.pie':
      return <svg width="30" height="24" viewBox="0 0 30 24" fill="none"><circle cx="15" cy="12" r="9" stroke={c} strokeWidth="1.8" /><path d="M15 12 L15 3 A9 9 0 0 1 23 16 Z" fill={c} opacity=".85" /></svg>
    case 'echarts.gauge':
      return <svg width="30" height="24" viewBox="0 0 30 24" fill="none"><path d="M4 18 A11 11 0 0 1 26 18" stroke={c} strokeWidth="1.8" strokeLinecap="round" /><path d="M15 18 L21 10" stroke={c} strokeWidth="1.8" strokeLinecap="round" /></svg>
    case 'echarts.map':
      return <svg width="30" height="24" viewBox="0 0 30 24" fill="none"><path d="M5 9 L11 5 L19 6 L25 11 L22 17 L14 20 L8 17 Z" stroke={c} strokeWidth="1.6" strokeLinejoin="round" /><circle cx="14" cy="12" r="1.6" fill={c} /><circle cx="20" cy="9" r="1.3" fill={c} opacity=".7" /></svg>
    case 'echarts.radar':
      return <svg width="30" height="24" viewBox="0 0 30 24" fill="none"><polygon points="15,3 23.5,9.2 20.3,19.3 9.7,19.3 6.4,9.2" stroke={c} strokeWidth="1.6" strokeLinejoin="round" /><polygon points="15,8 19,11 17.6,16 12.4,16 11,11" fill={c} opacity=".55" /></svg>
    case 'deco.number':
      return <svg width="30" height="24" viewBox="0 0 30 24" fill="none"><text x="15" y="18" textAnchor="middle" fontSize="14" fontWeight="600" fill={c} fontFamily="system-ui">128</text></svg>
    case 'deco.rank':
      return <svg width="30" height="24" viewBox="0 0 30 24" fill="none"><rect x="3" y="4" width="18" height="2.5" fill={c} /><rect x="3" y="11" width="24" height="2.5" fill={c} opacity=".75" /><rect x="3" y="18" width="13" height="2.5" fill={c} opacity=".55" /></svg>
    case 'deco.scrollList':
      return <svg width="30" height="24" viewBox="0 0 30 24" fill="none"><rect x="4" y="4" width="20" height="4" rx="1" stroke={c} strokeWidth="1.5" /><rect x="4" y="11" width="20" height="4" rx="1" stroke={c} strokeWidth="1.5" opacity=".75" /><rect x="4" y="18" width="13" height="4" rx="1" stroke={c} strokeWidth="1.5" opacity=".55" /><path d="M25 16 L25 22 M22.5 19.5 L25 22 L27.5 19.5" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
    case 'deco.title':
      return <svg width="30" height="24" viewBox="0 0 30 24" fill="none"><text x="15" y="18" textAnchor="middle" fontSize="14" fontWeight="600" fill={c} fontFamily="system-ui">Aa</text></svg>
    default:
      return <svg width="30" height="24" viewBox="0 0 30 24" fill="none"><circle cx="15" cy="12" r="9" stroke={c} strokeWidth="1.8" /><path d="M15 7 L15 12 L19 14" stroke={c} strokeWidth="1.8" strokeLinecap="round" /></svg>
  }
}

export default function Palette({ ctrl }: { ctrl: EditorCtrl }) {
  return (
    <aside id="palette">
      {PALETTE_CATS.map((cat) => (
        <div key={cat}>
          <div className="sec-t">{cat}</div>
          <div className="grid2">
            {ALL_MATERIALS.filter((m) => m.cat === cat).map((m) => (
              <div
                key={m.type}
                className="tile"
                draggable
                role="button"
                tabIndex={0}
                title={`点击或拖入画布添加${m.name}`}
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', m.type)
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                onClick={() => ctrl.addMaterial(m.type)}
                onKeyDown={(e) => {
                  // 键盘等价操作：Enter / 空格 = 点击添加
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ctrl.addMaterial(m.type) }
                }}
              >
                <span aria-hidden="true">{icon(m.type)}</span>
                <span>{m.name}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="sec-t">操作提示</div>
      <div className="hint">
        拖拽或点击添加组件<br />
        选中后拖边框缩放（自动对齐校准）<br />
        <span className="kbd">Delete</span> 删除 · <span className="kbd">Ctrl+Z</span> 撤销<br />
        方向键微调位置（Shift ×10）<br />
        点击空白处编辑页面主题
      </div>
    </aside>
  )
}
