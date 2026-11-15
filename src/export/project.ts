/**
 * ============================================================
 * 导出 Vue / React 工程
 * ============================================================
 * 产物结构（以 Vue 为例，React 同构）：
 *
 *   screen-vue/
 *   ├── package.json          依赖：vue + echarts（+ vite）
 *   ├── vite.config.js
 *   ├── index.html
 *   ├── README.md             使用说明
 *   └── src/
 *       ├── main.ts           入口：注册 ECharts、引入全局样式、（按需）注册地图
 *       ├── App.vue           ★ 主页面：1920×1080 容器 + 自适应缩放 + 编排所有子组件
 *       ├── screen.css        全局样式：主题色已固化为字面量
 *       ├── components/
 *       │   ├── Widget01_Title.vue     ★ 每个大屏组件一个文件
 *       │   ├── Widget05_Map.vue       （图表 option 固化为字面量）
 *       │   └── ...
 *       └── assets/
 *           └── china.json    （仅当大屏用到了地图时生成）
 *
 * 代码生成哲学（DESIGN.md §9）：
 *   - option / 数据 / 颜色全部固化为「字面量」，开发者拿到即可读可改；
 *   - 布局 = App 主页面里的绝对定位包裹层（left/top/width/height/z-index）；
 *   - 动效（时钟、滚动列表）生成真实可运行的 hooks 代码。
 */

import JSZip from 'jszip'
import type { ComponentItem, ScreenSchema } from '../core/schema'
import { THEMES, al, type ThemeToken } from '../core/themes'
import { buildOption, fmtNum } from '../core/option'
import { downloadBlob } from './exportHtml'

/* ============================ 公共工具 ============================ */

/** 图表类物料类型 */
const CHART_TYPES = ['echarts.line', 'echarts.bar', 'echarts.pie', 'echarts.gauge', 'echarts.map', 'echarts.radar']

/** 物料类型 → 组件名后缀 */
const TYPE_SLUG: Record<string, string> = {
  'echarts.line': 'Line', 'echarts.bar': 'Bar', 'echarts.pie': 'Pie',
  'echarts.gauge': 'Gauge', 'echarts.map': 'Map', 'echarts.radar': 'Radar',
  'deco.number': 'Number', 'deco.rank': 'Rank', 'deco.scrollList': 'ScrollList',
  'deco.title': 'Title', 'deco.clock': 'Clock',
}

const STATUS_COLOR = { ok: '#00D9A0', warn: '#FFC94A', err: '#FF5B6E' }
const STATUS_TEXT = { ok: '正常', warn: '预警', err: '告警' }

function pad2(n: number): string { return n < 10 ? '0' + n : String(n) }

/** 页面背景（与渲染器 update() 中的默认背景一致） */
function bgCss(t: ThemeToken, schema: ScreenSchema): string {
  return schema.page.background ||
    `radial-gradient(130% 95% at 50% 0%,${t.panel} 0%,${t.bg} 62%)`
}

/** 有面板外框（能拉伸）的物料；标题、时钟是无边框装饰 */
const NO_FRAME: Record<string, boolean> = { 'deco.title': true, 'deco.clock': true }

/**
 * 生成 BOXES 字面量 —— 每个组件的设计稿矩形 + 层级 + 是否带外框。
 * 布局算法（src/lib/fit.js）按这些矩形算出百分比位置，再按盒子尺寸算内容缩放。
 */
function boxesLiteral(comps: ComponentItem[]): string {
  const rows = comps.map((c) => {
    const r = c.rect
    const f = [
      `x: ${r.x}`, `y: ${r.y}`, `w: ${r.w}`, `h: ${r.h}`,
      `z: ${c.z || 1}`,
      `card: ${NO_FRAME[c.type] ? 'false' : 'true'}`,
    ]
    if (r.rotate) f.push(`rotate: ${r.rotate}`)
    return `  { ${f.join(', ')} },`
  })
  return rows.join('\n')
}

/**
 * 生成 src/lib/fit.js —— 铺满屏幕的布局算法（与编辑器 core/fit.ts 同一套规则）。
 * 单独成文件而不是塞进 App：换适配策略只改这一处。
 * 注意：这里用纯 JS 字符串拼接，避免与外层模板字符串冲突。
 */
