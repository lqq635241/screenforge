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

/** 组件在主页面里的定位包裹样式（Vue 用 style 字符串） */
function vuePos(c: ComponentItem): string {
  const r = c.rect
  let s = `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;z-index:${c.z || 1};`
  if (r.rotate) s += `transform:rotate(${r.rotate}deg);`
  return s
}

/** 组件在主页面里的定位包裹样式（React 用 style 对象） */
function reactPos(c: ComponentItem): string {
  const r = c.rect
  const parts = [`left: ${r.x}`, `top: ${r.y}`, `width: ${r.w}`, `height: ${r.h}`, `zIndex: ${c.z || 1}`]
  if (r.rotate) parts.push(`transform: 'rotate(${r.rotate}deg)'`)
  return `{ ${parts.join(', ')} }`
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

/* ---------- 页面骨架：1920×1080 设计稿 + JS 缩放 ---------- */
.viewport { position: fixed; inset: 0; }
.screen { position: absolute; width: 1920px; height: 1080px; transform-origin: 0 0; background: ${bgCss(t, schema)}; }
.abs { position: absolute; }

/* ---------- 卡片公共外壳 ---------- */
.sf-panel { width: 100%; height: 100%; box-sizing: border-box; position: relative; background: ${t.panel}; border: 1px solid ${t.panelBorder}; border-radius: 4px; overflow: hidden; }
.sf-panel-title { margin-bottom: 10px; font-size: 13px; font-weight: 500; color: ${t.text}; }

/* 图表卡片：标题栏 + 顶部光线 + 四角（与渲染器 card() 一致） */
.sf-card-head { position: absolute; left: 0; top: 0; right: 0; height: 42px; display: flex; align-items: center; gap: 8px; padding: 0 14px; }
.sf-card-tick { display: block; width: 3px; height: 13px; background: ${t.accent}; box-shadow: 0 0 6px ${al(t.accent, .8)}; }
.sf-card-title { font-size: 15px; font-weight: 500; letter-spacing: .5px; color: ${t.text}; }
.sf-topline { position: absolute; left: 8%; right: 8%; top: 0; height: 1px; background: linear-gradient(90deg, transparent, ${al(t.accent, .9)}, transparent); pointer-events: none; }
.sf-wash { position: absolute; left: 0; top: 0; right: 0; height: 52px; background: linear-gradient(180deg, ${al(t.accent, .06)}, transparent); pointer-events: none; }
.sf-chart-box { position: absolute; left: 0; top: 42px; right: 0; bottom: 0; }

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
import * as echarts from 'echarts'
import { onMounted, onBeforeUnmount, ref } from 'vue'

const el = ref<HTMLDivElement>()
let chart: echarts.ECharts | null = null

// 配置项固化为字面量：改样式直接改这里；接接口请替换数据后重新 setOption
const option = ${optionStr}

onMounted(() => {
  chart = echarts.init(el.value!)
  chart.setOption(option)
  window.addEventListener('resize', onResize)
})

const onResize = () => chart?.resize()

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

/** Vue 主页面 App.vue：编排所有子组件 + 1920×1080 自适应缩放 */
function vueApp(comps: ComponentItem[], names: Record<string, string>, t: ThemeToken, schema: ScreenSchema): string {
  const imports = comps.map((c, i) =>
    `import ${names[c.id]} from './components/${names[c.id]}.vue'`).join('\n')
  const usages = comps.map((c) =>
    `      <div class="abs" style="${vuePos(c)}">\n        <${names[c.id]} />\n      </div>`).join('\n')
  return `<template>
  <div class="viewport">
    <!-- 设计稿 1920×1080，fit() 按 window 等比缩放并居中（letterbox） -->
    <div class="screen" :style="screenStyle">
${usages}
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
${imports}

const screenStyle = ref<Record<string, string>>({})

function fit() {
  const w = 1920
  const h = 1080
  const k = Math.min(window.innerWidth / w, window.innerHeight / h)
  screenStyle.value = {
    transform: 'scale(' + k + ')',
    left: Math.round((window.innerWidth - w * k) / 2) + 'px',
    top: Math.round((window.innerHeight - h * k) / 2) + 'px',
  }
}

onMounted(() => {
  fit()
  window.addEventListener('resize', fit)
})
onBeforeUnmount(() => window.removeEventListener('resize', fit))
</script>

<!-- 页面骨架样式见 src/screen.css（全局） -->
`
}

/* ============================ React 组件模板 ============================ */

function reactChart(c: ComponentItem, t: ThemeToken): string {
  const optionStr = JSON.stringify(buildOption(c, t), null, 2)
  const title = String((c.props || {}).title || c.name)
  return `// ${c.name} · ${c.rect.w} × ${c.rect.h} · ScreenForge 导出
import { useEffect, useRef } from 'react'
import * as echarts from 'echarts'

// 配置项固化为字面量：改样式直接改这里；接接口请替换数据后重新 setOption
const option = ${optionStr}

export default function Chart() {
  const el = useRef(null)

  useEffect(() => {
    const chart = echarts.init(el.current)
    chart.setOption(option)
    const onResize = () => chart.resize()
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

/** React 主页面 App.jsx */
function reactApp(comps: ComponentItem[], names: Record<string, string>, schema: ScreenSchema): string {
  const imports = comps.map((c, i) =>
    `import ${names[c.id]} from './components/${names[c.id]}'`).join('\n')
  const usages = comps.map((c) =>
    `        <div className="abs" style={${reactPos(c)}}>\n          <${names[c.id]} />\n        </div>`).join('\n')
  return `// ${schema.page.title} · 主页面 · ScreenForge 导出
import { useEffect, useState } from 'react'
${imports}

export default function App() {
  // 设计稿 1920×1080，fit() 按 window 等比缩放并居中（letterbox）
  const [screenStyle, setScreenStyle] = useState({})

  useEffect(() => {
    const fit = () => {
      const w = 1920
      const h = 1080
      const k = Math.min(window.innerWidth / w, window.innerHeight / h)
      setScreenStyle({
        transform: 'scale(' + k + ')',
        left: Math.round((window.innerWidth - w * k) / 2) + 'px',
        top: Math.round((window.innerHeight - h * k) / 2) + 'px',
      })
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  return (
    <div className="viewport">
      <div className="screen" style={screenStyle}>
${usages}
      </div>
    </div>
  )
}
`
}

/* ============================ 工程骨架文件 ============================ */

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

- \`src/App.vue\` 主页面：1920×1080 设计稿 + 等比缩放，绝对定位编排所有子组件
- \`src/components/Widget*.vue\` 每个大屏组件一个文件，配置项固化为字面量
- \`src/screen.css\` 全局样式，主题色已固化为字面量（改色直接替换值）
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

- \`src/App.jsx\` 主页面：1920×1080 设计稿 + 等比缩放，绝对定位编排所有子组件
- \`src/components/Widget*.jsx\` 每个大屏组件一个文件，配置项固化为字面量
- \`src/screen.css\` 全局样式，主题色已固化为字面量（改色直接替换值）
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
): { path: string; content: string }[] {
  const t = themes[schema.page.theme] || themes.custom
  // 可见组件按 schema 顺序编号
  const comps = schema.components.filter((c) => !c.hidden)
  const names: Record<string, string> = {}
  comps.forEach((c, i) => { names[c.id] = compBase(c, i) })
  const usesMap = comps.some((c) => c.type === 'echarts.map')
  const chinaJson = usesMap ? JSON.stringify(chinaGeoData) : ''
  const title = schema.page.title || '大屏'
  const files: { path: string; content: string }[] = []

  if (kind === 'vue') {
    files.push({ path: 'package.json', content: vuePkg(title, usesMap) })
    files.push({ path: 'vite.config.js', content: `import { defineConfig } from 'vite'\nimport vue from '@vitejs/plugin-vue'\n\n// base: './' 让 dist 可以部署在任意子路径下\nexport default defineConfig({ base: './', plugins: [vue()] })\n` })
    files.push({ path: 'tsconfig.json', content: `{\n  "compilerOptions": {\n    "target": "ES2020",\n    "module": "ESNext",\n    "moduleResolution": "bundler",\n    "resolveJsonModule": true,\n    "jsx": "preserve",\n    "strict": true,\n    "skipLibCheck": true,\n    "noEmit": true\n  },\n  "include": ["src"]\n}\n` })
    files.push({ path: 'index.html', content: `<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>${title}</title>\n</head>\n<body>\n  <div id="app"></div>\n  <script type="module" src="/src/main.ts"><\/script>\n</body>\n</html>\n` })
    files.push({ path: 'README.md', content: vueReadme(title) })
    files.push({ path: 'src/main.ts', content: mainTs(usesMap) })
    files.push({ path: 'src/screen.css', content: screenCss(t, schema) })
    files.push({ path: 'src/App.vue', content: vueApp(comps, names, t, schema) })
    comps.forEach((c) => files.push({ path: `src/components/${names[c.id]}.vue`, content: vueComp(c, t) }))
    if (usesMap) files.push({ path: 'src/assets/china.json', content: chinaJson })
  } else {
    files.push({ path: 'package.json', content: reactPkg() })
    files.push({ path: 'vite.config.js', content: `import { defineConfig } from 'vite'\nimport react from '@vitejs/plugin-react'\n\n// base: './' 让 dist 可以部署在任意子路径下\nexport default defineConfig({ base: './', plugins: [react()] })\n` })
    files.push({ path: 'index.html', content: `<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>${title}</title>\n</head>\n<body>\n  <div id="root"></div>\n  <script type="module" src="/src/main.jsx"><\/script>\n</body>\n</html>\n` })
    files.push({ path: 'README.md', content: reactReadme(title) })
    files.push({ path: 'src/main.jsx', content: mainJsx(usesMap) })
    files.push({ path: 'src/screen.css', content: screenCss(t, schema) })
    files.push({ path: 'src/App.jsx', content: reactApp(comps, names, schema) })
    comps.forEach((c) => files.push({ path: `src/components/${names[c.id]}.jsx`, content: reactComp(c, t) }))
    if (usesMap) files.push({ path: 'src/assets/china.json', content: chinaJson })
  }
  return files
}

/** Vue 工程入口：注册地图（仅用到地图时） + 引入全局样式 */
function mainTs(usesMap: boolean): string {
  const reg = usesMap
    ? `import chinaGeo from './assets/china.json'\n// 中国地图 geoJSON 注册（ECharts 5 不再内置地图数据）\necharts.registerMap('china', chinaGeo)\n`
    : ''
  return `import { createApp } from 'vue'\nimport * as echarts from 'echarts'\nimport App from './App.vue'\nimport './screen.css'\n\n${reg}\ncreateApp(App).mount('#app')\n`
}

/** React 工程入口 */
function mainJsx(usesMap: boolean): string {
  const reg = usesMap
    ? `import chinaGeo from './assets/china.json'\n// 中国地图 geoJSON 注册（ECharts 5 不再内置地图数据）\necharts.registerMap('china', chinaGeo)\n`
    : ''
  return `import React from 'react'\nimport { createRoot } from 'react-dom/client'\nimport * as echarts from 'echarts'\nimport App from './App'\nimport './screen.css'\n\n${reg}\ncreateRoot(document.getElementById('root')).render(<App />)\n`
}

// china.json 内容延迟读取（构建时静态打包）
import chinaGeoData from '../core/assets/china.json'

/**
 * 导出工程 zip 并下载。
 */
export async function exportProject(
  kind: 'vue' | 'react',
  schema: ScreenSchema,
  themes: Record<string, ThemeToken>,
): Promise<void> {
  const files = projectFiles(kind, schema, themes)
  const zip = new JSZip()
  const root = kind === 'vue' ? 'screen-vue/' : 'screen-react/'
  files.forEach((f) => zip.file(root + f.path, f.content))
  const blob = await zip.generateAsync({ type: 'blob' })
  downloadBlob(`screen-${kind}.zip`, blob)
}

