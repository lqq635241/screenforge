/**
 * ============================================================
 * schema 类型定义 —— 整个产品的唯一数据源（Single Source of Truth）
 * ============================================================
 * 设计原则（对应 docs/DESIGN.md §3）：
 * 1. 编辑器的所有状态都从 schema 派生，不另存一套 UI 状态；
 * 2. rect 存设计稿绝对像素（1920×1080）：编辑器按像素摆放，
 *    预览/导出时由 core/fit.ts 换算成百分比铺满屏幕，内容层等比缩放；
 * 3. props 只放「人类语义」配置（标题、平滑、面积……），
 *    绝不把 ECharts option 塞进 props —— option 由 core/option.ts 统一生成；
 * 4. rawOption 是逃生舱：深度 merge 到生成结果之上，兜住面板覆盖不到的字段；
 * 5. version 字段从第一天就有，为将来 schema 迁移留后路。
 */

import type { ThemeToken } from './themes'

/** 组件矩形（设计稿绝对坐标，单位 px） */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
  /** 旋转角度（度），可选 */
  rotate?: number
}

/** 吸附校准线（编辑器 overlay 用） */
export interface Guide {
  /** v = 竖线（对齐 x），h = 横线（对齐 y） */
  axis: 'v' | 'h'
  /** 设计稿坐标 */
  pos: number
}

/**
 * 数据源定义（V2 启用：数据源 → 转换表达式 → 字段映射 三段管线）
 * V1 里组件的 http 字段只保存配置，不做真实取数。
 */
export interface DataSource {
  id: string
  name: string
  type: 'static' | 'http'
  url?: string
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  /** 轮询间隔（秒），0 表示不轮询 */
  interval?: number
  /** 静态数据 */
  payload?: unknown
}

/** 大屏组件 */
export interface ComponentItem {
  id: string
  /** 物料类型，如 echarts.line / deco.scrollList，全部注册见 materials.ts */
  type: string
  name: string
  rect: Rect
  /** 图层层级，1 起步，越大越靠上 */
  z: number
  /** 语义配置项，字段定义见 materials.ts 的 FIELDS */
  props: Record<string, unknown>
  /** 静态数据（写死模式） */
  data?: Record<string, unknown>
  /** 数据来源模式：static 写死 / http 接口（V1 仅保存配置） */
  dataMode?: 'static' | 'http'
  http?: { url?: string; method?: 'GET' | 'POST'; interval?: number }
  /** rawOption 逃生舱：深度 merge 到 buildOption 结果之上 */
  rawOption?: Record<string, unknown> | null
  locked?: boolean
  hidden?: boolean
}

/** 整屏 schema */
export interface ScreenSchema {
  version: number
  page: {
    width: number
    height: number
    /** 主题 id，见 themes.ts；'custom' 为用户自定义主题 */
    theme: string
    /** 覆盖背景（留空则用主题默认的顶部辉光渐变） */
    background: string
    title: string
  }
  components: ComponentItem[]
  dataSources: DataSource[]
}

/**
 * createScreen 返回的渲染器句柄。
 * 编辑器 / 预览 / 导出 HTML 共用同一实现（core/renderer.ts），
 * 这就是「导出只做序列化、不做代码翻译」的落点。
 */
export interface ScreenHandle {
  /** 全量更新：增删组件、主题、数据变化时调用 */
  update(schema: ScreenSchema): void
  /** 轻量更新：只变 rect / z / hidden 时调用（拖拽中高频触发） */
  updateLayout(schema: ScreenSchema): void
  /**
   * 局部更新：只重渲染一个组件（改配置项时用）。
   * update() 是无条件 O(n) 全量重铺 —— 改一个图表的标题会让另外 12 个组件的
   * DOM 一起重建（实测：1 次输入 → 13 个组件被改、27 次 childList 变更）。
   * 契约：不改几何。rect / z / hidden 变了请走 updateLayout / update。
   */
  patch(id: string): void
  /** 容器尺寸变化后重算图表 */
  resize(): void
  dispose(): void
  /** 供导出 / 调试用：拿到某个组件最终生成的 ECharts option */
  buildOption(c: ComponentItem, t?: ThemeToken): Record<string, unknown>
}