function fitJs(): string {
  return `/**
 * 铺满屏幕布局 —— ScreenForge 生成，规则与编辑器 core/fit.ts 一致
 *
 *   ① 组件盒子用百分比：left/top/width/height 相对「视口」，
 *      屏幕多宽多高，盒子就撑多宽多高，不裁切；
 *      整块内容四周留一圈固定像素留白（EDGE_GAP），不贴屏幕边；
 *   ② 图表卡片：图表容器撑满卡片，网格 / 半径按百分比自适应；
 *      饼图、仪表盘、雷达图的半径按容器短边取长度 ⇒ 容器再宽，圆仍是正圆；
 *   ②' DOM 卡片：内容层保持设计稿像素尺寸，按 k 等比缩放并居中
 *      （k = min(盒宽/设计宽, 盒高/设计高)）⇒ 文字排版不被打散；
 *   ③ 跨满整屏的装饰元素（通栏标题、整屏底色）强制占满留白内区。
 *
 * 于是「盒子自适应屏幕 + 盒子内容保持比例」两者同时成立：
 * 视频墙/超宽屏上卡片自动变宽变高，卡片里的图表不会变形成椭圆。
 */

/** 屏幕四周固定留白（px）：小屏按短边 2.5% 收窄 */
export const EDGE_GAP = 24

/** 「跨满整屏」的判定阈值（通栏标题、整屏底色） */
const SPAN_RATIO = 0.97

/** 百分比字符串 */
function pct(v) {
  return Math.round(v * 10000) / 10000 + '%'
}

/**
 * @param W 设计稿宽  @param H 设计稿高
 * @param vw 视口宽   @param vh 视口高
 * @param boxes [{ x, y, w, h }] 参与布局的组件（隐藏的请先过滤掉）
 * @param pad 四周固定留白（px），默认 EDGE_GAP
 */
export function computeFill(W, H, vw, vh, boxes, pad = EDGE_GAP) {
  const items = boxes.filter((b) => b.w > 0 && b.h > 0)

  // 内容区：剔除页面四周留白，让内容顶到留白的内边缘
  const xs = items.filter((b) => b.w < W * SPAN_RATIO)
  const ys = items.filter((b) => b.h < H * SPAN_RATIO)
  const xsSrc = xs.length ? xs : items
  const ysSrc = ys.length ? ys : items

  let x0 = Infinity
  let x1 = -Infinity
  let y0 = Infinity
  let y1 = -Infinity
  for (const b of xsSrc) {
    if (b.x < x0) x0 = b.x
    if (b.x + b.w > x1) x1 = b.x + b.w
  }
  for (const b of ysSrc) {
    if (b.y < y0) y0 = b.y
    if (b.y + b.h > y1) y1 = b.y + b.h
  }
  if (!isFinite(x0) || !isFinite(y0)) {
    x0 = 0; x1 = W; y0 = 0; y1 = H
  }
  const bw = Math.max(1, x1 - x0)
  const bh = Math.max(1, y1 - y0)

  // 四周留白：固定像素，小屏按短边 2.5% 收窄
  const gap = Math.max(0, Math.min(pad, Math.min(vw, vh) * 0.025))
  const innerW = Math.max(1, vw - gap * 2)
  const innerH = Math.max(1, vh - gap * 2)

  return {
    bbox: { x: x0, y: y0, w: bw, h: bh },
    gap,
    place(r) {
      const spanX = r.w >= W * SPAN_RATIO
      const spanY = r.h >= H * SPAN_RATIO
      // 相对内容区的比例（0~1）：跨满整屏的元素直接占满留白内区
      const relL = spanX ? 0 : (r.x - x0) / bw
      const relW = spanX ? 1 : r.w / bw
      const relT = spanY ? 0 : (r.y - y0) / bh
      const relH = spanY ? 1 : r.h / bh

      // 盒子真实像素尺寸（留白内区里按比例铺开）
      const slotW = relW * innerW
      const slotH = relH * innerH
      // 换回相对整个视口的百分比：盒子仍是纯百分比定位，但已让出四周 gap
      const leftPct = vw ? ((gap + relL * innerW) / vw) * 100 : 0
      const topPct = vh ? ((gap + relT * innerH) / vh) * 100 : 0
      const widthPct = vw ? (slotW / vw) * 100 : 100
      const heightPct = vh ? (slotH / vh) * 100 : 100

      const k = Math.min(slotW / r.w, slotH / r.h) || 1
      return {
        left: pct(leftPct),
        top: pct(topPct),
        width: pct(widthPct),
        height: pct(heightPct),
        k,
        dx: Math.round((slotW - r.w * k) / 2),
        dy: Math.round((slotH - r.h * k) / 2),
      }
    },
  }
}

/** 会随卡片缩放的视觉尺寸键（与编辑器 core/option.ts 的 SCALED_KEYS 一致） */
const SCALED_KEYS = ['fontSize', 'lineHeight', 'symbolSize', 'itemWidth', 'itemHeight', 'itemGap', 'barWidth', 'barMaxWidth', 'borderWidth']

/**
 * 递归缩放 option 里的字号 / 点径（返回新对象，不改入参）。
 * 图表容器填满卡片后，ECharts 的百分比尺寸会自适应，但字号是绝对像素，
 * 不缩放的话 4K 上小得看不清、小屏上又会挤在一起。
 */
export function scaleText(node, s) {
  if (!node || s === 1 || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map((v) => scaleText(v, s))
  const out = {}
  for (const k of Object.keys(node)) {
    const v = node[k]
    if (typeof v === 'number' && SCALED_KEYS.indexOf(k) >= 0) out[k] = Math.round(v * s * 100) / 100
    else if (v && typeof v === 'object') out[k] = scaleText(v, s)
    else out[k] = v
  }
  return out
}

`
}

/** 子组件文件基名，如 Widget01_Title */
function compBase(c: ComponentItem, i: number): string {
  return `Widget${pad2(i + 1)}_${TYPE_SLUG[c.type] || 'Comp'}`
}

/** 四角发光边框 HTML（DOM 类组件共用） */
function cornersHtml(): string {
  return '<i class="sf-c tl"></i><i class="sf-c tr"></i><i class="sf-c bl"></i><i class="sf-c br"></i>'
}

/* ============================ 全局样式 ============================ */

/**
 * 生成 screen.css：所有主题色固化为字面量。
 * 图表的颜色在 option 字面量里；这里负责 DOM 组件的样式。
 */
