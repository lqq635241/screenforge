/**
 * 属性面板：右侧栏。
 *   - 未选中组件 → 页面设置（主题色板 / 自定义主题 / 背景 / 统计 / 快捷键）
 *   - 选中组件   → 基础 / 配置项 / 数据来源 / rawOption 逃生舱 / 图层
 * 表单由物料的 FIELDS 声明驱动，不针对单种物料写死面板。
 */

import { useRef } from 'react'
import { FIELDS, DATA_TYPES, getMaterial } from '../../core/materials'
import { THEMES, deriveCustomTheme, type ThemeToken } from '../../core/themes'
import type { ComponentItem } from '../../core/schema'
import type { EditorCtrl } from '../App'

/** 单个字段行（text / number / switch / select） */
function FieldRow({ c, f, ctrl }: { c: ComponentItem; f: { k: string; l: string; t: string; min?: number; max?: number; opts?: [string, string][] }; ctrl: EditorCtrl }) {
  const v = c.props[f.k]
  if (f.t === 'switch') {
    return (
      <div className="sw-line">
        <span>{f.l}</span>
        <button
          type="button"
          className={'switch' + (v ? ' on' : '')}
          role="switch"
          aria-checked={!!v}
          aria-label={f.l}
          onClick={() => { c.props[f.k] = !c.props[f.k]; ctrl.bump('full'); ctrl.pushHistory() }}
        />
      </div>
    )
  }
  if (f.t === 'select') {
    return (
      <div className="row">
        <span className="lb">{f.l}</span>
        <select className="in" aria-label={f.l} value={String(v ?? '')} onChange={(e) => { c.props[f.k] = e.target.value; ctrl.commit() }}>
          {f.opts!.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
        </select>
      </div>
    )
  }
  if (f.t === 'number') {
    return (
      <div className="row">
        <span className="lb">{f.l}</span>
        <input className="in" type="number" aria-label={f.l} min={f.min} max={f.max} value={String(v ?? '')}
          onChange={(e) => { c.props[f.k] = Number(e.target.value); ctrl.bump('full') }}
          onBlur={() => ctrl.pushHistory()} />
      </div>
    )
  }
  return (
    <div className="row">
      <span className="lb">{f.l}</span>
      <input className="in" aria-label={f.l} value={String(v ?? '')}
        onChange={(e) => { c.props[f.k] = e.target.value; ctrl.bump('full') }}
        onBlur={() => ctrl.pushHistory()} />
    </div>
  )
}

/** 数据来源区块：写死 JSON / 接口配置（V1 接口仅保存不取数） */
function DataBlock({ c, ctrl }: { c: ComponentItem; ctrl: EditorCtrl }) {
  const taRef = useRef<HTMLTextAreaElement>(null)
  if (!DATA_TYPES.includes(c.type)) {
    return (
      <div className="grp">
        <div className="grp-t">数据</div>
        <div className="hint">该组件不消费数据集，数值直接在「配置项」里填。</div>
      </div>
    )
  }
  const mode = c.dataMode || 'static'
  const seg = (
    <div className="seg" role="group" aria-label="数据来源方式">
      <button type="button" aria-pressed={mode === 'static'} className={mode === 'static' ? 'on' : ''} onClick={() => { c.dataMode = 'static'; ctrl.bump('full') }}>写死数据</button>
      <button type="button" aria-pressed={mode === 'http'} className={mode === 'http' ? 'on' : ''} onClick={() => { c.dataMode = 'http'; ctrl.bump('full') }}>接口数据</button>
    </div>
  )
  let body: JSX.Element
  if (mode === 'static') {
    body = (
      <>
        <textarea ref={taRef} className="in" spellCheck={false} aria-label="数据 JSON" defaultValue={JSON.stringify(c.data || {}, null, 2)} />
        <div className="mini-btns" style={{ marginTop: 8 }}>
          <button className="mini" onClick={() => {
            try {
              c.data = JSON.parse(taRef.current?.value || '{}')
              ctrl.commit()
              ctrl.toast('数据已应用')
            } catch (err) { ctrl.toast('JSON 格式有误：' + (err as Error).message) }
          }}>应用数据</button>
          <button className="mini" onClick={() => { randomData(c); ctrl.commit(); ctrl.toast('已生成随机数据') }}>随机一批</button>
        </div>
      </>
    )
  } else {
    const h = c.http || {}
    body = (
      <>
        <div className="row"><span className="lb">地址</span><input className="in" aria-label="接口地址" defaultValue={h.url || ''} placeholder="https://api.example.com/stat"
          onChange={(e) => { c.http = { ...h, url: e.target.value }; ctrl.pushHistory() }} /></div>
        <div className="row"><span className="lb">方法</span>
          <select className="in" aria-label="请求方法" defaultValue={h.method || 'GET'} onChange={(e) => { c.http = { ...h, method: e.target.value as 'GET' | 'POST' }; ctrl.pushHistory() }}>
            <option>GET</option><option>POST</option>
          </select></div>
        <div className="row"><span className="lb">轮询/秒</span><input className="in" type="number" aria-label="轮询间隔（秒）" min={0} defaultValue={h.interval || 0}
          onChange={(e) => { c.http = { ...h, interval: Number(e.target.value) }; ctrl.pushHistory() }} /></div>
        <div className="hint" style={{ marginTop: 8 }}>
          V1 仅保存配置不真实取数。正式版为「数据源 → 转换 → 字段映射」三段管线 + 三栏调试视图（见设计方案 §7）。
          注意：导出的 HTML 直连内网接口会被浏览器 CORS 拦截。
        </div>
      </>
    )
  }
  return <div className="grp"><div className="grp-t">数据来源</div>{seg}{body}</div>
}

/** 随机数据：按数据结构分支生成 */
function randomData(c: ComponentItem) {
  const d = (c.data = c.data || {}) as Record<string, any>
  if (d.categories) {
    d.series = (d.series || [{ name: '系列1', values: [] }]).map((s: any) => ({
      name: s.name, values: (s.values || []).map(() => Math.round(80 + Math.random() * 600)),
    }))
  } else if (d.indicators) {
    d.series = (d.series || []).map((s: any) => ({
      name: s.name, values: s.values.map(() => Math.round(40 + Math.random() * 60)),
    }))
  } else if (d.items?.length && typeof d.items[0].value === 'string') {
    d.items = d.items.map((it: any) => {
      const r = Math.random()
      return { name: it.name, value: it.value, status: r < 0.15 ? 'err' : r < 0.4 ? 'warn' : 'ok' }
    })
  } else if (d.items) {
    d.items = d.items.map((it: any) => ({ name: it.name, value: Math.round(200 + Math.random() * 900) }))
  } else if (d.value != null) {
    d.value = Math.round(Math.random() * 100)
  }
}

/** 页面设置面板（未选中组件时） */
function PageSettings({ ctrl }: { ctrl: EditorCtrl }) {
  const schema = ctrl.schemaRef.current
  const cur = THEMES[schema.page.theme] || THEMES.custom

  /** 自定义主题改色：实时推导边框/网格并全量刷新 */
  const editCustom = (fn: (t: ThemeToken) => void) => {
    fn(THEMES.custom)
    deriveCustomTheme(THEMES.custom)
    if (schema.page.theme === 'custom') ctrl.bump('full')
    ctrl.bump('full')
  }

  const fields: [keyof ThemeToken, string][] = [
    ['accent', '主色'], ['bg', '背景'], ['panel', '面板'], ['text', '文字'], ['sub', '副文字'],
  ]

  return (
    <>
      <div className="ins-head"><b>页面设置</b><em>未选中组件</em></div>
      <div className="grp">
        <div className="grp-t">主题色板</div>
        {Object.keys(THEMES).map((k) => (
          <div className="row" key={k}>
            <span className="lb" />
            <button className="mini" style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left', ...(schema.page.theme === k ? { borderColor: '#4C8DFF', color: '#DCE6F5' } : {}) }}
              onClick={() => ctrl.setTheme(k)}>
              <i style={{ width: 10, height: 10, borderRadius: 2, background: THEMES[k].accent, display: 'inline-block', boxShadow: `0 0 5px ${THEMES[k].accent}` }} />
              {THEMES[k].label}
            </button>
          </div>
        ))}
      </div>
      <div className="grp">
        <div className="grp-t">自定义主题</div>
        {fields.map(([k, l]) => (
          <div className="row" key={k}>
            <span className="lb">{l}</span>
            <input className="in" type="color" aria-label={`${l}颜色`} value={THEMES.custom[k] as string}
              onChange={(e) => editCustom((t) => { (t as any)[k] = e.target.value })} />
          </div>
        ))}
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <span className="lb" style={{ paddingTop: 6 }}>图表色</span>
          <div style={{ flex: 1, display: 'flex', gap: 5 }}>
            {THEMES.custom.palette.map((cc, i) => (
              <input key={i} type="color" aria-label={`图表色 ${i + 1}`} value={cc} style={{ flex: 1, minWidth: 0, height: 26, padding: 1, border: '1px solid #1E2735', borderRadius: 4, background: '#101724', cursor: 'pointer' }}
                onChange={(e) => editCustom((t) => { t.palette[i] = e.target.value })} />
            ))}
          </div>
        </div>
        <div className="mini-btns" style={{ marginTop: 8 }}>
          <button className="mini" onClick={() => ctrl.setTheme('custom')}>应用并切换</button>
          <button className="mini" onClick={() => {
            Object.assign(THEMES.custom, JSON.parse(JSON.stringify(THEMES['deep-blue'])))
            THEMES.custom.label = '自定义'
            ctrl.toast('自定义主题已重置为深海蓝')
            ctrl.bump('full')
          }}>从深海蓝重置</button>
        </div>
        <div className="hint" style={{ marginTop: 8 }}>改色实时预览；点「应用并切换」整屏生效并触发换肤动效。</div>
      </div>
      <div className="grp">
        <div className="grp-t">页面</div>
        <div className="row"><span className="lb">背景</span>
          <input className="in" type="color" aria-label="页面背景色" value={schema.page.background || cur.bg}
            onChange={(e) => { schema.page.background = e.target.value; ctrl.pushHistory(); ctrl.bump('full') }} /></div>
        <div className="row"><span className="lb">尺寸</span><input className="in" aria-label="画布尺寸" value="1920 × 1080（固定 16:9）" disabled style={{ color: '#6F7E96' }} /></div>
      </div>
      <div className="grp">
        <div className="grp-t">组件统计</div>
        <div className="hint">
          共 {schema.components.length} 个组件 · 图表 {schema.components.filter((x) => x.type.startsWith('echarts.')).length} 个
        </div>
      </div>
      <div className="grp">
        <div className="grp-t">快捷键</div>
        <div className="hint">
          <span className="kbd">Delete</span> 删除选中 · <span className="kbd">Ctrl+D</span> 复制<br />
          <span className="kbd">Ctrl+Z</span> 撤销 · <span className="kbd">Ctrl+Shift+Z</span> 重做<br />
          方向键微调 · <span className="kbd">Shift</span>+方向键 ×10
        </div>
      </div>
    </>
  )
}

/** X/Y/W/H 输入框的可访问名称 */
const RECT_LABEL = { x: 'X 坐标', y: 'Y 坐标', w: '宽度', h: '高度' } as const

/** 组件属性面板（选中组件时） */
function CompPanel({ c, ctrl }: { c: ComponentItem; ctrl: EditorCtrl }) {
  const taRef = useRef<HTMLTextAreaElement>(null)
  const fields = FIELDS[c.type] || []
  const matName = getMaterial(c.type)?.name || c.type
  const maxZ = Math.max(...ctrl.schemaRef.current.components.map((x) => x.z || 1))
  const minZ = Math.min(...ctrl.schemaRef.current.components.map((x) => x.z || 1))

  const act = (a: string) => {
    const comps = ctrl.schemaRef.current.components
    if (a === 'alignCx') { c.rect.x = Math.round((1920 - c.rect.w) / 2); ctrl.commit() }
    if (a === 'alignCy') { c.rect.y = Math.round((1080 - c.rect.h) / 2); ctrl.commit() }
    if (a === 'alignFull') { c.rect = { x: 0, y: 0, w: 1920, h: 1080 }; ctrl.commit() }
    if (a === 'top') { c.z = maxZ + 1; ctrl.commit() }
    if (a === 'bottom') { c.z = minZ - 1; ctrl.commit() }
    if (a === 'lock') { c.locked = !c.locked; ctrl.commit() }
    if (a === 'hide') { c.hidden = !c.hidden; ctrl.commit() }
    if (a === 'dup') { ctrl.layerAction(c, 'dup') }
    if (a === 'del') { ctrl.layerAction(c, 'del') }
    void comps
  }

  const setRect = (k: 'x' | 'y' | 'w' | 'h', v: string) => {
    const n = Number(v) || 0
    if (k === 'x') c.rect.x = n
    if (k === 'y') c.rect.y = n
    if (k === 'w') c.rect.w = n
    if (k === 'h') c.rect.h = n
    ctrl.bump('layout')
  }

  return (
    <>
      <div className="ins-head"><b>{matName}</b><em>{c.type}</em></div>
      <div className="grp">
        <div className="grp-t">基础</div>
        <div className="row"><span className="lb">名称</span>
          <input className="in" aria-label="组件名称" defaultValue={c.name} onChange={(e) => { c.name = e.target.value; ctrl.bump('full') }} onBlur={() => ctrl.pushHistory()} /></div>
        <div className="quad">
          {(['x', 'y', 'w', 'h'] as const).map((k) => (
            <div className="row" key={k}><span className="lb">{k.toUpperCase()}</span>
              <input className="in" type="number" aria-label={RECT_LABEL[k]} value={c.rect[k]} onChange={(e) => setRect(k, e.target.value)} onBlur={() => ctrl.pushHistory()} /></div>
          ))}
        </div>
        <div className="mini-btns" style={{ marginTop: 9 }}>
          <button className="mini" onClick={() => act('alignCx')}>水平居中</button>
          <button className="mini" onClick={() => act('alignCy')}>垂直居中</button>
          <button className="mini" onClick={() => act('alignFull')}>铺满</button>
        </div>
      </div>
      {fields.length > 0 && (
        <div className="grp">
          <div className="grp-t">配置项</div>
          {fields.map((f) => <FieldRow key={f.k} c={c} f={f} ctrl={ctrl} />)}
        </div>
      )}
      <DataBlock c={c} ctrl={ctrl} />
      <div className="grp">
        <div className="grp-t">高级（rawOption 逃生舱）</div>
        <textarea ref={taRef} className="in" aria-label="option 片段 JSON" style={{ height: 74 }} spellCheck={false}
          placeholder='{"legend":{"top":30}}'
          defaultValue={c.rawOption ? JSON.stringify(c.rawOption, null, 2) : ''} />
        <div className="mini-btns" style={{ marginTop: 8 }}>
          <button className="mini" onClick={() => {
            try {
              const txt = (taRef.current?.value || '').trim()
              c.rawOption = txt ? JSON.parse(txt) : null
              ctrl.commit()
              ctrl.toast('option 片段已合并')
            } catch (err) { ctrl.toast('JSON 格式有误：' + (err as Error).message) }
          }}>应用 option 片段</button>
          <button className="mini" onClick={() => { c.rawOption = null; ctrl.commit() }}>清空</button>
        </div>
        <div className="hint" style={{ marginTop: 8 }}>深度 merge 到生成结果之上，兜住配置项不够的情况。</div>
      </div>
      <div className="grp">
        <div className="grp-t">图层</div>
        <div className="mini-btns">
          <button className="mini" onClick={() => act('top')}>置顶</button>
          <button className="mini" onClick={() => act('bottom')}>置底</button>
          <button className="mini" onClick={() => act('lock')}>{c.locked ? '解锁' : '锁定'}</button>
          <button className="mini" onClick={() => act('hide')}>{c.hidden ? '显示' : '隐藏'}</button>
          <button className="mini" onClick={() => act('dup')}>复制</button>
          <button className="mini danger" onClick={() => act('del')}>删除</button>
        </div>
      </div>
    </>
  )
}

export default function Inspector({ ctrl }: { ctrl: EditorCtrl }) {
  const c = ctrl.schemaRef.current.components.find((x) => x.id === ctrl.selId)
  return <aside id="inspector">{c ? <CompPanel c={c} ctrl={ctrl} /> : <PageSettings ctrl={ctrl} />}</aside>
}
