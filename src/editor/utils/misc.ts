/**
 * 编辑器杂项工具
 */

import type { ComponentItem, ScreenSchema } from '../../core/schema'

/** 深拷贝 */
export function clone<T>(o: T): T {
  return JSON.parse(JSON.stringify(o))
}

let seq = 1

/** 生成组件 id（时间戳 + 序号，画布内唯一） */
export function uid(): string {
  return 'c' + Date.now().toString(36) + (seq++).toString(36)
}

/** 按 id 查组件 */
export function findComp(schema: ScreenSchema, id: string | null): ComponentItem | null {
  if (!id) return null
  return schema.components.find((c) => c.id === id) || null
}