function screenCss(t: ThemeToken, schema: ScreenSchema): string {
  return `/* ============================================================
 * ScreenForge 生成 —— 全局样式
 * 主题「${t.label}」已固化为字面量；改色请直接替换下面的值。
 * ============================================================ */
body { margin: 0; overflow: hidden; background: ${t.bg}; }

/* ---------- 页面骨架：铺满屏幕 ----------
 * .abs  组件盒子：left/top/width/height 由 src/lib/fit.js 写成百分比，
 *       屏幕多宽多高就撑多宽多高，四周让出一圈固定留白（EDGE_GAP）不贴边；
 * .fill 图表类卡片：撑满盒子 —— 图表随卡片一起铺满宽高；
 * .fit  DOM 类卡片（数字 / 排行榜 / 列表）：保持设计稿尺寸等比缩放居中。
 *      --sf-k 是盒子相对设计稿的缩放系数，标题栏高度、字号按它跟随。
 */
.viewport { position: fixed; inset: 0; overflow: hidden; background: ${bgCss(t, schema)}; background-size: cover; background-position: center; background-repeat: no-repeat; }
.screen { position: absolute; inset: 0; }
.abs { position: absolute; overflow: hidden; box-sizing: border-box; }
/* 卡片外框铺满盒子（背景 / 边框 / 四角随屏幕拉伸） */
.abs.card { background: ${t.panel}; border: 1px solid ${t.panelBorder}; border-radius: 4px; }
.fill { position: absolute; inset: 0; }
.fit { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
/* 外框已由 .abs.card 提供：面板只画内容，避免双边框、双四角 */
.abs.card > .fit > .sf-panel,
.abs.card > .fill > .sf-panel { background: transparent; border-color: transparent; border-radius: 0; }
.abs.card > .fit > .sf-panel > .sf-c { display: none; }

/* ---------- 卡片公共外壳 ---------- */
.sf-panel { width: 100%; height: 100%; box-sizing: border-box; position: relative; background: ${t.panel}; border: 1px solid ${t.panelBorder}; border-radius: 4px; overflow: hidden; }
.sf-panel-title { margin-bottom: 10px; font-size: 13px; font-weight: 500; color: ${t.text}; }

/* 图表卡片：标题栏 + 顶部光线 + 四角（与渲染器 card() 一致）
 * 高度 / 字号都乘 --sf-k：卡片变大时标题栏跟着变高，字也跟着变大；
 * 图表容器 .sf-chart-box 填满剩余区域 ⇒ 图表随卡片铺满，圆由 ECharts 按短边自适应。 */
.sf-card-head { position: absolute; left: 0; top: 0; right: 0; height: calc(42px * var(--sf-k, 1)); display: flex; align-items: center; gap: calc(8px * var(--sf-k, 1)); padding: 0 calc(14px * var(--sf-k, 1)); }
.sf-card-tick { display: block; width: calc(3px * var(--sf-k, 1)); height: calc(13px * var(--sf-k, 1)); background: ${t.accent}; box-shadow: 0 0 6px ${al(t.accent, .8)}; }
.sf-card-title { font-size: calc(15px * var(--sf-k, 1)); font-weight: 500; letter-spacing: .5px; color: ${t.text}; }
.sf-topline { position: absolute; left: 8%; right: 8%; top: 0; height: 1px; background: linear-gradient(90deg, transparent, ${al(t.accent, .9)}, transparent); pointer-events: none; }
.sf-wash { position: absolute; left: 0; top: 0; right: 0; height: calc(52px * var(--sf-k, 1)); background: linear-gradient(180deg, ${al(t.accent, .06)}, transparent); pointer-events: none; }
.sf-chart-box { position: absolute; left: 0; top: calc(42px * var(--sf-k, 1)); right: 0; bottom: 0; }

/* ---------- 四角发光边框 ---------- */
.sf-c { position: absolute; width: 9px; height: 9px; pointer-events: none; box-shadow: 0 0 6px ${al(t.accent, .55)}; }
.sf-c.tl { left: 0; top: 0; border-left: 2px solid ${t.accent}; border-top: 2px solid ${t.accent}; }
.sf-c.tr { right: 0; top: 0; border-right: 2px solid ${t.accent}; border-top: 2px solid ${t.accent}; }
.sf-c.bl { left: 0; bottom: 0; border-left: 2px solid ${t.accent}; border-bottom: 2px solid ${t.accent}; }
.sf-c.br { right: 0; bottom: 0; border-right: 2px solid ${t.accent}; border-bottom: 2px solid ${t.accent}; }

/* ---------- 数字翻牌 ---------- */
.sf-num { padding: 20px 22px; }
.sf-num-head { display: flex; justify-content: space-between; align-items: center; }
.sf-num-label { font-size: 13px; letter-spacing: 1px; color: ${t.sub}; }
.sf-num-dot { display: block; width: 6px; height: 6px; border-radius: 50%; background: ${t.accent}; box-shadow: 0 0 7px ${al(t.accent, .9)}; }
.sf-num-row { margin-top: 16px; display: flex; align-items: baseline; gap: 7px; }
.sf-num-value { font-size: 36px; font-weight: 600; line-height: 1; font-variant-numeric: tabular-nums; background: linear-gradient(180deg, ${t.text} 30%, ${al(t.accent, .85)}); -webkit-background-clip: text; background-clip: text; color: transparent; }
.sf-num-unit { font-size: 13px; color: ${t.sub}; }
.sf-num-delta { margin-top: 12px; font-size: 12px; }
.sf-num-sub { color: ${t.sub}; margin-left: 6px; }

/* ---------- 排行榜 ---------- */
.sf-rank { padding: 16px 18px; }
.sf-rank-title { margin-bottom: 14px; font-size: 13px; font-weight: 500; color: ${t.text}; }
.sf-rank-row { display: flex; align-items: center; gap: 10px; margin-bottom: 13px; }
.sf-rank-idx { font-size: 12px; font-weight: 500; width: 18px; color: ${t.sub}; }
.sf-rank-grow { flex: 1; min-width: 0; }
.sf-rank-line { display: flex; justify-content: space-between; font-size: 12px; color: ${t.text}; margin-bottom: 6px; }
.sf-rank-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sf-rank-val { color: ${t.sub}; font-variant-numeric: tabular-nums; }
.sf-rank-track { height: 4px; background: ${t.grid}; border-radius: 2px; overflow: hidden; }
.sf-rank-bar { height: 100%; }

/* ---------- 滚动列表 ---------- */
.sf-list { padding: 14px 16px; }
.sf-list-title { margin-bottom: 10px; font-size: 13px; font-weight: 500; color: ${t.text}; }
.sf-list-head { display: flex; align-items: center; gap: 10px; height: 26px; padding: 0 6px; font-size: 11.5px; font-weight: 500; color: ${t.sub}; border-bottom: 1px solid ${t.panelBorder}; margin-bottom: 6px; }
.sf-list-scroll { position: absolute; left: 16px; right: 16px; top: 70px; bottom: 12px; overflow: hidden; }
.sf-list-inner { will-change: transform; }
.sf-list-row { display: flex; align-items: center; gap: 10px; height: 34px; padding: 0 6px; border-radius: 3px; margin-bottom: 4px; }
.sf-list-idx { font-size: 12px; font-weight: 500; width: 20px; color: ${t.sub}; }
.sf-list-name { flex: 1; min-width: 0; font-size: 12.5px; color: ${t.text}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sf-list-val { font-size: 12px; color: ${t.sub}; font-variant-numeric: tabular-nums; }
.sf-list-tag { font-size: 10.5px; font-weight: 500; padding: 3px 0; border-radius: 3px; width: 44px; text-align: center; white-space: nowrap; }

/* ---------- 标题 ---------- */
.sf-title-box { width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.sf-title-row { display: flex; align-items: center; gap: 26px; }
.sf-title-main { font-size: 38px; font-weight: 600; letter-spacing: 7px; text-indent: 7px; background: linear-gradient(90deg, ${t.palette[0]}, ${t.text} 50%, ${t.palette[1]}); -webkit-background-clip: text; background-clip: text; color: transparent; }
.sf-title-wing { position: relative; width: 110px; height: 2px; }
.sf-title-wing.l { background: linear-gradient(90deg, transparent, ${al(t.accent, .85)}); }
.sf-title-wing.r { background: linear-gradient(90deg, ${al(t.accent, .85)}, transparent); }
.sf-title-wing.l::after, .sf-title-wing.r::before { content: ''; position: absolute; top: -2.5px; width: 7px; height: 7px; background: ${t.accent}; transform: rotate(45deg); box-shadow: 0 0 9px ${al(t.accent, .9)}; }
.sf-title-wing.l::after { right: -16px; }
.sf-title-wing.r::before { left: -16px; }
.sf-title-sub { margin-top: 9px; font-size: 12px; color: ${t.sub}; letter-spacing: 4px; }
.sf-title-line { margin-top: 14px; width: 160px; height: 2px; background: linear-gradient(90deg, transparent, ${t.accent}, transparent); box-shadow: 0 0 8px ${al(t.accent, .6)}; }

/* ---------- 时钟 ---------- */
.sf-clock-box { width: 100%; height: 100%; display: flex; align-items: center; justify-content: flex-end; gap: 12px; padding: 0 4px; }
.sf-clock-time { font-size: 16px; font-weight: 500; color: ${t.text}; font-variant-numeric: tabular-nums; letter-spacing: 1px; }
.sf-clock-date { font-size: 12px; color: ${t.sub}; }
`
}

/* ============================ Vue 组件模板 ============================ */

