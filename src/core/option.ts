/**
 * ============================================================
 * option 构建 —— 「component + data + theme → ECharts option」的唯一实现
 * ============================================================
 * 这是全项目最核心的一个函数：
 * - 编辑器画布、预览、导出 HTML 都走它；
 * - 导出 Vue/React 工程时，把它的返回值 JSON.stringify 成字面量写进组件文件；
 * - rawOption 逃生舱最后深度 merge，保证用户能覆盖任何字段。
 */

import { echarts } from './echarts-setup'
import type { ComponentItem } from './schema'
import { al, type ThemeToken } from './themes'

/** 渲染器统一字体栈（canvas 用，双引号安全） */
export const FONT = 'system-ui,-apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif'

/* ------------------------------------------------------------
 * 中国地图 geoJSON 懒加载注册（P1 性能优化）
 * ------------------------------------------------------------
 * geoJSON 约 60KB，之前静态 import 会被打进编辑器首屏 chunk。
 * 现在改为「首次用到地图时才加载」：
 *   - 编辑器构建：fetch 相对路径 geo/china.json（public 目录，跟随
 *     vite base / GitHub Pages 子路径，天然正确）；
 *   - 导出单文件 HTML：esbuild 打包 runtime 时 SF_EMBED_GEO=true（见
 *     package.json build:runtime 的 --define），走动态 import 分支，
 *     esbuild 会把 JSON 内联进 IIFE —— 单文件 HTML 离线可用性不变；
 *   - 导出 Vue/React 工程：project.ts 在导出时 fetch 该文件写入
 *     src/assets/china.json，与生成代码同步注册。
 * 加载失败时清空 mapLoading 以便下次重试。
 * ---------------------------------------------------------- */
declare const SF_EMBED_GEO: boolean | undefined

let mapRegistered = false
let mapLoading: Promise<void> | null = null

/** 确保中国地图已注册；未注册时开始异步加载并返回同一份 Promise */
export function ensureChinaMap(): Promise<void> {
  if (mapRegistered) return Promise.resolve()
  if (!mapLoading) {
    const load = SF_EMBED_GEO
      ? import('./assets/china.json').then((m) => m.default)
      : fetch('geo/china.json').then((r) => {
          if (!r.ok) throw new Error('加载地图数据失败：' + r.status)
          return r.json()
        })
    mapLoading = Promise.resolve(load)
      .then((geo) => {
        echarts.registerMap('china', geo as never)
        mapRegistered = true
      })
      .catch((err) => {
        mapLoading = null // 允许下次重试
        throw err
      })
  }
  return mapLoading
}

/** 深度 merge：b 覆盖 a，数组与标量直接替换（用于 rawOption） */
function merge(a: unknown, b: unknown): unknown {
  if (b === null || b === undefined || typeof b !== 'object') return b === undefined ? a : b
  if (Array.isArray(b)) return JSON.parse(JSON.stringify(b))
  const out: Record<string, unknown> = typeof a === 'object' && a !== null && !Array.isArray(a)
    ? { ...(a as Record<string, unknown>) }
    : {}
  for (const k of Object.keys(b as Record<string, unknown>)) {
    out[k] = merge((a as Record<string, unknown>)?.[k], (b as Record<string, unknown>)[k])
  }
  return out
}

/** 千分位格式化 */
export function fmtNum(n: number, dec = 0): string {
  const v = Number(n) || 0
  const s = dec > 0 ? v.toFixed(dec) : String(Math.round(v))
  const p = s.split('.')
  p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return p.join('.')
}

/**
 * 会随卡片一起缩放的数值键。
 *
 * 图表容器是「填满卡片」的，ECharts 里的百分比尺寸（网格、饼图半径、
 * 雷达半径）本来就会随容器变化；但字号、点大小这些是绝对像素，不缩放的话
 * 4K 大屏上会小得看不清、小屏上又会挤在一起。所以按卡片缩放系数乘一遍。
 *
 * 白名单式处理：只动明确的视觉尺寸，避免误缩放坐标 / 数值（比如 data）。
 */
