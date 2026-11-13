/**
 * ============================================================
 * option 构建 —— 「component + data + theme → ECharts option」的唯一实现
 * ============================================================
 * 这是全项目最核心的一个函数：
 * - 编辑器画布、预览、导出 HTML 都走它；
 * - 导出 Vue/React 工程时，把它的返回值 JSON.stringify 成字面量写进组件文件；
 * - rawOption 逃生舱最后深度 merge，保证用户能覆盖任何字段。
 */

import * as echarts from 'echarts'
import chinaGeo from './assets/china.json'
import type { ComponentItem } from './schema'
import { al, type ThemeToken } from './themes'

/** 渲染器统一字体栈（canvas 用，双引号安全） */
export const FONT = 'system-ui,-apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif'

/* ------------------------------------------------------------
 * 中国地图 geoJSON 懒注册
 * ECharts 5 不再内置地图数据；geoJSON 随包分发（assets/china.json），
 * 首次遇到地图组件时注册一次。runtime.iife.js 会把这份 JSON 一起打进
 * 导出的单文件 HTML，因此导出物天然可用，无需额外配置。
 * ---------------------------------------------------------- */
let mapRegistered = false
export function ensureChinaMap(): void {
  if (!mapRegistered) {
    echarts.registerMap('china', chinaGeo as never)
    mapRegistered = true
  }
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
 * 生成一个组件最终的 ECharts option。
 * @param c 组件（含 props / data / rawOption）
 * @param t 当前主题 token（不传则由调用方保证——renderer 内部会传）
 */
export function buildOption(c: ComponentItem, t: ThemeToken): Record<string, unknown> {
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
    /* ---- 中国地图：先保证 geoJSON 已注册 ---- */
    ensureChinaMap()
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
