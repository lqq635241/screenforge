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
import { computeFill, pageBackground, type FillLayout, type Slot } from './fit'

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
 * @param root 挂载容器。fill=false 时它必须是设计稿尺寸的盒子（编辑器画布）；
 *             fill=true 时它铺满父容器（预览 / 导出），组件按百分比落位。
 * @param schema 屏幕描述
 * @param opts.themes 主题表（编辑器传实时对象以支持自定义主题；
 *                    导出 HTML 的引导代码传序列化后的副本）
 * @param opts.fill 是否按「百分比铺满屏幕」布局（默认 false = 设计稿绝对像素）
 * @param opts.paintBackground 是否由渲染器画页面背景。默认 true（编辑器画布）；
 *                    预览 / 导出传 false：背景画在外层全屏容器上，
 *                    内容层保持透明，避免缩放后背景边缘露馅。
 */
export function createScreen(
  root: HTMLElement,
  schema: ScreenSchema,
  opts?: { themes?: Record<string, ThemeToken>; fill?: boolean; paintBackground?: boolean },
): ScreenHandle {
  const themesMap = opts?.themes || THEMES
  /** 铺满模式：组件盒子用百分比，内容层等比缩放 */
  const fill = !!opts?.fill
  const paintBackground = opts?.paintBackground !== false
  /** 当前布局（每次 update / resize 重算） */
  let lay: FillLayout | null = null
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
    /** 上一次渲染时的可见状态（仅用于识别「隐藏 → 显示」的尺寸校准时机） */
    visible: boolean
    /** 最近一次渲染该图表用的组件（resize 时据此重建 option，刷新字号） */
    comp: ComponentItem | null
    /** 最近一次渲染用的缩放系数（尺寸变化超过阈值才重建 option，避免频繁抖动） */
    k: number
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
    // 隐藏组件（display:none）此刻 init 只会得到一块 0×0 canvas，并打
    // "Can't get dom width or height" 警告。这里保持 pending 直接返回，等组件被
    // 显示时由下一次 update → renderComp 的 pending 分支重新入队。
    // 先用 visible 筛掉隐藏组件，避免读取 clientWidth 触发强制同步布局。
    if (!rec.visible) return
    if (!host.clientWidth || !host.clientHeight) return
    // 容器就是真实像素尺寸（图表填满卡片，不再有 transform 缩放），
    // 直接用屏幕 DPR 即可；上限 2.5 避免 4K 拼接屏上画布过大吃显存
    const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1
    const ks = kOf(c.rect)
    rec.chart = echarts.init(host, undefined, { devicePixelRatio: Math.min(2.5, dpr) })
    rec.chart.setOption(buildOption(c, tok(), ks) as never, true)
    rec.comp = c
    rec.k = ks
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

  /**
   * 图表类卡片外壳。
   *
   * 这里跟 DOM 类物料不同：**不套等比缩放的内容层**。
   *   外框（背景 / 边框 / 四角）铺满组件盒子，
   *   标题栏高度、标题字号按 --sf-k 缩放（跟随卡片大小，免得大屏上字太小），
   *   图表容器直接填满剩余区域 —— 于是图表随卡片一起铺满宽高。
   *
   * 圆会不会被拉扁？不会：饼图 / 仪表盘 / 雷达图的半径是**百分比**，
   * ECharts 按容器短边取长度，容器变宽只会让两侧留白变多，圆仍是正圆。
   */
  function card(c: ComponentItem, t: ThemeToken, body: string): string {
    const p = c.props || {}
    const k = 'var(--sf-k,1)'
    return `<div class="sf-frame" style="position:absolute;inset:0;background:${t.panel};border:1px solid ${t.panelBorder};border-radius:4px;overflow:hidden">` +
      `<i style="position:absolute;left:8%;right:8%;top:0;height:1px;background:linear-gradient(90deg,transparent,${al(t.accent, .9)},transparent);pointer-events:none"></i>` +
      `<i style="position:absolute;left:0;top:0;right:0;height:calc(52px * ${k});background:linear-gradient(180deg,${al(t.accent, .06)},transparent);pointer-events:none"></i>` +
      corners(t) +
      `<div style="position:absolute;left:0;top:0;right:0;height:calc(42px * ${k});display:flex;align-items:center;gap:calc(8px * ${k});padding:0 calc(14px * ${k})">` +
      `<i style="display:block;width:calc(3px * ${k});height:calc(13px * ${k});background:${t.accent};box-shadow:0 0 6px ${al(t.accent, .8)}"></i>` +
      `<span class="sf-card-title" style="font-weight:500;font-size:calc(15px * ${k});line-height:1;font-family:${FONTX};color:${t.text};letter-spacing:.5px">${esc(p.title || c.name)}</span></div>` +
      `<div style="position:absolute;left:0;top:calc(42px * ${k});right:0;bottom:0">${body}</div>` +
      `</div>`
  }

  /** DOM 类组件（数字翻牌 / 排行榜 / 滚动列表 / 标题 / 时钟） */
  function domHTML(c: ComponentItem, t: ThemeToken): string {
    const p = c.props || {}
    const d = (c.data || {}) as Record<string, unknown>
    // 背景 / 边框 / 四角由外层 .sf-frame 提供（铺满盒子），这里只负责内容排版
    const shell = `position:absolute;inset:0;overflow:hidden;font-family:${FONTX}`

    /* ---- 数字翻牌 ---- */
    if (c.type === 'deco.number') {
      const up = p.dir === 'up', down = p.dir === 'down'
      const dcol = up ? '#FF5B6E' : down ? '#00D9A0' : t.sub
      return `<div style="${shell};padding:20px 22px">` +
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
      return `<div style="${shell};padding:16px 18px">` +
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
      return `<div style="${shell};padding:14px 16px">` +
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

  /** 重算百分比布局（铺满模式）。组件位置 / 窗口尺寸变化时调用，成本 O(n) */
  function computeLayout(): void {
    if (!fill) return
    const W = schema.page.width
    const H = schema.page.height
    const vw = root.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : W)
    const vh = root.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : H)
    lay = computeFill(W, H, vw, vh, (schema.components || []).filter((c) => !c.hidden).map((c) => c.rect))
  }

  /**
   * 摆放节点（位置 / 尺寸 / 旋转），返回铺满模式下的落位（含缩放系数）。
   *
 * 铺满模式：盒子用百分比铺满屏幕（left/top/width/height 都是 %，
 * 四周在 fit 里让出固定 gap，不贴边）。屏幕多宽多高就撑多宽多高。
 * 同时把缩放系数写进 CSS 变量 --sf-k，
 * 供卡片标题栏高度、标题字号、图表字号按比例跟随。
   */
  function place(el: HTMLElement, r: ComponentItem['rect']): Slot | null {
    if (fill && lay) {
      const s = lay.place(r)
      el.style.left = s.left
      el.style.top = s.top
      el.style.width = s.width
      el.style.height = s.height
      el.style.transformOrigin = '0 0'
      el.style.transform = r.rotate ? `rotate(${r.rotate}deg)` : ''
      el.style.setProperty('--sf-k', String(Math.round(s.k * 1000) / 1000))
      return s
    }
    el.style.left = r.x + 'px'
    el.style.top = r.y + 'px'
    el.style.width = r.w + 'px'
    el.style.height = r.h + 'px'
    el.style.transform = r.rotate ? `rotate(${r.rotate}deg)` : ''
    el.style.removeProperty('--sf-k')
    return null
  }

  /** 当前卡片相对设计稿的缩放系数（非铺满模式恒为 1） */
  function kOf(r: ComponentItem['rect']): number {
    if (!fill || !lay) return 1
    return lay.place(r).k
  }

  /**
   * 内容层（.sf-fit）：
   *   铺满模式 —— 保持设计稿像素尺寸，按 k 等比缩放并在盒子内居中，
   *              圆不被压扁、文字不被拉长，多出来的空间留在盒子内；
   *   编辑模式 —— 100% 铺满节点（与设计稿 1:1）。
   */
  function placeInner(el: HTMLElement, r: ComponentItem['rect']): void {
    const f = el.querySelector('.sf-fit') as HTMLElement | null
    if (!f) return
    f.style.position = 'absolute'
    f.style.left = '0'
    f.style.top = '0'
    if (fill && lay) {
      const s = lay.place(r)
      f.style.width = r.w + 'px'
      f.style.height = r.h + 'px'
      f.style.transformOrigin = '0 0'
      f.style.transform = `translate(${s.dx}px,${s.dy}px) scale(${s.k})`
    } else {
      f.style.width = '100%'
      f.style.height = '100%'
      f.style.transform = ''
    }
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
      rec = { el, chart: null, type: null, theme: null, pending: false, latest: null, dead: false, serial: 0, visible: true, comp: null, k: 1 }
      nodes[c.id] = rec
    }
    const node = rec.el
    place(node, c.rect)
    node.dataset.type = c.type
    node.style.zIndex = String(c.z || 1)
    node.style.display = c.hidden ? 'none' : 'block'
    const wasVisible = rec.visible
    rec.visible = !c.hidden

    const isChart = !!CHART_TYPES[c.type]
    if (rec.type !== c.type || rec.theme !== schema.page.theme) {
      if (rec.chart) { rec.chart.dispose(); rec.chart = null }
      unqueue(rec) // 类型/主题变化 → 外壳重建，排队中的初始化作废
      node.innerHTML = ''
      rec.type = c.type
      rec.theme = schema.page.theme
    }

    if (isChart) {
      // 图表字号 / 点径跟着卡片大小走（填满卡片后，绝对像素字号在大屏上会偏小）
      const ks = kOf(c.rect)
      rec.comp = c
      if (rec.pending) {
        // 图表还在分帧队列中：只刷新出队时要用的最新配置（外壳已在上次调度时渲染）
        scheduleChart(rec, c)
        placeInner(node, c.rect)
        return
      }
      if (!rec.chart) {
        // 首次出现：外壳立即上屏（标题/边框可见），图表本体走 rAF 队列分帧初始化
        node.innerHTML = card(c, t, CHART_SHELL)
        scheduleChart(rec, c)
        placeInner(node, c.rect)
      } else {
        const tt = node.querySelector('.sf-card-title')
        if (tt) tt.textContent = (c.props.title as string) || c.name
        // 尺寸校准：只在「隐藏 → 显示」这一次做。
        // 隐藏期间卡片尺寸仍可在面板里改（Inspector 的 W/H），而 updateLayout 只在
        // 拖拽/改尺寸时被调用，canvas 会停在隐藏前的尺寸；这里补一次对齐。
        // 加 wasVisible 判断是为了不污染常规 update —— 避免每次改配置都读布局触发 reflow。
        const host = node.querySelector('.sf-chart') as HTMLElement | null
        if (host && !wasVisible && rec.visible &&
          (rec.chart.getWidth() !== host.clientWidth || rec.chart.getHeight() !== host.clientHeight)) {
          rec.chart.resize()
        }
        placeInner(node, c.rect)
        rec.chart.setOption(buildOption(c, t, ks) as never, true)
        rec.k = ks
      }
    } else {
      // 有面板的物料：外框（背景/边框/四角）铺满盒子，内容放 .sf-fit 里等比缩放
      const framed = c.type === 'deco.number' || c.type === 'deco.rank' || c.type === 'deco.scrollList'
      node.innerHTML =
        (framed
          ? `<div class="sf-frame" style="position:absolute;inset:0;background:${t.panel};border:1px solid ${t.panelBorder};border-radius:4px;overflow:hidden">${corners(t)}`
          : '') +
        `<div class="sf-fit" style="position:absolute;left:0;top:0;width:100%;height:100%">${domHTML(c, t)}</div>` +
        (framed ? '</div>' : '')
      placeInner(node, c.rect)
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
    if (fill) {
      // 铺满模式：内容层直接撑满父容器，组件按百分比落位
      root.style.width = '100%'
      root.style.height = '100%'
    } else {
      root.style.width = schema.page.width + 'px'
      root.style.height = schema.page.height + 'px'
    }
    // 页面背景：编辑器画布自己画；预览 / 导出由外层全屏容器承担（paintBackground=false）
    root.style.background = paintBackground ? pageBackground(schema, t) : 'transparent'
    if (paintBackground) {
      // background 简写会重置 size/position/repeat，必须随后单独设一次
      root.style.backgroundSize = 'cover'
      root.style.backgroundPosition = 'center'
      root.style.backgroundRepeat = 'no-repeat'
    }
    computeLayout()
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

  /**
   * 容器尺寸变化后刷新图表。
   *
   * 尺寸变了必须 resize；字号 / 点径是按卡片大小算出来的，
   * 但拖动窗口时每帧重算 option 会明显卡顿 —— 所以缩放系数变化超过 2% 才重建，
   * 并且关掉动画（尺寸变化不该重播入场动画）。
   */
  function refreshChart(rec: NodeRec, c: ComponentItem): void {
    if (!rec.chart) return
    rec.chart.resize()
    const ks = kOf(c.rect)
    if (Math.abs(ks - rec.k) < Math.max(0.02, rec.k * 0.02)) return
    rec.k = ks
    rec.chart.setOption({ ...buildOption(c, tok(), ks), animation: false } as never, true)
  }

  /**
   * 局部更新：只重渲染一个组件（配置面板改字段时用）。
   * 不改几何 → 不重算布局；命中 nodes[id] 复用 DOM 外壳与 echarts 实例。
   */
  function patch(id: string): void {
    const c = (schema.components || []).find((x) => x.id === id)
    if (c) renderComp(c)
  }

  function updateLayout(next: ScreenSchema): void {
    schema = next
    // 拖拽改位置可能改变内容区范围（百分比基准），先重算再摆放
    computeLayout()
    ;(schema.components || []).forEach((c) => {
      const rec = nodes[c.id]
      if (!rec) return
      place(rec.el, c.rect)
      placeInner(rec.el, c.rect)
      rec.el.style.zIndex = String(c.z || 1)
      rec.el.style.display = c.hidden ? 'none' : 'block'
      rec.comp = c
      refreshChart(rec, c)
    })
  }

  /** 容器尺寸变化：重算布局 → 重新落位 → 图表 resize（必要时重建 option 刷新字号） */
  function resize(): void {
    computeLayout()
    if (fill) {
      ;(schema.components || []).forEach((c) => {
        const rec = nodes[c.id]
        if (!rec) return
        place(rec.el, c.rect)
        placeInner(rec.el, c.rect)
        rec.comp = c
        refreshChart(rec, c)
      })
      return
    }
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

  return { update, updateLayout, patch, resize, dispose, buildOption: (c, t) => buildOption(c, t || tok()) }
}