const SCALED_KEYS = new Set([
  'fontSize',
  'lineHeight',
  'symbolSize',
  'itemWidth',
  'itemHeight',
  'itemGap',
  'barWidth',
  'barMaxWidth',
  'borderWidth',
])

/** 递归缩放 option 里的视觉尺寸（返回新对象，不改入参） */
export function scaleText<T>(node: T, s: number): T {
  if (!node || s === 1 || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map((v) => scaleText(v, s)) as unknown as T
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (typeof v === 'number' && SCALED_KEYS.has(k)) {
      out[k] = Math.round(v * s * 100) / 100
    } else if (v && typeof v === 'object') {
      out[k] = scaleText(v, s)
    } else {
      out[k] = v
    }
  }
  return out as T
}

/**
 * 生成一个组件最终的 ECharts option。
 * @param c 组件（含 props / data / rawOption）
 * @param t 当前主题 token（不传则由调用方保证——renderer 内部会传）
 * @param scale 卡片相对设计稿的缩放系数（字号 / 点径等跟着放大缩小，1 = 原样）
 */
export function buildOption(
  c: ComponentItem,
  t: ThemeToken,
  scale = 1,
): Record<string, unknown> {
  const o0 = buildRaw(c, t)
  return scale === 1 ? o0 : scaleText(o0, scale)
}

