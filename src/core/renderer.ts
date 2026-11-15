/**
 * ============================================================
 * 渲染器 createScreen —— 全项目唯一的 DOM 渲染实现
 * ============================================================
 * 谁在用它：
 *   - 编辑器画布（App → CanvasStage）
 *   - 全屏预览（Preview）
 *   - 导出的单文件 HTML（runtime.iife.js 就是它的构建产物）
 * 三者共用同一份代码 ⇒ 导出物与编辑器所见必然一致。
 *
 * 设计要点：
 *   - 框架无关的命令式渲染：React 只管「什么时候调用 update」，
 *     组件 DOM 由这里全权接管（ECharts 实例必须命令式管理）；
 *   - 节点复用：按组件 id 缓存 DOM 与 chart 实例，类型/主题变化才重建；
 *   - 滚动列表与时钟由内部定时器驱动，dispose 时统一清理。
 */

import { echarts, type ECharts } from './echarts-setup'
import type { ComponentItem, ScreenHandle, ScreenSchema } from './schema'
export type { ScreenHandle } from './schema'
import type { ThemeToken } from './themes'
import { THEMES, al } from './themes'
import { buildOption, ensureChinaMap, fmtNum, FONT } from './option'

/** 图表类物料：走 card() 卡片外壳 + ECharts 实例 */
const CHART_TYPES: Record<string, boolean> = {
  'echarts.line': true, 'echarts.bar': true, 'echarts.pie': true,
  'echarts.gauge': true, 'echarts.map': true, 'echarts.radar': true,
}

/** 图表宿主 DOM（外壳内的留白层，echarts.init 挂在这上面） */
const CHART_SHELL = '<div class="sf-chart" style="position:absolute;inset:0"></div>'