/** 图表组件：option 固化为字面量，地图组件无需自行注册（入口统一注册） */
function vueChart(c: ComponentItem, t: ThemeToken): string {
  const optionStr = JSON.stringify(buildOption(c, t), null, 2)
  const title = String((c.props || {}).title || c.name)
  return `<!-- ${c.name} · ${c.rect.w} × ${c.rect.h} · ScreenForge 导出 -->
<template>
  <div class="sf-panel">
    <i class="sf-topline" /><i class="sf-wash" />
    <div class="sf-card-head"><i class="sf-card-tick" /><span class="sf-card-title">${title}</span></div>
    <div ref="el" class="sf-chart-box" />
    ${cornersHtml()}
  </div>
</template>

<script setup lang="ts">
// echarts 走按需注册出口（src/lib/echarts.ts），产物更小
import echarts from '../lib/echarts'
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { scaleText } from '../lib/fit'

const el = ref<HTMLDivElement>()
let chart: echarts.ECharts | null = null

// 设计稿里这张卡片的尺寸（含标题栏）：用来算字号缩放系数
const W = ${c.rect.w}
const H = ${c.rect.h}

// 配置项固化为字面量：改样式直接改这里；接接口请替换数据后重新 setOption
const option = ${optionStr}

let lastK = 0

// 卡片填满屏幕后尺寸会变：resize 容器 + 字号按 k 重算。
// 变化小于 2% 只 resize 不重建 option —— 拖动窗口时每帧 setOption 会明显卡顿。
const apply = (animate: boolean) => {
  if (!chart || !el.value) return
  const box = el.value.parentElement as HTMLElement
  const k = Math.min(box.clientWidth / W, box.clientHeight / H) || 1
  chart.resize()
  if (Math.abs(k - lastK) < Math.max(0.02, lastK * 0.02)) return
  lastK = k
  chart.setOption(animate ? scaleText(option, k) : { ...scaleText(option, k), animation: false }, true)
}

const onResize = () => apply(false)

onMounted(() => {
  chart = echarts.init(el.value!)
  apply(true)
  window.addEventListener('resize', onResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  chart?.dispose()
})
</script>
`
}

/** 数字翻牌：纯模板组件（数值在模板里直接改） */
function vueNumber(c: ComponentItem, t: ThemeToken): string {
  const p = c.props || {}
  const dcol = p.dir === 'up' ? '#FF5B6E' : p.dir === 'down' ? '#00D9A0' : t.sub
  const arrow = p.dir === 'up' ? '▲ ' : p.dir === 'down' ? '▼ ' : ''
  return `<!-- ${c.name} · ${c.rect.w} × ${c.rect.h} · ScreenForge 导出 -->
<template>
  <div class="sf-panel sf-num">
    <div class="sf-num-head">
      <span class="sf-num-label">${p.label || ''}</span>
      <i class="sf-num-dot" />
    </div>
    <div class="sf-num-row">
      <span class="sf-num-value">${fmtNum(Number(p.value) || 0, Number(p.dec) || 0)}</span>
      <span class="sf-num-unit">${p.unit || ''}</span>
    </div>
    ${p.delta ? `<div class="sf-num-delta" style="color: ${dcol}">${arrow}${p.delta}${p.dir ? ' <span class="sf-num-sub">较昨日</span>' : ''}</div>` : ''}
    ${cornersHtml()}
  </div>
</template>
`
}

/** 排行榜：数据 + 配色以 script 常量呈现，v-for 渲染 */
function vueRank(c: ComponentItem, t: ThemeToken): string {
  const p = c.props || {}
  const d = (c.data || {}) as { items?: { name: string; value: number }[] }
  const items = (d.items || []).slice(0, Number(p.top) || 5)
  return `<!-- ${c.name} · ${c.rect.w} × ${c.rect.h} · ScreenForge 导出 -->
<template>
  <div class="sf-panel sf-rank">
    <div class="sf-rank-title">${p.title || c.name}</div>
    <div v-for="(it, i) in items" :key="i" class="sf-rank-row">
      <span class="sf-rank-idx" :style="{ color: i < 3 ? accent : '' }">{{ String(i + 1).padStart(2, '0') }}</span>
      <div class="sf-rank-grow">
        <div class="sf-rank-line">
          <span class="sf-rank-name">{{ it.name }}</span>
          <span class="sf-rank-val">{{ it.value.toLocaleString() }}</span>
        </div>
        <div class="sf-rank-track">
          <div class="sf-rank-bar" :style="barStyle(i, it.value)" />
        </div>
      </div>
    </div>
    ${cornersHtml()}
  </div>
</template>

<script setup lang="ts">
// 数据在此维护；接接口时替换 items 即可
const items = ${JSON.stringify(items)}
const max = Math.max(...items.map(i => i.value), 1)
const accent = '${t.accent}'
const colors = ${JSON.stringify(t.palette)}

const colorOf = (i) => colors[i % colors.length]
const barStyle = (i: number, v: number) => ({
  width: (v / max) * 100 + '%',
  background: 'linear-gradient(90deg, ' + colorOf(i) + ', ' + colorOf(i) + '4D)',
  boxShadow: '0 0 6px ' + colorOf(i) + '80',
})
</script>
`
}

/** 滚动列表：带真实可运行的 setInterval 循环滚动 */
function vueScrollList(c: ComponentItem, t: ThemeToken): string {
  const p = c.props || {}
  const d = (c.data || {}) as { items?: { name: string; value: string; status: string }[] }
  const items = d.items || []
  const spd = (Number(p.speed) || 2) * 0.5
  return `<!-- ${c.name} · ${c.rect.w} × ${c.rect.h} · ScreenForge 导出 -->
<template>
  <div class="sf-panel sf-list">
    <div class="sf-list-title">${p.title || c.name}</div>
    <div class="sf-list-head">
      <span style="width: 20px" /><span class="sf-list-name" style="flex: 1">名称</span>
      <span>指标</span><span class="sf-list-tag" style="width: 46px; text-align: center">状态</span>
    </div>
    <div class="sf-list-scroll">
      <div ref="inner" class="sf-list-inner">
        <div v-for="(it, i) in loop" :key="i" class="sf-list-row" :style="{ background: i % 2 ? accent + '0F' : 'transparent' }">
          <span class="sf-list-idx" :style="{ color: (i % items.length) < 3 ? accent : '' }">{{ String((i % items.length) + 1).padStart(2, '0') }}</span>
          <span class="sf-list-name">{{ it.name }}</span>
          <span class="sf-list-val">{{ it.value }}</span>
          <span class="sf-list-tag" :style="{ color: statusColor[it.status] || statusColor.ok, border: '1px solid ' + (statusColor[it.status] || statusColor.ok) + '73' }">
            {{ statusText[it.status] || '正常' }}
          </span>
        </div>
      </div>
    </div>
    ${cornersHtml()}
  </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'

// 数据在此维护；内容渲染两遍 + translateY 循环，实现无缝滚动
const items = ${JSON.stringify(items)}
const loop = [...items, ...items]
const statusColor = ${JSON.stringify(STATUS_COLOR)}
const statusText = ${JSON.stringify(STATUS_TEXT)}
const accent = '${t.accent}'

const inner = ref<HTMLElement>()
let off = 0
let half = 0
let timer = 0

onMounted(() => {
  half = inner.value ? inner.value.scrollHeight / 2 : 0
  timer = window.setInterval(() => {
    off += ${spd}
    if (half && off >= half) off = 0
    if (inner.value) inner.value.style.transform = 'translateY(-' + off + 'px)'
  }, 40)
})
onBeforeUnmount(() => clearInterval(timer))
</script>
`
}