/** 不做缩放的原始 option（buildOption 内部实现） */
function buildRaw(c: ComponentItem, t: ThemeToken): Record<string, unknown> {
  const p = c.props || {}
  const d = (c.data || {}) as Record<string, unknown>

  /* ---- 公共底座：动效 / 系列色 / tooltip ---- */
  const base: Record<string, unknown> = {
    animationDuration: 700,
    color: t.palette,
    textStyle: { fontFamily: FONT, color: t.sub, fontSize: 12 },
    tooltip: {
      backgroundColor: 'rgba(10,16,28,.94)',
      borderColor: t.panelBorder,
      borderWidth: 1,
      textStyle: { color: t.text, fontSize: 12 },
      axisPointer: { lineStyle: { color: t.accent } },
    },
  }
  const axisLabel = { color: t.sub, fontSize: 12 }
  const splitLine = { lineStyle: { color: t.grid, type: 'dashed' } }
  const grid = { left: 18, right: 24, top: 42, bottom: 8, containLabel: true }
  const legend = p.showLegend
    ? { right: 14, top: 0, itemWidth: 9, itemHeight: 9, itemGap: 14, textStyle: { color: t.sub, fontSize: 12 } }
    : { show: false }
  let o: Record<string, unknown> = {}

  /* ---- 折线图 ---- */
  if (c.type === 'echarts.line') {
    o = {
      grid, legend,
      xAxis: { type: 'category', boundaryGap: false, data: d.categories || [], axisLine: { lineStyle: { color: t.panelBorder } }, axisTick: { show: false }, axisLabel },
      yAxis: { type: 'value', axisLine: { show: false }, axisLabel, splitLine },
      series: (d.series as { name: string; values: number[] }[] || []).map((s) => ({
        name: s.name, type: 'line', smooth: !!p.smooth, showSymbol: false, symbolSize: 5,
        data: s.values, lineStyle: { width: 2.5 },
        areaStyle: p.area ? { opacity: 0.14 } : null,
      })),
    }
  } else if (c.type === 'echarts.bar') {
    /* ---- 柱状图（支持堆叠） ---- */
    o = {
      grid, legend,
      xAxis: { type: 'category', data: d.categories || [], axisLine: { lineStyle: { color: t.panelBorder } }, axisTick: { show: false }, axisLabel },
      yAxis: { type: 'value', axisLine: { show: false }, axisLabel, splitLine },
      series: (d.series as { name: string; values: number[] }[] || []).map((s) => ({
        name: s.name, type: 'bar', stack: p.stack ? 'total' : null,
        barWidth: p.barWidth || 14, barMaxWidth: 26,
        itemStyle: { borderRadius: [3, 3, 0, 0] }, data: s.values,
      })),
    }
  } else if (c.type === 'echarts.pie') {
    /* ---- 饼图（支持环形） ---- */
    o = {
      legend: {
        show: p.showLegend !== false, bottom: 4, left: 'center', itemWidth: 9, itemHeight: 9,
        itemGap: 12, textStyle: { color: t.sub, fontSize: 11 },
      },
      series: [{
        type: 'pie', center: ['50%', '46%'],
        radius: p.donut ? ['48%', '70%'] : ['8%', '68%'],
        itemStyle: { borderColor: t.panel, borderWidth: 2 },
        label: { color: t.sub, fontSize: 11, formatter: '{d}%' },
        labelLine: { length: 6, length2: 6, lineStyle: { color: t.panelBorder } },
        data: d.items || [],
      }],
    }
  } else if (c.type === 'echarts.gauge') {
    /* ---- 仪表盘 ---- */
    o = {
      series: [{
        type: 'gauge', startAngle: 210, endAngle: -30, min: 0, max: p.max || 100,
        radius: '84%', center: ['50%', '54%'],
        progress: { show: true, width: 13, itemStyle: { color: t.accent } },
        axisLine: { lineStyle: { width: 13, color: [[1, t.grid]] } },
        axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false },
        pointer: { show: false }, anchor: { show: false },
        title: { offsetCenter: [0, '40%'], color: t.sub, fontSize: 12 },
        detail: {
          valueAnimation: true, offsetCenter: [0, '2%'],
          formatter: '{value}' + (p.unit || ''),
          color: t.text, fontSize: 34, fontWeight: 500,
        },
        data: [{ value: d.value || 0, name: p.label || '' }],
      }],
    }
  } else if (c.type === 'echarts.map') {
    /* ---- 中国地图：预热懒加载（真正等待在 renderer 的图表初始化队列里） ---- */
    void ensureChinaMap()
    const mitems = (d.items as { name: string; value: number }[] || [])
    const maxv = Math.max(1, ...mitems.map((i) => i.value))
    o = {
      visualMap: {
        show: p.showLegend !== false, min: 0, max: maxv, left: 10, bottom: 22,
        text: ['高', '低'], textStyle: { color: t.sub, fontSize: 11 },
        itemWidth: 9, itemHeight: 52, itemGap: 8,
        inRange: { color: [t.grid, t.palette[0], t.palette[1]] },
      },
      tooltip: Object.assign({}, base.tooltip, { trigger: 'item', formatter: '{b}<br/>{c}' }),
      series: [{
        type: 'map', map: 'china', roam: false, zoom: 1.18, top: 8, bottom: 16,
        itemStyle: { borderColor: t.panelBorder, borderWidth: 0.6, areaColor: t.grid },
        emphasis: { label: { color: t.text, fontSize: 11 }, itemStyle: { areaColor: t.palette[0] } },
        select: { disabled: true },
        data: mitems,
      }],
    }
  } else if (c.type === 'echarts.radar') {
    /* ---- 雷达图 ---- */
    o = {
      legend,
      radar: {
        indicator: d.indicators || [], radius: '58%', center: ['50%', '52%'],
        axisName: { color: t.sub, fontSize: 11 },
        splitLine: { lineStyle: { color: t.grid } },
        splitArea: { show: false },
        axisLine: { lineStyle: { color: t.grid } },
      },
      series: [{
        type: 'radar', symbolSize: 3,
        data: (d.series as { name: string; values: number[] }[] || []).map((s) => ({
          name: s.name, value: s.values, areaStyle: { opacity: 0.22 }, lineStyle: { width: 2 },
        })),
      }],
    }
  }

  const out = Object.assign({}, base, o)
  // rawOption 逃生舱：最后 merge，用户可覆盖一切
  if (c.rawOption) return merge(out, c.rawOption) as Record<string, unknown>
  return out
}

/** 导出 option / rgba 工具复用 */
export { al, merge }
