/**
 * 配置面板字段类型（与 materials.ts 配套，独立文件避免循环依赖）
 */

/** 面板字段定义 */
export interface FieldDef {
  /** props 上的键名 */
  k: string
  /** 显示标签 */
  l: string
  /** 控件类型 */
  t: 'text' | 'number' | 'switch' | 'select'
  min?: number
  max?: number
  /** select 的选项 [value, label] */
  opts?: [string, string][]
}