/** 标题：纯模板组件 */
function vueTitle(c: ComponentItem, t: ThemeToken): string {
  const p = c.props || {}
  return `<!-- ${c.name} · ${c.rect.w} × ${c.rect.h} · ScreenForge 导出 -->
<template>
  <div class="sf-title-box">
    <div class="sf-title-row">
      <i class="sf-title-wing l" />
      <div class="sf-title-main">${p.text || ''}</div>
      <i class="sf-title-wing r" />
    </div>
    ${p.sub ? `<div class="sf-title-sub">${p.sub}</div>` : ''}
    <div class="sf-title-line" />
  </div>
</template>
`
}

/** 时钟：真实可运行的 setInterval */
function vueClock(c: ComponentItem): string {
  return `<!-- ${c.name} · ${c.rect.w} × ${c.rect.h} · ScreenForge 导出 -->
<template>
  <div class="sf-clock-box">
    <span class="sf-clock-time">{{ time }}</span>
    <span class="sf-clock-date">{{ date }}</span>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'

const time = ref('--:--:--')
const date = ref('----')
let timer = 0

function tick() {
  const n = new Date()
  const pad = (x) => (x < 10 ? '0' : '') + x
  time.value = pad(n.getHours()) + ':' + pad(n.getMinutes()) + ':' + pad(n.getSeconds())
  const wk = '日一二三四五六'.charAt(n.getDay())
  date.value = n.getFullYear() + '-' + pad(n.getMonth() + 1) + '-' + pad(n.getDate()) + ' 周' + wk
}

onMounted(() => { tick(); timer = window.setInterval(tick, 1000) })
onBeforeUnmount(() => clearInterval(timer))
</script>
`
}

/** Vue 组件分发 */
function vueComp(c: ComponentItem, t: ThemeToken): string {
  if (CHART_TYPES.includes(c.type)) return vueChart(c, t)
  if (c.type === 'deco.number') return vueNumber(c, t)
  if (c.type === 'deco.rank') return vueRank(c, t)
  if (c.type === 'deco.scrollList') return vueScrollList(c, t)
  if (c.type === 'deco.title') return vueTitle(c, t)
  if (c.type === 'deco.clock') return vueClock(c)
  return ''
}

/**
 * Vue 主页面 App.vue —— 盒子百分比铺满；图表撑满卡片，DOM 卡片内容等比（见 src/lib/fit.js）
 */
function vueApp(comps: ComponentItem[], names: Record<string, string>, schema: ScreenSchema): string {
  const imports = comps.map((c) =>
    `import ${names[c.id]} from './components/${names[c.id]}.vue'`).join('\n')
  const usages = comps.map((c, i) => {
    // 图表卡片：内容层撑满盒子（.fill），图表随卡片铺满，圆由 ECharts 按短边自适应；
    // DOM 卡片：内容层按设计稿尺寸等比缩放居中（.fit），文字排版不被打散。
    const chart = CHART_TYPES.includes(c.type)
    const body = chart
      ? `<div class="fill"><${names[c.id]} /></div>`
      : `<div class="fit" :style="slots[${i}].inner"><${names[c.id]} /></div>`
    return `      <div class="abs${NO_FRAME[c.type] ? '' : ' card'}" :style="slots[${i}].box">` +
      `${NO_FRAME[c.type] || chart ? '' : cornersHtml()}` + body + `</div>`
  }).join('\n')
  return `<template>
  <div class="viewport">
    <!-- 设计稿 ${schema.page.width}×${schema.page.height}：盒子按百分比铺满；图表撑满卡片，DOM 卡片内容等比居中 -->
    <div class="screen">
${usages}
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { computeFill } from './lib/fit'
${imports}

const W = ${schema.page.width}
const H = ${schema.page.height}

const BOXES = [
${boxesLiteral(comps)}
]

type Slot = { box: Record<string, string>; inner: Record<string, string> }

// 百分比落位：盒子铺满屏幕，内容层按 k 等比缩放居中
function layout(): Slot[] {
  const L = computeFill(W, H, window.innerWidth, window.innerHeight, BOXES)
  return BOXES.map((b) => {
    const s = L.place(b)
    const box: Record<string, string> = {
      left: s.left, top: s.top, width: s.width, height: s.height, zIndex: String(b.z),
      '--sf-k': String(Math.round(s.k * 1000) / 1000),
    }
    if (b.rotate) box.transform = 'rotate(' + b.rotate + 'deg)'
    return {
      box,
      inner: {
        width: b.w + 'px',
        height: b.h + 'px',
        transform: 'translate(' + s.dx + 'px,' + s.dy + 'px) scale(' + s.k + ')',
      },
    }
  })
}

// 首帧就要有尺寸：图表的 canvas 在子组件 onMounted 里初始化，晚一帧会拿到 0×0
const slots = ref<Slot[]>(layout())

function relayout() {
  slots.value = layout()
}

onMounted(() => {
  window.addEventListener('resize', relayout)
})
onBeforeUnmount(() => window.removeEventListener('resize', relayout))
</script>

<!-- 骨架样式见 src/screen.css（全局） -->
`
}

/* ============================ React 组件模板 ============================ */

function reactChart(c: ComponentItem, t: ThemeToken): string {
  const optionStr = JSON.stringify(buildOption(c, t), null, 2)
  const title = String((c.props || {}).title || c.name)
  return `// ${c.name} · ${c.rect.w} × ${c.rect.h} · ScreenForge 导出
import { useEffect, useRef } from 'react'
// echarts 走按需注册出口（src/lib/echarts.ts），产物更小
import echarts from '../lib/echarts'
import { scaleText } from '../lib/fit'

// 设计稿里这张卡片的尺寸（含标题栏）：用来算字号缩放系数
const W = ${c.rect.w}
const H = ${c.rect.h}

// 配置项固化为字面量：改样式直接改这里；接接口请替换数据后重新 setOption
const option = ${optionStr}

export default function Chart() {
  const el = useRef(null)

  useEffect(() => {
    const chart = echarts.init(el.current)
    let lastK = 0

    // 卡片填满屏幕后尺寸会变：resize 容器 + 字号按 k 重算。
    // 变化小于 2% 只 resize 不重建 option —— 拖动窗口时每帧 setOption 会明显卡顿。
    const apply = (animate) => {
      const box = el.current.parentElement
      const k = Math.min(box.clientWidth / W, box.clientHeight / H) || 1
      chart.resize()
      if (Math.abs(k - lastK) < Math.max(0.02, lastK * 0.02)) return
      lastK = k
      chart.setOption(animate ? scaleText(option, k) : { ...scaleText(option, k), animation: false }, true)
    }

    apply(true)
    const onResize = () => apply(false)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      chart.dispose()
    }
  }, [])

  return (
    <div className="sf-panel">
      <i className="sf-topline" /><i className="sf-wash" />
      <div className="sf-card-head">
        <i className="sf-card-tick" /><span className="sf-card-title">${title}</span>
      </div>
      <div ref={el} className="sf-chart-box" />
      <i className="sf-c tl" /><i className="sf-c tr" /><i className="sf-c bl" /><i className="sf-c br" />
    </div>
  )
}
`
}

