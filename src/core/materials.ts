/**
 * ============================================================
 * 物料注册表 —— 「新增一个组件 = 在这里加一条」
 * ============================================================
 * 一个物料声明三件事：
 *   1. 默认 props / data / 默认尺寸（拖入画布时的初始状态）
 *   2. 配置面板字段（FIELDS，驱动右侧面板自动渲染表单）
 *   3. 渲染归属：type 以 echarts. 开头 → option.ts 生成图表；
 *      以 deco. 开头 → renderer.domHTML 生成 DOM 组件。
 * 图标在编辑器侧（editor/components/Palette.tsx），物料本身保持纯数据。
 */

import type { FieldDef } from './schema-fields'

/** 物料定义 */
export interface MaterialDef {
  type: string
  name: string
  /** 面板分类：图表 / 装饰 / 文字 */
  cat: string
  /** 拖入画布时的默认尺寸（设计稿 px） */
  w: number
  h: number
  props: Record<string, unknown>
  data?: Record<string, unknown>
}

/* ------------------------------------------------------------
 * 图表类物料
 * ---------------------------------------------------------- */
export const MATERIALS: MaterialDef[] = [
  {
    type: 'echarts.line', name: '折线图', cat: '图表', w: 620, h: 300,
    props: { title: '折线图', smooth: true, area: true, showLegend: true },
    data: { categories: ['一月', '二月', '三月', '四月', '五月'], series: [{ name: '系列1', values: [120, 200, 150, 260, 180] }] },
  },
  {
    type: 'echarts.bar', name: '柱状图', cat: '图表', w: 620, h: 300,
    props: { title: '柱状图', showLegend: true, barWidth: 16 },
    data: { categories: ['A', 'B', 'C', 'D', 'E'], series: [{ name: '系列1', values: [120, 200, 150, 260, 180] }] },
  },
  {
    type: 'echarts.pie', name: '饼图', cat: '图表', w: 420, h: 300,
    props: { title: '饼图', donut: true, showLegend: true },
    data: { items: [{ name: 'A', value: 40 }, { name: 'B', value: 28 }, { name: 'C', value: 20 }, { name: 'D', value: 12 }] },
  },
  {
    type: 'echarts.gauge', name: '仪表盘', cat: '图表', w: 380, h: 300,
    props: { title: '仪表盘', label: '当前值', max: 100, unit: '%' },
    data: { value: 72 },
  },
  {
    type: 'echarts.map', name: '中国地图', cat: '图表', w: 640, h: 460,
    props: { title: '全国区域分布' },
    data: {
      items: [
        { name: '广东', value: 820 }, { name: '北京', value: 640 }, { name: '浙江', value: 520 },
        { name: '江苏', value: 430 }, { name: '四川', value: 460 }, { name: '山东', value: 380 },
        { name: '湖北', value: 300 }, { name: '福建', value: 260 }, { name: '陕西', value: 200 },
      ],
    },
  },
  {
    type: 'echarts.radar', name: '雷达图', cat: '图表', w: 480, h: 380,
    props: { title: '能力雷达', showLegend: true },
    data: {
      indicators: [
        { name: '销售', max: 100 }, { name: '管理', max: 100 }, { name: '信息', max: 100 },
        { name: '技术', max: 100 }, { name: '服务', max: 100 }, { name: '协同', max: 100 },
      ],
      series: [{ name: '本期', values: [82, 70, 64, 88, 76, 60] }, { name: '上期', values: [70, 60, 58, 72, 66, 55] }],
    },
  },
]

/* ------------------------------------------------------------
 * 装饰 / 文字类物料
 * ---------------------------------------------------------- */