/** HTML 内联 style 属性用的单引号版字体栈（双引号会截断 style 属性，原型踩过） */
const FONTX = FONT.replace(/"/g, "'")

/** HTML 转义 */
function esc(s: unknown): string {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
}

/**
 * 创建一个屏幕渲染实例。
 * @param root 挂载容器（绝对定位，尺寸 = 设计稿尺寸）
 * @param schema 屏幕描述
 * @param opts.themes 主题表（编辑器传实时对象以支持自定义主题；
 *                    导出 HTML 的引导代码传序列化后的副本）
 */
export function createScreen(
  root: HTMLElement,
  schema: ScreenSchema,
  opts?: { themes?: Record<string, ThemeToken> },
): ScreenHandle {
  const themesMap = opts?.themes || THEMES
  /** 节点缓存：id → DOM / 图表实例 / 渲染状态 */
  interface NodeRec {
    el: HTMLDivElement
    chart: ECharts | null
    type: string | null
    theme: string | null
    /** 图表在「分帧初始化」队列中，还没真正 echarts.init */
    pending: boolean
    /** 排队期间组件的最新状态（出队时用它 init + setOption，拖拽/改配置不丢） */
    latest: ComponentItem | null
    /** 节点已被删除或整体 dispose，出队时直接跳过 */
    dead: boolean
    /** 每次调度/取消排队时自增：让「await 地图数据中」的旧任务自动失效，防双初始化 */
    serial: number
  }
  const nodes: Record<string, NodeRec> = {}

  /* ---- 图表分帧初始化队列（P1 性能优化） ----
   * 之前 update() 在同一帧内同步 init + setOption 全部图表，
   * 5 个图表 ≈ 数百毫秒的长任务：骨架淡出后仍白屏、交互掉帧。
   * 现在：卡片外壳（标题/边框/四角）立即上屏保证首绘完整，
   * rAF 队列每帧只 init 一个图表，主线程在帧与帧之间可以喘口气。
   */
  const initQueue: NodeRec[] = []
  let pumping = false

  /** 取消排队并使在途初始化任务失效（类型切换重建 / 组件删除 / dispose 时调用） */
  function unqueue(rec: NodeRec): void {
    const i = initQueue.indexOf(rec)
    if (i >= 0) initQueue.splice(i, 1)
    rec.pending = false
    rec.latest = null
    rec.serial++
  }

  /** 初始化一个图表（地图组件先等 geoJSON 懒加载完成） */
  async function initChart(rec: NodeRec): Promise<void> {
    const s = rec.serial
    if (rec.type === 'echarts.map') {
      try { await ensureChinaMap() } catch { return } // 加载失败：下次配置变更时重试
    }
    // 等待期间节点被删除 / 取消排队 / 重新调度 → 本次作废
    if (rec.dead || !rec.pending || rec.serial !== s) return
    const c = rec.latest
    const host = rec.el.querySelector('.sf-chart') as HTMLElement | null
    if (!c || !host) return
    // 隐藏组件（display:none）的宿主尺寸为 0：此刻 init 只会得到一块 0×0 canvas
    // 并打 "Can't get dom width or height" 警告。这里保持 pending 不变直接返回，
    // 等组件被显示时由下一次 update → renderComp 的 pending 分支重新入队（见下方 A 处）。
    if (!host.clientWidth || !host.clientHeight) return
    rec.chart = echarts.init(host)
    rec.chart.setOption(buildOption(c, tok()) as never, true)
    rec.pending = false
    rec.latest = null
  }

  /** rAF 泵：每帧出队一个图表初始化 */
  function pump(): void {
    const rec = initQueue.shift()
    if (rec && !rec.dead) void initChart(rec)
    if (initQueue.length) requestAnimationFrame(pump)
    else pumping = false
  }

  /** 图表入队（已在队列则只刷新最新状态；不在则入队并确保泵在跑） */
  function scheduleChart(rec: NodeRec, c: ComponentItem): void {
    rec.serial++
    rec.pending = true
    rec.latest = c
    if (!initQueue.includes(rec)) initQueue.push(rec)
    if (!pumping) {
      pumping = true
      if (typeof requestAnimationFrame !== 'undefined') {
        requestAnimationFrame(pump)
      } else {
        // 无 rAF 的环境（理论不存在）：同步逐个初始化兜底
        while (initQueue.length) { const r = initQueue.shift(); if (r && !r.dead) void initChart(r) }
        pumping = false
      }
    }
  }
  let timer: number | null = null   // 时钟
  let stimer: number | null = null  // 滚动列表

  /** 当前主题 token */
  function tok(): ThemeToken {
    return themesMap[schema.page.theme] || themesMap.custom || themesMap['deep-blue']
  }

  /** 科技感四角边框（发光），所有卡片外壳共用 */
  function corners(t: ThemeToken): string {
    const s = `position:absolute;width:9px;height:9px;pointer-events:none;box-shadow:0 0 6px ${al(t.accent, .55)}`
    return `<i style="${s};left:0;top:0;border-left:2px solid ${t.accent};border-top:2px solid ${t.accent}"></i>` +
      `<i style="${s};right:0;top:0;border-right:2px solid ${t.accent};border-top:2px solid ${t.accent}"></i>` +
      `<i style="${s};left:0;bottom:0;border-left:2px solid ${t.accent};border-bottom:2px solid ${t.accent}"></i>` +
      `<i style="${s};right:0;bottom:0;border-right:2px solid ${t.accent};border-bottom:2px solid ${t.accent}"></i>`
  }

  /** 图表类卡片外壳：面板 + 顶部光线 + 标题栏 */
  function card(c: ComponentItem, t: ThemeToken, body: string): string {
    const p = c.props || {}
    return `<div style="position:absolute;inset:0;background:${t.panel};border:1px solid ${t.panelBorder};border-radius:4px;overflow:hidden">` +
      `<i style="position:absolute;left:8%;right:8%;top:0;height:1px;background:linear-gradient(90deg,transparent,${al(t.accent, .9)},transparent);pointer-events:none"></i>` +
      `<i style="position:absolute;left:0;top:0;right:0;height:52px;background:linear-gradient(180deg,${al(t.accent, .06)},transparent);pointer-events:none"></i>` +
      corners(t) +
      `<div style="position:absolute;left:0;top:0;right:0;height:42px;display:flex;align-items:center;gap:8px;padding:0 14px">` +
      `<i style="display:block;width:3px;height:13px;background:${t.accent};box-shadow:0 0 6px ${al(t.accent, .8)}"></i>` +
      `<span class="sf-card-title" style="font:500 15px/1 ${FONTX};color:${t.text};letter-spacing:.5px">${esc(p.title || c.name)}</span></div>` +
      `<div style="position:absolute;left:0;top:42px;right:0;bottom:0">${body}</div></div>`
  }

  /** DOM 类组件（数字翻牌 / 排行榜 / 滚动列表 / 标题 / 时钟） */
  function domHTML(c: ComponentItem, t: ThemeToken): string {
    const p = c.props || {}
    const d = (c.data || {}) as Record<string, unknown>
    const shell = `position:absolute;inset:0;background:${t.panel};border:1px solid ${t.panelBorder};border-radius:4px;overflow:hidden;font-family:${FONTX}`

    /* ---- 数字翻牌 ---- */
    if (c.type === 'deco.number') {
      const up = p.dir === 'up', down = p.dir === 'down'
      const dcol = up ? '#FF5B6E' : down ? '#00D9A0' : t.sub
      return `<div style="${shell};padding:20px 22px">` +
        corners(t) +
        `<div style="display:flex;justify-content:space-between;align-items:center">` +
        `<span style="font:400 13px/1 ${FONTX};color:${t.sub};letter-spacing:1px">${esc(p.label || '')}</span>` +
        `<i style="display:block;width:6px;height:6px;border-radius:50%;background:${t.accent};box-shadow:0 0 7px ${al(t.accent, .9)}"></i></div>` +
        `<div style="margin-top:16px;display:flex;align-items:baseline;gap:7px">` +
        `<span style="font:600 36px/1 ${FONTX};background:linear-gradient(180deg,${t.text} 30%,${al(t.accent, .85)});-webkit-background-clip:text;background-clip:text;color:transparent;font-variant-numeric:tabular-nums">${fmtNum(Number(p.value) || 0, Number(p.dec) || 0)}</span>` +
        `<span style="font:400 13px/1 ${FONTX};color:${t.sub}">${esc(p.unit || '')}</span></div>` +
        (p.delta ? `<div style="margin-top:12px;font:400 12px/1 ${FONTX};color:${dcol}">${up ? '▲ ' : down ? '▼ ' : ''}${esc(p.delta)}${(up || down) ? `<span style="color:${t.sub};margin-left:6px">较昨日</span>` : ''}</div>` : '') +
        `</div>`
    }

    /* ---- 排行榜 ---- */
    if (c.type === 'deco.rank') {
      const items = ((d.items as { name: string; value: number }[]) || []).slice(0, Number(p.top) || 5)
      const max = Math.max(1, ...items.map((i) => i.value))
      const rows = items.map((it, i) => {
        const w = Math.max(6, Math.round((it.value / max) * 100))
        const cidx = t.palette[i % t.palette.length]
        return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:13px">` +
          `<span style="font:500 12px/1 ${FONTX};color:${i < 3 ? t.accent : t.sub};width:18px">${String(i + 1).padStart(2, '0')}</span>` +
          `<div style="flex:1;min-width:0">` +
          `<div style="display:flex;justify-content:space-between;font:400 12px/1 ${FONTX};color:${t.text};margin-bottom:6px">` +
          `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(it.name)}</span>` +
          `<span style="color:${t.sub};font-variant-numeric:tabular-nums">${fmtNum(it.value)}</span></div>` +
          `<div style="height:4px;background:${t.grid};border-radius:2px;overflow:hidden">` +
          `<div style="width:${w}%;height:100%;background:linear-gradient(90deg,${cidx},${al(cidx, .3)});box-shadow:0 0 6px ${al(cidx, .5)}"></div></div>` +
          `</div></div>`
      }).join('')
      return `<div style="${shell};padding:16px 18px">${corners(t)}` +
        `<div style="margin-bottom:14px;font:500 13px/1 ${FONTX};color:${t.text}">${esc(p.title || c.name)}</div>${rows}</div>`
    }

    /* ---- 滚动列表：内容翻倍 + translateY 循环，实现无缝滚动 ---- */
    if (c.type === 'deco.scrollList') {
      const rows = (d.items as { name: string; value: string; status: string }[]) || []
      const rh = Number(p.rowH) || 34
      const stc: Record<string, string> = { ok: '#00D9A0', warn: '#FFC94A', err: '#FF5B6E' }
      const stt: Record<string, string> = { ok: '正常', warn: '预警', err: '告警' }
      const list = rows.map((it, i) => {
        const st = stc[it.status] ? it.status : 'ok'
        const sc = stc[st]
        return `<div style="display:flex;align-items:center;gap:10px;height:${rh}px;padding:0 6px;border-radius:3px;background:${i % 2 ? al(t.accent, .06) : 'transparent'};margin-bottom:4px">` +
          `<span style="font:500 12px/1 ${FONTX};color:${i < 3 ? t.accent : t.sub};width:20px">${String(i + 1).padStart(2, '0')}</span>` +
          `<span style="flex:1;min-width:0;font:400 12.5px/1 ${FONTX};color:${t.text};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(it.name)}</span>` +
          `<span style="font:400 12px/1 ${FONTX};color:${t.sub};font-variant-numeric:tabular-nums">${esc(it.value)}</span>` +
          `<span style="font:500 10.5px/1 ${FONTX};color:${sc};border:1px solid ${al(sc, .45)};padding:3px 0;border-radius:3px;width:44px;text-align:center;white-space:nowrap">${stt[st]}</span>` +
          `</div>`
      }).join('')
      const head = `<div style="display:flex;align-items:center;gap:10px;height:26px;padding:0 6px;font:500 11.5px/1 ${FONTX};color:${t.sub};border-bottom:1px solid ${t.panelBorder};margin-bottom:6px">` +
        `<span style="width:20px"></span><span style="flex:1">名称</span><span>指标</span><span style="width:46px;text-align:center">状态</span></div>`
      return `<div style="${shell};padding:14px 16px">${corners(t)}` +
        `<div style="margin-bottom:10px;font:500 13px/1 ${FONTX};color:${t.text}">${esc(p.title || c.name)}</div>` +
        head +
        `<div class="sf-scroll" style="position:absolute;left:16px;right:16px;top:70px;bottom:12px;overflow:hidden">` +
        `<div class="sf-scroll-inner" data-spd="${(Number(p.speed) || 2) * 0.5}">${list}${list}</div></div></div>`
    }

    /* ---- 标题：渐变文字 + 两侧翼线 ---- */
    if (c.type === 'deco.title') {
      const wingL = `<div style="display:flex;align-items:center;gap:10px">` +
        `<i style="display:block;width:110px;height:2px;background:linear-gradient(90deg,transparent,${al(t.accent, .85)})"></i>` +
        `<i style="display:block;width:7px;height:7px;background:${t.accent};transform:rotate(45deg);box-shadow:0 0 9px ${al(t.accent, .9)}"></i></div>`
      const wingR = `<div style="display:flex;align-items:center;gap:10px">` +
        `<i style="display:block;width:7px;height:7px;background:${t.accent};transform:rotate(45deg);box-shadow:0 0 9px ${al(t.accent, .9)}"></i>` +
        `<i style="display:block;width:110px;height:2px;background:linear-gradient(90deg,${al(t.accent, .85)},transparent)"></i></div>`
      return `<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:${FONTX}">` +
        `<div style="display:flex;align-items:center;gap:26px">${wingL}` +
        `<div style="font-size:${p.size || 36}px;font-weight:600;background:linear-gradient(90deg,${t.palette[0]},${t.text} 50%,${t.palette[1]});-webkit-background-clip:text;background-clip:text;color:transparent;letter-spacing:7px;text-indent:7px">${esc(p.text || '')}</div>` +
        `${wingR}</div>` +
        (p.sub ? `<div style="margin-top:9px;font-size:12px;color:${t.sub};letter-spacing:4px">${esc(p.sub)}</div>` : '') +
        `<div style="margin-top:14px;width:160px;height:2px;background:linear-gradient(90deg,transparent,${t.accent},transparent);box-shadow:0 0 8px ${al(t.accent, .6)}"></div></div>`
    }

    /* ---- 时钟（文本由 tick() 每秒刷新） ---- */
    if (c.type === 'deco.clock') {
      return `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:flex-end;gap:12px;padding:0 4px;font-family:${FONTX}">` +
        `<span class="sf-clock" style="font:500 16px/1 ${FONTX};color:${t.text};font-variant-numeric:tabular-nums;letter-spacing:1px">--:--:--</span>` +
        `<span class="sf-date" style="font:400 12px/1 ${FONTX};color:${t.sub}">----</span></div>`
    }

    return ''
  }

  /** 摆放节点（位置 / 尺寸 / 旋转） */
  function place(el: HTMLElement, r: ComponentItem['rect']): void {
    el.style.left = r.x + 'px'
    el.style.top = r.y + 'px'
    el.style.width = r.w + 'px'
    el.style.height = r.h + 'px'
    el.style.transform = r.rotate ? `rotate(${r.rotate}deg)` : ''
  }

  /** 渲染 / 更新单个组件（节点复用，类型或主题变了才重建） */
  function renderComp(c: ComponentItem): void {
    const t = tok()
    let rec = nodes[c.id]
    if (!rec) {
      const el = document.createElement('div')
      el.setAttribute('data-cid', c.id)
      el.style.position = 'absolute'
      el.style.boxSizing = 'border-box'
      root.appendChild(el)
      rec = { el, chart: null, type: null, theme: null, pending: false, latest: null, dead: false, serial: 0 }
      nodes[c.id] = rec
    }
    const node = rec.el
    place(node, c.rect)
    node.style.zIndex = String(c.z || 1)
    node.style.display = c.hidden ? 'none' : 'block'

    const isChart = !!CHART_TYPES[c.type]
    if (rec.type !== c.type || rec.theme !== schema.page.theme) {
      if (rec.chart) { rec.chart.dispose(); rec.chart = null }
      unqueue(rec) // 类型/主题变化 → 外壳重建，排队中的初始化作废
      node.innerHTML = ''
      rec.type = c.type
      rec.theme = schema.page.theme
    }

    if (isChart) {
      if (rec.pending) {
        // 图表还在分帧队列中：只刷新出队时要用的最新配置（外壳已在上次调度时渲染）
        scheduleChart(rec, c)
        return
      }
      if (!rec.chart) {
        // 首次出现：外壳立即上屏（标题/边框可见），图表本体走 rAF 队列分帧初始化
        node.innerHTML = card(c, t, CHART_SHELL)
        scheduleChart(rec, c)
      } else {
        const tt = node.querySelector('.sf-card-title')
        if (tt) tt.textContent = (c.props.title as string) || c.name
        // 尺寸校验：从隐藏切回可见时，外层尺寸变了但没有任何 updateLayout 调用，
        // canvas 会停在旧尺寸（甚至停在初始化时的 0×0）。这里对齐一次再画。
        // 命中条件很少，读 clientWidth 与前面的写样式同属一个任务，只触发一次 reflow。
        const host = node.querySelector('.sf-chart') as HTMLElement | null
        if (host && (rec.chart.getWidth() !== host.clientWidth || rec.chart.getHeight() !== host.clientHeight)) {
          rec.chart.resize()
        }
        rec.chart.setOption(buildOption(c, t) as never, true)
      }
    } else {
      node.innerHTML = domHTML(c, t)
    }
  }

  /** 每秒刷新时钟 */
  function tick(): void {
    const clocks = root.querySelectorAll('.sf-clock')
    if (!clocks.length) return
    const now = new Date()
    const pad = (n: number) => (n < 10 ? '0' : '') + n
    const hh = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
    const wk = '日一二三四五六'.charAt(now.getDay())
    const dd = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} 周${wk}`
    clocks.forEach((el) => { el.textContent = hh })
    root.querySelectorAll('.sf-date').forEach((el) => { el.textContent = dd })
  }

  /** 滚动列表动画：40ms 步进 translateY，超过一半高度归零 */
  function scrollTick(): void {
    const els = root.querySelectorAll<HTMLElement>('.sf-scroll-inner')
    els.forEach((el) => {
      if (!el.dataset.h) el.dataset.h = String(el.scrollHeight / 2)
      const half = Number(el.dataset.h)
      if (!half) return
      let off = Number(el.dataset.off || 0)
      off += Number(el.getAttribute('data-spd')) || 1
      if (off >= half) off = 0
      el.dataset.off = String(off)
      el.style.transform = `translateY(-${off}px)`
    })
  }

  /* ---- 对外 API（同 ScreenHandle） ---- */

  function update(next: ScreenSchema): void {
    schema = next
    const t = tok()
    root.style.width = schema.page.width + 'px'
    root.style.height = schema.page.height + 'px'
    // 页面背景：用户覆盖色 或 主题默认的顶部辉光渐变
    root.style.background = schema.page.background ||
      `radial-gradient(130% 95% at 50% 0%,${t.panel} 0%,${t.bg} 62%)`
    const alive: Record<string, boolean> = {}
    ;(schema.components || []).forEach((c) => { alive[c.id] = true; renderComp(c) })
    // 清理已删除组件的节点与图表实例
    Object.keys(nodes).forEach((id) => {
      if (alive[id]) return
      const rec = nodes[id]
      rec.dead = true
      if (rec.chart) rec.chart.dispose()
      unqueue(rec)
      rec.el.parentNode?.removeChild(rec.el)
      delete nodes[id]
    })
    tick()
  }

  function updateLayout(next: ScreenSchema): void {
    schema = next
    ;(schema.components || []).forEach((c) => {
      const rec = nodes[c.id]
      if (!rec) return
      place(rec.el, c.rect)
      rec.el.style.zIndex = String(c.z || 1)
      rec.el.style.display = c.hidden ? 'none' : 'block'
      if (rec.chart) rec.chart.resize()
    })
  }

  function resize(): void {
    Object.keys(nodes).forEach((id) => { nodes[id].chart?.resize() })
  }

  function dispose(): void {
    if (timer) clearInterval(timer)
    if (stimer) clearInterval(stimer)
    Object.keys(nodes).forEach((id) => {
      const rec = nodes[id]
      rec.dead = true
      if (rec.chart) rec.chart.dispose()
      unqueue(rec)
    })
    initQueue.splice(0)
    for (const id of Object.keys(nodes)) delete nodes[id]
    root.innerHTML = ''
  }

  // 地图 geoJSON 不再预热：ensureChinaMap 由图表初始化队列在遇到地图组件时按需调用（懒加载）

  if (typeof window !== 'undefined') {
    timer = window.setInterval(tick, 1000)
    stimer = window.setInterval(scrollTick, 40)
  }
  update(schema)

  return { update, updateLayout, resize, dispose, buildOption: (c, t) => buildOption(c, t || tok()) }
}
