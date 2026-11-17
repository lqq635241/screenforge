/**
 * ============================================================
 * 导出 schema JSON —— 纯数据快照
 * ============================================================
 * 用途：备份 / 迁移 / 排查结构 / 交给别人看「这份大屏长什么样」。
 *
 * 三条红线：
 * 1. 只做序列化，不做改写 —— 不补 props 默认值、不合并 option、不加 exportedAt
 *    之类的元信息。否则导出的文件再导入回来，和编辑器里的东西不是一回事。
 * 2. key 顺序固定 —— 组件按「身份 → 几何 → 内容 → 状态」输出，
 *    两份导出可以直接 diff，不会被字段顺序抖动干扰。
 * 3. 可选字段为空时不输出 —— 保持文件干净，`dataMode: 'static'` 之外的
 *    空壳（如 `http: {}`）不写进文件。
 */

import type { ComponentItem, Rect, ScreenSchema } from '../core/schema'
import { downloadBlob } from './download'

/** rect 固定 key 顺序，rotate 只在存在时输出 */
function pickRect(r: Rect): Record<string, number> {
  const out: Record<string, number> = { x: r.x, y: r.y, w: r.w, h: r.h }
  if (r.rotate) out.rotate = r.rotate
  return out
}

/** 单个组件：按固定顺序重建，丢弃 undefined 与其它的运行时残留 */
function pickComponent(c: ComponentItem): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: c.id,
    type: c.type,
    name: c.name,
    rect: pickRect(c.rect),
    z: c.z,
    props: c.props,
  }
  if (c.data !== undefined) out.data = c.data
  if (c.dataMode) out.dataMode = c.dataMode
  // http 只有在填过 url / 非默认方法 / 轮询时才写，避免每个组件都挂一个空对象
  if (c.http && (c.http.url || (c.http.method && c.http.method !== 'GET') || c.http.interval)) {
    out.http = c.http
  }
  if (c.rawOption) out.rawOption = c.rawOption
  if (c.locked) out.locked = true
  if (c.hidden) out.hidden = true
  return out
}

/** 生成 schema JSON 字符串（2 空格缩进，面向人读 + 可 diff） */
export function buildSchemaJson(schema: ScreenSchema): string {
  const clean = {
    version: schema.version,
    page: {
      width: schema.page.width,
      height: schema.page.height,
      theme: schema.page.theme,
      background: schema.page.background,
      title: schema.page.title,
    },
    components: (schema.components || []).map(pickComponent),
    dataSources: schema.dataSources || [],
  }
  return JSON.stringify(clean, null, 2)
}

/** 文件名：大屏标题 + 时间戳，非法字符统一换成 - */
export function schemaFileName(schema: ScreenSchema, now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp =
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-` +
    `${p(now.getHours())}${p(now.getMinutes())}`
  const base = (schema.page.title || 'screen')
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'screen'
  return `${base}.schema.${stamp}.json`
}

/** 导出结果，供调用方提示「几个组件、多大」 */
export interface SchemaExportInfo {
  name: string
  bytes: number
  components: number
}

/** 触发下载，返回文件信息 */
export function exportSchemaJson(schema: ScreenSchema): SchemaExportInfo {
  const json = buildSchemaJson(schema)
  const name = schemaFileName(schema)
  downloadBlob(name, new Blob([json], { type: 'application/json;charset=utf-8' }))
  return {
    name,
    bytes: new TextEncoder().encode(json).length,
    components: (schema.components || []).length,
  }
}