function reactNumber(c: ComponentItem, t: ThemeToken): string {
  const p = c.props || {}
  const dcol = p.dir === 'up' ? '#FF5B6E' : p.dir === 'down' ? '#00D9A0' : t.sub
  const arrow = p.dir === 'up' ? '▲ ' : p.dir === 'down' ? '▼ ' : ''
  return `// ${c.name} · ${c.rect.w} × ${c.rect.h} · ScreenForge 导出
export default function NumberCard() {
  return (
    <div className="sf-panel sf-num">
      <div className="sf-num-head">
        <span className="sf-num-label">${p.label || ''}</span>
        <i className="sf-num-dot" />
      </div>
      <div className="sf-num-row">
        <span className="sf-num-value">${fmtNum(Number(p.value) || 0, Number(p.dec) || 0)}</span>
        <span className="sf-num-unit">${p.unit || ''}</span>
      </div>
      ${p.delta ? `<div className="sf-num-delta" style={{ color: '${dcol}' }}>${arrow}${p.delta}${p.dir ? ' <span className="sf-num-sub">较昨日</span>' : ''}</div>` : ''}
      <i className="sf-c tl" /><i className="sf-c tr" /><i className="sf-c bl" /><i className="sf-c br" />
    </div>
  )
}
`
}

function reactRank(c: ComponentItem, t: ThemeToken): string {
  const p = c.props || {}
  const d = (c.data || {}) as { items?: { name: string; value: number }[] }
  const items = (d.items || []).slice(0, Number(p.top) || 5)
  return `// ${c.name} · ${c.rect.w} × ${c.rect.h} · ScreenForge 导出
const items = ${JSON.stringify(items)}
const max = Math.max(...items.map((i) => i.value), 1)
const accent = '${t.accent}'
const colors = ${JSON.stringify(t.palette)}

const colorOf = (i) => colors[i % colors.length]

export default function RankList() {
  return (
    <div className="sf-panel sf-rank">
      <div className="sf-rank-title">${p.title || c.name}</div>
      {items.map((it, i) => (
        <div className="sf-rank-row" key={i}>
          <span className="sf-rank-idx" style={i < 3 ? { color: accent } : undefined}>
            {String(i + 1).padStart(2, '0')}
          </span>
          <div className="sf-rank-grow">
            <div className="sf-rank-line">
              <span className="sf-rank-name">{it.name}</span>
              <span className="sf-rank-val">{it.value.toLocaleString()}</span>
            </div>
            <div className="sf-rank-track">
              <div className="sf-rank-bar" style={{
                width: (it.value / max) * 100 + '%',
                background: 'linear-gradient(90deg, ' + colorOf(i) + ', ' + colorOf(i) + '4D)',
                boxShadow: '0 0 6px ' + colorOf(i) + '80',
              }} />
            </div>
          </div>
        </div>
      ))}
      <i className="sf-c tl" /><i className="sf-c tr" /><i className="sf-c bl" /><i className="sf-c br" />
    </div>
  )
}
`
}

function reactScrollList(c: ComponentItem, t: ThemeToken): string {
  const p = c.props || {}
  const d = (c.data || {}) as { items?: { name: string; value: string; status: string }[] }
  const items = d.items || []
  const spd = (Number(p.speed) || 2) * 0.5
  return `// ${c.name} · ${c.rect.w} × ${c.rect.h} · ScreenForge 导出
import { useEffect, useRef } from 'react'

// 数据在此维护；内容渲染两遍 + translateY 循环，实现无缝滚动
const items = ${JSON.stringify(items)}
const statusColor = ${JSON.stringify(STATUS_COLOR)}
const statusText = ${JSON.stringify(STATUS_TEXT)}
const accent = '${t.accent}'

export default function ScrollList() {
  const inner = useRef(null)

  useEffect(() => {
    let off = 0
    const half = inner.current ? inner.current.scrollHeight / 2 : 0
    const timer = window.setInterval(() => {
      off += ${spd}
      if (half && off >= half) off = 0
      if (inner.current) inner.current.style.transform = 'translateY(-' + off + 'px)'
    }, 40)
    return () => clearInterval(timer)
  }, [])

  const loop = [...items, ...items]

  return (
    <div className="sf-panel sf-list">
      <div className="sf-list-title">${p.title || c.name}</div>
      <div className="sf-list-head">
        <span style={{ width: 20 }} /><span className="sf-list-name" style={{ flex: 1 }}>名称</span>
        <span>指标</span><span className="sf-list-tag" style={{ width: 46, textAlign: 'center' }}>状态</span>
      </div>
      <div className="sf-list-scroll">
        <div ref={inner} className="sf-list-inner">
          {loop.map((it, i) => (
            <div className="sf-list-row" key={i} style={{ background: i % 2 ? accent + '0F' : 'transparent' }}>
              <span className="sf-list-idx" style={(i % items.length) < 3 ? { color: accent } : undefined}>
                {String((i % items.length) + 1).padStart(2, '0')}
              </span>
              <span className="sf-list-name">{it.name}</span>
              <span className="sf-list-val">{it.value}</span>
              <span className="sf-list-tag" style={{
                color: statusColor[it.status] || statusColor.ok,
                border: '1px solid ' + (statusColor[it.status] || statusColor.ok) + '73',
              }}>
                {statusText[it.status] || '正常'}
              </span>
            </div>
          ))}
        </div>
      </div>
      <i className="sf-c tl" /><i className="sf-c tr" /><i className="sf-c bl" /><i className="sf-c br" />
    </div>
  )
}
`
}

function reactTitle(c: ComponentItem): string {
  const p = c.props || {}
  return `// ${c.name} · ${c.rect.w} × ${c.rect.h} · ScreenForge 导出
export default function ScreenTitle() {
  return (
    <div className="sf-title-box">
      <div className="sf-title-row">
        <i className="sf-title-wing l" />
        <div className="sf-title-main">${p.text || ''}</div>
        <i className="sf-title-wing r" />
      </div>
      ${p.sub ? `<div className="sf-title-sub">${p.sub}</div>` : ''}
      <div className="sf-title-line" />
    </div>
  )
}
`
}

function reactClock(): string {
  return `// 时钟 · ScreenForge 导出
import { useEffect, useState } from 'react'

export default function ScreenClock() {
  const [time, setTime] = useState('--:--:--')
  const [date, setDate] = useState('----')

  useEffect(() => {
    const tick = () => {
      const n = new Date()
      const pad = (x) => (x < 10 ? '0' : '') + x
      setTime(pad(n.getHours()) + ':' + pad(n.getMinutes()) + ':' + pad(n.getSeconds()))
      const wk = '日一二三四五六'.charAt(n.getDay())
      setDate(n.getFullYear() + '-' + pad(n.getMonth() + 1) + '-' + pad(n.getDate()) + ' 周' + wk)
    }
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="sf-clock-box">
      <span className="sf-clock-time">{time}</span>
      <span className="sf-clock-date">{date}</span>
    </div>
  )
}
`
}