export const MATERIALS_DECO: MaterialDef[] = [
  {
    type: 'deco.number', name: '数字翻牌', cat: '装饰', w: 300, h: 132,
    props: { label: '指标名', value: 12846, unit: '个', delta: '+8.2%', dir: 'up' },
  },
  {
    type: 'deco.rank', name: '排行榜', cat: '装饰', w: 420, h: 368,
    props: { title: '排行榜 TOP5', top: 5 },
    data: { items: [{ name: '项目一', value: 820 }, { name: '项目二', value: 640 }, { name: '项目三', value: 480 }] },
  },
  {
    type: 'deco.scrollList', name: '滚动列表', cat: '装饰', w: 460, h: 320,
    props: { title: '实时事件流', rowH: 34, speed: 2 },
    data: {
      items: [
        { name: '服务器 A-01', value: 'CPU 92%', status: 'err' },
        { name: '网关 G-14', value: '丢包 3.1%', status: 'warn' },
        { name: '存储 S-07', value: '容量 76%', status: 'ok' },
        { name: '调度 D-01', value: '队列 1204', status: 'ok' },
        { name: '缓存 C-19', value: '命中率 98%', status: 'ok' },
      ],
    },
  },
  {
    type: 'deco.title', name: '标题', cat: '文字', w: 900, h: 90,
    props: { text: '大屏标题', sub: 'SUB TITLE', size: 34 },
  },
  { type: 'deco.clock', name: '时间', cat: '文字', w: 340, h: 40, props: {} },
]

/** 全部物料（编辑器物料库按 cat 分组展示） */
export const ALL_MATERIALS: MaterialDef[] = [...MATERIALS, ...MATERIALS_DECO]

/** 按类型取物料定义 */
export function getMaterial(type: string): MaterialDef | undefined {
  return ALL_MATERIALS.find((m) => m.type === type)
}

/* ------------------------------------------------------------
 * 配置面板字段（数据驱动的表单）
 * ---------------------------------------------------------- */
export const FIELDS: Record<string, FieldDef[]> = {
  'echarts.line': [
    { k: 'title', l: '标题', t: 'text' }, { k: 'smooth', l: '平滑曲线', t: 'switch' },
    { k: 'area', l: '面积填充', t: 'switch' }, { k: 'showLegend', l: '显示图例', t: 'switch' },
  ],
  'echarts.bar': [
    { k: 'title', l: '标题', t: 'text' }, { k: 'barWidth', l: '柱宽', t: 'number', min: 4, max: 60 },
    { k: 'stack', l: '堆叠显示', t: 'switch' }, { k: 'showLegend', l: '显示图例', t: 'switch' },
  ],
  'echarts.pie': [
    { k: 'title', l: '标题', t: 'text' }, { k: 'donut', l: '环形', t: 'switch' },
    { k: 'showLegend', l: '显示图例', t: 'switch' },
  ],
  'echarts.gauge': [
    { k: 'title', l: '标题', t: 'text' }, { k: 'label', l: '指标名', t: 'text' },
    { k: 'max', l: '最大值', t: 'number' }, { k: 'unit', l: '单位', t: 'text' },
  ],
  'echarts.map': [
    { k: 'title', l: '标题', t: 'text' }, { k: 'showLegend', l: '显示数值色阶', t: 'switch' },
  ],
  'echarts.radar': [
    { k: 'title', l: '标题', t: 'text' }, { k: 'showLegend', l: '显示图例', t: 'switch' },
  ],
  'deco.number': [
    { k: 'label', l: '指标名', t: 'text' }, { k: 'value', l: '数值', t: 'number' },
    { k: 'unit', l: '单位', t: 'text' }, { k: 'delta', l: '趋势文本', t: 'text' },
    { k: 'dir', l: '趋势方向', t: 'select', opts: [['', '无'], ['up', '上升（红）'], ['down', '下降（绿）']] },
  ],
  'deco.rank': [
    { k: 'title', l: '标题', t: 'text' }, { k: 'top', l: '显示条数', t: 'number', min: 3, max: 10 },
  ],
  'deco.scrollList': [
    { k: 'title', l: '标题', t: 'text' }, { k: 'rowH', l: '行高', t: 'number', min: 24, max: 60 },
    { k: 'speed', l: '滚动速度', t: 'number', min: 1, max: 10 },
  ],
  'deco.title': [
    { k: 'text', l: '主标题', t: 'text' }, { k: 'sub', l: '副标题', t: 'text' },
    { k: 'size', l: '字号', t: 'number', min: 16, max: 72 },
  ],
  'deco.clock': [],
}

/** 消费数据集的物料类型（右侧面板显示「数据来源」区块） */
export const DATA_TYPES = [
  'echarts.line', 'echarts.bar', 'echarts.pie', 'echarts.gauge',
  'echarts.map', 'echarts.radar', 'deco.rank', 'deco.scrollList',
]

/** 面板分组顺序 */
export const PALETTE_CATS = ['图表', '装饰', '文字']
