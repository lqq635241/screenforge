/**
 * ============================================================
 * 画布几何工具：命中测试 / 缩放 / 吸附校准
 * ============================================================
 * 坐标体系：所有函数收发「设计稿像素」（1920×1080），
 * 屏幕坐标 → 设计稿坐标的换算由 CanvasStage 完成（除以 scale）。
 */

import type { ComponentItem, Guide, Rect } from '../../core/schema'

/** 八向缩放手柄定义（相对组件矩形的比例位置） */
export const HANDLES = [
  { k: 'nw', x: 0, y: 0 }, { k: 'n', x: 0.5, y: 0 }, { k: 'ne', x: 1, y: 0 },
  { k: 'e', x: 1, y: 0.5 }, { k: 'se', x: 1, y: 1 }, { k: 's', x: 0.5, y: 1 },
  { k: 'sw', x: 0, y: 1 }, { k: 'w', x: 0, y: 0.5 },
] as const

export type HandleKey = (typeof HANDLES)[number]['k']

/** 手柄 → 鼠标光标 */
export const CUR: Record<string, string> = {
  nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize',
  n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
}

/** 设计稿尺寸（V1 固定 16:9） */
export const DESIGN_W = 1920
export const DESIGN_H = 1080

/**
 * 命中测试：取 z 最大且未隐藏/锁定的命中组件
 */
export function hitTest(components: ComponentItem[], p: { x: number; y: number }): ComponentItem | null {
  const list = [...components].sort((a, b) => (b.z || 1) - (a.z || 1))
  for (const c of list) {
    if (c.hidden || c.locked) continue
    const r = c.rect
    if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return c
  }
  return null
}

/**
 * 命中测试缩放手柄（按 scale 换算命中容差）
 */
export function handleAt(
  c: ComponentItem,
  p: { x: number; y: number },
  scale: number,
): HandleKey | null {
  const t = 9 / scale
  for (const h of HANDLES) {
    const hx = c.rect.x + c.rect.w * h.x
    const hy = c.rect.y + c.rect.h * h.y
    if (Math.abs(p.x - hx) <= t && Math.abs(p.y - hy) <= t) return h.k
  }
  return null
}

/**
 * 基础缩放：按手柄方向应用 dx/dy，最小尺寸 60
 */
export function resizeRect(o: Rect, handle: string, dx: number, dy: number): Rect {
  let { x, y, w, h } = o
  const MIN = 60
  if (handle.includes('w')) { x = o.x + dx; w = o.w - dx }
  if (handle.includes('e')) w = o.w + dx
  if (handle.includes('n')) { y = o.y + dy; h = o.h - dy }
  if (handle.includes('s')) h = o.h + dy
  if (w < MIN) { if (handle.includes('w')) x = o.x + o.w - MIN; w = MIN }
  if (h < MIN) { if (handle.includes('n')) y = o.y + o.h - MIN; h = MIN }
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) }
}

/** 收集吸附候选线：画布边/中心 + 其他组件的边/中心 */
function collectLines(components: ComponentItem[], skipId: string, horizontal: boolean): number[] {
  const lines = horizontal ? [0, DESIGN_H / 2, DESIGN_H] : [0, DESIGN_W / 2, DESIGN_W]
  components.forEach((c) => {
    if (c.id === skipId || c.hidden) return
    const r = c.rect
    if (horizontal) {
      lines.push(r.y, Math.round(r.y + r.h / 2), r.y + r.h)
    } else {
      lines.push(r.x, Math.round(r.x + r.w / 2), r.x + r.w)
    }
  })
  return lines
}

/** 在容差内找最近候选线 */
function nearest(v: number, lines: number[], T: number): number | null {
  let best: { d: number; l: number } | null = null
  for (const l of lines) {
    const d = Math.abs(v - l)
    if (d <= T && (!best || d < best.d)) best = { d, l }
  }
  return best ? best.l : null
}

/**
 * 拖拽移动吸附：对齐画布与其它组件的边/中心。
 * 返回校正后的坐标 + 需要绘制的校准线。
 */
export function snapMove(
  components: ComponentItem[],
  skipId: string,
  w: number,
  h: number,
  x: number,
  y: number,
  T = 8,
): { x: number; y: number; guides: Guide[] } {
  const guides: Guide[] = []
  const vlines = collectLines(components, skipId, false)
  const hlines = collectLines(components, skipId, true)
  const vCands: { pos: number; line: number }[] = [
    { pos: 0, line: 0 }, { pos: (DESIGN_W - w) / 2, line: DESIGN_W / 2 }, { pos: DESIGN_W - w, line: DESIGN_W },
  ]
  const hCands: { pos: number; line: number }[] = [
    { pos: 0, line: 0 }, { pos: (DESIGN_H - h) / 2, line: DESIGN_H / 2 }, { pos: DESIGN_H - h, line: DESIGN_H },
  ]
  vCands.forEach((v) => vlines.push(v.pos))
  hCands.forEach((v) => hlines.push(v.pos))
  const bx = nearest(x, vCands.map((c) => c.pos), T)
  const by = nearest(y, hCands.map((c) => c.pos), T)
  if (bx != null) {
    const cand = vCands.find((c) => c.pos === bx)!
    x = cand.pos
    guides.push({ axis: 'v', pos: cand.line })
  }
  if (by != null) {
    const cand = hCands.find((c) => c.pos === by)!
    y = cand.pos
    guides.push({ axis: 'h', pos: cand.line })
  }
  return { x: Math.round(x), y: Math.round(y), guides }
}

/**
 * 缩放吸附：拖动手柄时，被拖动的边与其他组件/画布的边与中心线
 * 靠近 T 像素内自动吸附，并返回对应校准线。
 * 规则：w 手柄对齐左边缘，e 对齐右边缘，n 对齐上边缘，s 对齐下边缘，
 * 角手柄两条边同时参与。
 */
export function snapResize(
  components: ComponentItem[],
  skipId: string,
  handle: string,
  orig: Rect,
  rect: Rect,
  T = 7,
): { rect: Rect; guides: Guide[] } {
  const guides: Guide[] = []
  const MIN = 60
  const vlines = collectLines(components, skipId, false)
  const hlines = collectLines(components, skipId, true)

  // 左边缘：右边缘固定，校正 x 后重算宽度
  if (handle.includes('w')) {
    const m = nearest(rect.x, vlines, T)
    if (m != null) {
      const right = rect.x + rect.w
      rect = { ...rect, x: m, w: Math.max(MIN, right - m) }
      guides.push({ axis: 'v', pos: m })
    }
  }
  // 右边缘：宽度 = 目标线 - 左边缘
  if (handle.includes('e')) {
    const m = nearest(rect.x + rect.w, vlines, T)
    if (m != null) {
      rect = { ...rect, w: Math.max(MIN, m - rect.x) }
      guides.push({ axis: 'v', pos: m })
    }
  }
  // 上边缘
  if (handle.includes('n')) {
    const m = nearest(rect.y, hlines, T)
    if (m != null) {
      const bottom = rect.y + rect.h
      rect = { ...rect, y: m, h: Math.max(MIN, bottom - m) }
      guides.push({ axis: 'h', pos: m })
    }
  }
  // 下边缘
  if (handle.includes('s')) {
    const m = nearest(rect.y + rect.h, hlines, T)
    if (m != null) {
      rect = { ...rect, h: Math.max(MIN, m - rect.y) }
      guides.push({ axis: 'h', pos: m })
    }
  }
  return {
    rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) },
    guides,
  }
}