function reactComp(c: ComponentItem, t: ThemeToken): string {
  if (CHART_TYPES.includes(c.type)) return reactChart(c, t)
  if (c.type === 'deco.number') return reactNumber(c, t)
  if (c.type === 'deco.rank') return reactRank(c, t)
  if (c.type === 'deco.scrollList') return reactScrollList(c, t)
  if (c.type === 'deco.title') return reactTitle(c)
  if (c.type === 'deco.clock') return reactClock()
  return ''
}

/** React 主页面 App.jsx —— 盒子百分比铺满；图表撑满卡片，DOM 卡片内容等比（见 src/lib/fit.js） */
function reactApp(comps: ComponentItem[], names: Record<string, string>, schema: ScreenSchema): string {
  const imports = comps.map((c) =>
    `import ${names[c.id]} from './components/${names[c.id]}'`).join('\n')
  const usages = comps.map((c, i) => {
    const chart = CHART_TYPES.includes(c.type)
    const body = chart
      ? `<div className="fill"><${names[c.id]} /></div>`
      : `<div className="fit" style={slots[${i}].inner}><${names[c.id]} /></div>`
    return `        <div className={'abs${NO_FRAME[c.type] ? '' : ' card'}'} style={slots[${i}].box}>` +
      `${NO_FRAME[c.type] || chart ? '' : cornersHtml()}` + body + `</div>`
  }).join('\n')
  return `// ${schema.page.title} · 主页面 · ScreenForge 导出
import { useEffect, useState } from 'react'
import { computeFill } from './lib/fit'
${imports}

const W = ${schema.page.width}
const H = ${schema.page.height}

// 设计稿 ${schema.page.width}×${schema.page.height}：盒子按百分比铺满；图表撑满卡片，DOM 卡片内容等比居中
const BOXES = [
${boxesLiteral(comps)}
]

// 百分比落位：盒子铺满屏幕，内容层按 k 等比缩放居中
function layout() {
  const L = computeFill(W, H, window.innerWidth, window.innerHeight, BOXES)
  return BOXES.map((b) => {
    const s = L.place(b)
    const box = {
      left: s.left, top: s.top, width: s.width, height: s.height, zIndex: b.z,
      '--sf-k': String(Math.round(s.k * 1000) / 1000),
    }
    if (b.rotate) box.transform = 'rotate(' + b.rotate + 'deg)'
    return {
      box,
      inner: {
        width: b.w + 'px',
        height: b.h + 'px',
        transform: 'translate(' + s.dx + 'px,' + s.dy + 'px) scale(' + s.k + ')',
      },
    }
  })
}

export default function App() {
  // 首帧就要有尺寸：子组件 useEffect 里初始化 canvas，晚一帧会拿到 0×0
  const [slots, setSlots] = useState(layout)

  useEffect(() => {
    const relayout = () => setSlots(layout())
    window.addEventListener('resize', relayout)
    return () => window.removeEventListener('resize', relayout)
  }, [])

  return (
    <div className="viewport">
      <div className="screen">
${usages}
      </div>
    </div>
  )
}
`
}

/* ============================ 工程骨架文件 ============================ */

/**
 * 生成导出工程里的 src/lib/echarts.ts —— ECharts 按需注册的唯一出口。
 * 与编辑器侧 src/core/echarts-setup.ts 保持一致的注册集；
 * 开发者后续在导出工程里新增图表类型时，在这里补一行注册即可。
 */
function echartsSetupCode(): string {
  return `/**
 * ECharts 按需注册 —— 全工程唯一的 echarts 出口
 * 只注册本项目用到的图表 / 组件 / 渲染器，构建产物比全量引入小一半以上。
 * 新增图表类型时在这里补注册即可（列表见 echarts/charts、echarts/components）。
 */
import * as echarts from 'echarts/core'
import {
  LineChart, BarChart, PieChart, GaugeChart, MapChart, RadarChart,
} from 'echarts/charts'
import {
  GridComponent, TooltipComponent, LegendComponent,
  VisualMapComponent, AxisPointerComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([
  LineChart, BarChart, PieChart, GaugeChart, MapChart, RadarChart,
  GridComponent, TooltipComponent, LegendComponent, VisualMapComponent,
  AxisPointerComponent, CanvasRenderer,
])

export default echarts
`
}

function vuePkg(title: string, usesMap: boolean): string {
  return JSON.stringify({
    name: 'screenforge-screen',
    private: true,
    version: '0.1.0',
    type: 'module',
    scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
    dependencies: { echarts: '^5.5.1', vue: '^3.4.0' },
    devDependencies: { '@vitejs/plugin-vue': '^5.0.0', typescript: '^5.4.0', vite: '^5.2.0' },
  }, null, 2) + (usesMap || title ? '' : '')
}

function reactPkg(): string {
  return JSON.stringify({
    name: 'screenforge-screen',
    private: true,
    version: '0.1.0',
    type: 'module',
    scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
    dependencies: { echarts: '^5.5.1', react: '^18.3.1', 'react-dom': '^18.3.1' },
    devDependencies: { '@vitejs/plugin-react': '^4.3.1', vite: '^5.2.0' },
  }, null, 2)
}

function vueReadme(title: string): string {
  return `# ${title}（ScreenForge 导出 · Vue 3 工程）

## 使用

\`\`\`bash
npm install
npm run dev      # 开发预览
npm run build    # 生产构建
\`\`\`

## 结构

- \`src/App.vue\` 主页面：**盒子按百分比铺满屏幕**（图表撑满卡片、DOM 卡片内容等比），编排所有子组件\n- \`src/lib/fit.js\` 铺满布局算法（百分比落位 + 内容缩放系数 + scaleText 字号缩放，换策略只改这一处）
- \`src/components/Widget*.vue\` 每个大屏组件一个文件，配置项固化为字面量
- \`src/screen.css\` 全局样式，主题色已固化为字面量（改色直接替换值）
- \`src/lib/echarts.ts\` ECharts 按需注册出口（新增图表类型在这里补注册）
- \`src/main.ts\` 入口：注册 ECharts 与中国地图 geoJSON

## 改数据

- 图表：打开对应 Widget 文件，修改 \`data\` / 接 fetch 后 \`setOption\`
- 滚动列表 / 排行榜：文件顶部 \`items\` 常量
- 改回编辑器里调整更方便：重新导出即可覆盖
`
}

