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

/** 单轴吸附结果：校正后的坐标 + 校正后精确对齐的候选线 */
interface AxisSnap {
  pos: number
  /** 已经对齐上的线（用于画校准线，可能同时有多条，如左右两侧都贴住） */
  guides: number[]
}

/**
 * 单轴吸附求解。
 *
 * 思路：把矩形在这一轴上的三条基准线（起边 / 中心 / 止边）分别与所有候选线
 * 比对，取距离最近且落在容差 T 内的一对，位移量就是它们的差值。
 *
 * 为什么是「基准线 × 候选线」而不是只比左上角：
 *   只比起边的话，「把 A 的右边缘贴到 B 的左边缘」这类最常见的对齐永远吸不住；
 *   三条基准线两两交叉后，上/下/左/右四种边与中心线就都能吸附了。
 *
 * 校正后再回收一次「精确对齐」的线：位移后可能不止一条线重合
 * （比如宽度相同、左右两边同时贴住），这些都要画出来。
 */
function snapAxis(pos: number, size: number, lines: number[], T: number): AxisSnap {
  const ownOf = (p: number) => [p, p + size / 2, p + size] // 起边 / 中心 / 止边
  let best: { d: number; delta: number } | null = null
  for (const o of ownOf(pos)) {
    for (const l of lines) {
      const delta = l - o
      const d = Math.abs(delta)
      if (d <= T && (!best || d < best.d)) best = { d, delta }
    }
  }
  const out = best ? pos + best.delta : pos
  const guides: number[] = []
  for (const o of ownOf(out)) {
    for (const l of lines) {
      if (Math.abs(l - o) < 0.01 && guides.indexOf(l) < 0) guides.push(l)
    }
  }
  return { pos: out, guides }
}

/**
 * 拖拽移动吸附：上下左右四条边与中心线，全部参与对齐。
 *
 * 候选线来自两处（见 collectLines）：
 *   1. 画布 —— 左/上边界、中心线、右/下边界（贴边 + 水平垂直居中）；
 *   2. 其它可见组件 —— 各自的起边、中心、止边。
 *
 * T 是设计稿像素容差，由调用方按 scale 换算（见 CanvasStage），
 * 保证屏幕上看起来始终是同样松紧的手感。
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
  const maxX = Math.max(0, DESIGN_W - w)
  const maxY = Math.max(0, DESIGN_H - h)

  // 顺序很重要：先把位置约束进画布，再吸附。
  // 反过来的话，「吸附到某条线」的结果可能又被边界拉回来 —— 位置和校准线就对不上了
  // （实测：拖到画布右边界附近时先吸到相邻组件边 x=1480，再被约束回 1478，线却画在 1480）。
  // 约束在前还有个好处：贴着边界时 right / bottom 天然精确落在 1920 / 1080 上，吸附优先级最高。
  const cx = Math.min(Math.max(x, 0), maxX)
  const cy = Math.min(Math.max(y, 0), maxY)
  const ax = snapAxis(cx, w, collectLines(components, skipId, false), T)
  const ay = snapAxis(cy, h, collectLines(components, skipId, true), T)

  // 兜底：吸附结果仍不允许出界（正常情况下不会触发，触发说明对齐线在画布外）
  const nx = Math.min(Math.max(ax.pos, 0), maxX)
  const ny = Math.min(Math.max(ay.pos, 0), maxY)
  if (nx !== ax.pos) ax.guides.length = 0
  if (ny !== ay.pos) ay.guides.length = 0

  const guides: Guide[] = []
  ax.guides.forEach((p) => guides.push({ axis: 'v', pos: p }))
  ay.guides.forEach((p) => guides.push({ axis: 'h', pos: p }))
  return { x: Math.round(nx), y: Math.round(ny), guides }
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