function reactReadme(title: string): string {
  return `# ${title}（ScreenForge 导出 · React 工程）

## 使用

\`\`\`bash
npm install
npm run dev      # 开发预览
npm run build    # 生产构建
\`\`\`

## 结构

- \`src/App.jsx\` 主页面：**盒子按百分比铺满屏幕**（图表撑满卡片、DOM 卡片内容等比），编排所有子组件\n- \`src/lib/fit.js\` 铺满布局算法（百分比落位 + 内容缩放系数 + scaleText 字号缩放，换策略只改这一处）
- \`src/components/Widget*.jsx\` 每个大屏组件一个文件，配置项固化为字面量
- \`src/screen.css\` 全局样式，主题色已固化为字面量（改色直接替换值）
- \`src/lib/echarts.ts\` ECharts 按需注册出口（新增图表类型在这里补注册）
- \`src/main.jsx\` 入口：注册中国地图 geoJSON

## 改数据

- 图表：打开对应 Widget 文件，修改 \`option\` 里的 series.data 或接 fetch 后 setOption
- 滚动列表 / 排行榜：文件顶部 \`items\` 常量
- 改回编辑器里调整更方便：重新导出即可覆盖
`
}

/* ============================ 对外 API ============================ */

/** 生成工程文件列表（kind: 'vue' | 'react'） */
export function projectFiles(
  kind: 'vue' | 'react',
  schema: ScreenSchema,
  themes: Record<string, ThemeToken>,
  chinaGeoJson?: string,
): { path: string; content: string }[] {
  const t = themes[schema.page.theme] || themes.custom
  // 可见组件按 schema 顺序编号
  const comps = schema.components.filter((c) => !c.hidden)
  const names: Record<string, string> = {}
  comps.forEach((c, i) => { names[c.id] = compBase(c, i) })
  const usesMap = comps.some((c) => c.type === 'echarts.map')
  // geoJSON 全文由调用方（exportProject）按需 fetch 注入，编辑器 bundle 不再静态携带
  const chinaJson = usesMap ? (chinaGeoJson || '') : ''
  const title = schema.page.title || '大屏'
  const files: { path: string; content: string }[] = []

  if (kind === 'vue') {
    files.push({ path: 'package.json', content: vuePkg(title, usesMap) })
    files.push({ path: 'vite.config.js', content: `import { defineConfig } from 'vite'\nimport vue from '@vitejs/plugin-vue'\n\n// base: './' 让 dist 可以部署在任意子路径下\nexport default defineConfig({ base: './', plugins: [vue()] })\n` })
    files.push({ path: 'tsconfig.json', content: `{\n  "compilerOptions": {\n    "target": "ES2020",\n    "module": "ESNext",\n    "moduleResolution": "bundler",\n    "resolveJsonModule": true,\n    "jsx": "preserve",\n    "strict": true,\n    "skipLibCheck": true,\n    "noEmit": true\n  },\n  "include": ["src"]\n}\n` })
    files.push({ path: 'index.html', content: `<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>${title}</title>\n</head>\n<body>\n  <div id="app"></div>\n  <script type="module" src="/src/main.ts"><\/script>\n</body>\n</html>\n` })
    files.push({ path: 'README.md', content: vueReadme(title) })
    files.push({ path: 'src/main.ts', content: mainTs(usesMap) })
    files.push({ path: 'src/lib/echarts.ts', content: echartsSetupCode() })
    files.push({ path: 'src/lib/fit.js', content: fitJs() })
    files.push({ path: 'src/screen.css', content: screenCss(t, schema) })
    files.push({ path: 'src/App.vue', content: vueApp(comps, names, schema) })
    comps.forEach((c) => files.push({ path: `src/components/${names[c.id]}.vue`, content: vueComp(c, t) }))
    if (usesMap) files.push({ path: 'src/assets/china.json', content: chinaJson })
  } else {
    files.push({ path: 'package.json', content: reactPkg() })
    files.push({ path: 'vite.config.js', content: `import { defineConfig } from 'vite'\nimport react from '@vitejs/plugin-react'\n\n// base: './' 让 dist 可以部署在任意子路径下\nexport default defineConfig({ base: './', plugins: [react()] })\n` })
    files.push({ path: 'index.html', content: `<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>${title}</title>\n</head>\n<body>\n  <div id="root"></div>\n  <script type="module" src="/src/main.jsx"><\/script>\n</body>\n</html>\n` })
    files.push({ path: 'README.md', content: reactReadme(title) })
    files.push({ path: 'src/main.jsx', content: mainJsx(usesMap) })
    files.push({ path: 'src/lib/echarts.ts', content: echartsSetupCode() })
    files.push({ path: 'src/lib/fit.js', content: fitJs() })
    files.push({ path: 'src/screen.css', content: screenCss(t, schema) })
    files.push({ path: 'src/App.jsx', content: reactApp(comps, names, schema) })
    comps.forEach((c) => files.push({ path: `src/components/${names[c.id]}.jsx`, content: reactComp(c, t) }))
    if (usesMap) files.push({ path: 'src/assets/china.json', content: chinaJson })
  }
  return files
}

/** Vue 工程入口：按需注册出口 + 注册地图（仅用到地图时） + 引入全局样式 */
function mainTs(usesMap: boolean): string {
  const reg = usesMap
    ? `import chinaGeo from './assets/china.json'\n// 中国地图 geoJSON 注册（ECharts 5 不再内置地图数据）\necharts.registerMap('china', chinaGeo)\n`
    : ''
  return `import { createApp } from 'vue'\nimport echarts from './lib/echarts'\nimport App from './App.vue'\nimport './screen.css'\n\n${reg}\ncreateApp(App).mount('#app')\n`
}

/** React 工程入口 */
function mainJsx(usesMap: boolean): string {
  const reg = usesMap
    ? `import chinaGeo from './assets/china.json'\n// 中国地图 geoJSON 注册（ECharts 5 不再内置地图数据）\necharts.registerMap('china', chinaGeo)\n`
    : ''
  return `import React from 'react'\nimport { createRoot } from 'react-dom/client'\nimport echarts from './lib/echarts'\nimport App from './App'\nimport './screen.css'\n\n${reg}\ncreateRoot(document.getElementById('root')).render(<App />)\n`
}

/**
 * 导出工程 zip 并下载。
 */
export async function exportProject(
  kind: 'vue' | 'react',
  schema: ScreenSchema,
  themes: Record<string, ThemeToken>,
): Promise<void> {
  // 中国地图 geoJSON 按需获取（编辑器 bundle 不再静态携带这 60KB），
  // 失败时降级为空内容（仅地图组件会空，其余文件正常导出）
  const usesMap = schema.components.some((c) => !c.hidden && c.type === 'echarts.map')
  let chinaGeoJson = ''
  if (usesMap) {
    try {
      chinaGeoJson = await (await fetch('geo/china.json')).text()
    } catch (err) {
      console.warn('[ScreenForge] 地图数据获取失败，导出工程中的 china.json 为空', err)
    }
  }
  const files = projectFiles(kind, schema, themes, chinaGeoJson)
  const zip = new JSZip()
  const root = kind === 'vue' ? 'screen-vue/' : 'screen-react/'
  files.forEach((f) => zip.file(root + f.path, f.content))
  const blob = await zip.generateAsync({ type: 'blob' })
  downloadBlob(`screen-${kind}.zip`, blob)
}

