/**
 * ============================================================
 * 显示端适配 —— 预览 / 导出 HTML / 导出 Vue·React 工程共用
 * ============================================================
 * 策略：**盒子铺满 + 内容等比**
 *
 *   ① 每个组件的外层盒子用「百分比」定位和定尺寸：
 *      left/top/width/height 都是相对「内容区」的百分比 ⇒ 屏幕多宽多高，
 *      盒子就撑多宽多高，四条边严丝合缝，不留边、不裁切；
 *   ② 盒子里面放一层 .sf-fit（设计稿像素尺寸），按 k 等比缩放后居中：
 *      k = min(盒宽/设计宽, 盒高/设计高) ⇒ 宽高同比，
 *      饼图、仪表盘、雷达图的圆永远是正圆，文字也不会被纵向拉长；
 *   ③ 盒子被拉宽/拉高时，多出来的空间由 .sf-fit 居中留白（卡片背景色兜住），
 *      所以视觉上是「卡片随屏幕自适应，卡片里的内容保持原比例」。
 *
 * 编辑器画布不走这套：编辑时必须看到完整的 1920×1080 版面本身，
 * 由 CanvasStage 做 letterbox 缩放，renderer 按设计稿像素绝对定位。
 */

import type { ScreenSchema } from './schema'
import type { ThemeToken } from './themes'

/** 页面背景 CSS 值（用户覆盖色，否则主题的顶部辉光渐变） */
export function pageBackground(schema: ScreenSchema, t: ThemeToken): string {
  return (
    schema.page.background ||
    `radial-gradient(130% 95% at 50% 0%,${t.panel} 0%,${t.bg} 62%)`
  )
}

/** 背景层的填充方式：用户可能填图片 url()，按 cover 最稳妥 */
export const BG_FILL = 'background-size:cover;background-position:center;background-repeat:no-repeat;'

/** 极简矩形（只要有位置和尺寸，不依赖 ComponentItem） */
export interface Box {
  x: number
  y: number
  w: number
  h: number
  rotate?: number
}

/** 一个组件在屏幕上的落位 */
export interface Slot {
  /** 外层盒子（百分比字符串，可直接写进 style） */
  left: string
  top: string
  width: string
  height: string
  /** 内容等比缩放系数（设计尺寸 → 盒子尺寸的 contain） */
  k: number
  /** 内容层在盒子内的居中偏移（px） */
  dx: number
  dy: number
  /** 是否跨满整屏（通栏标题 / 整屏底色）：这类元素强制铺满，不按内容区算 */
  spanX: boolean
  spanY: boolean
}

export interface FillLayout {
  /** 百分比坐标基准（内容区，已剔除页面四周留白） */
  bbox: Box
  /** 计算某个组件的落位 */
  place(r: Box): Slot
}

/**
 * 「跨满整屏」的判定阈值。
 * 通栏标题、整屏底色在某个方向上几乎占满画布，它们必须整条铺满，
 * 不能跟着内容区做百分比（否则会缩到中间去）。
 */
const SPAN_RATIO = 0.97

/** 百分比字符串（保留 4 位，避免极长小数） */
function pct(v: number): string {
  return `${Math.round(v * 10000) / 10000}%`
}

/**
 * 计算百分比铺满布局。
 *
 * @param W 设计稿宽  @param H 设计稿高
 * @param vw 视口宽   @param vh 视口高（用于算盒子的真实像素尺寸与内容缩放系数）
 * @param boxes 参与布局的组件矩形（隐藏组件请先过滤掉）
 */
export function computeFill(W: number, H: number, vw: number, vh: number, boxes: Box[]): FillLayout {
  const items = boxes.filter((b) => b.w > 0 && b.h > 0)

  /* ---- 内容区：剔除页面四周留白，让内容真正顶到屏幕四条边 ---- */
  const xs = items.filter((b) => b.w < W * SPAN_RATIO)
  const ys = items.filter((b) => b.h < H * SPAN_RATIO)
  const xsSrc = xs.length ? xs : items
  const ysSrc = ys.length ? ys : items

  let x0 = Infinity
  let x1 = -Infinity
  let y0 = Infinity
  let y1 = -Infinity
  for (const b of xsSrc) {
    if (b.x < x0) x0 = b.x
    if (b.x + b.w > x1) x1 = b.x + b.w
  }
  for (const b of ysSrc) {
    if (b.y < y0) y0 = b.y
    if (b.y + b.h > y1) y1 = b.y + b.h
  }
  if (!isFinite(x0) || !isFinite(y0)) {
    x0 = 0; x1 = W; y0 = 0; y1 = H
  }
  const bw = Math.max(1, x1 - x0)
  const bh = Math.max(1, y1 - y0)

  return {
    bbox: { x: x0, y: y0, w: bw, h: bh },
    place(r: Box): Slot {
      const spanX = r.w >= W * SPAN_RATIO
      const spanY = r.h >= H * SPAN_RATIO
      const leftPct = spanX ? 0 : ((r.x - x0) / bw) * 100
      const widthPct = spanX ? 100 : (r.w / bw) * 100
      const topPct = spanY ? 0 : ((r.y - y0) / bh) * 100
      const heightPct = spanY ? 100 : (r.h / bh) * 100

      // 盒子真实像素尺寸 → 内容等比放大到「尽量填满盒子且不变形」
      const slotW = (widthPct / 100) * vw
      const slotH = (heightPct / 100) * vh
      const k = Math.min(slotW / r.w, slotH / r.h) || 1
      return {
        left: pct(leftPct),
        top: pct(topPct),
        width: pct(widthPct),
        height: pct(heightPct),
        k,
        dx: Math.round((slotW - r.w * k) / 2),
        dy: Math.round((slotH - r.h * k) / 2),
        spanX,
        spanY,
      }
    },
  }
}

/** 等比缩放结果（编辑器 letterbox 用） */
export interface FitBox {
  k: number
  left: number
  top: number
}

/** 计算内容的等比缩放与居中偏移（整张设计稿当成一张图） */
export function fitBox(
  W: number,
  H: number,
  vw: number,
  vh: number,
  mode: 'contain' | 'cover' = 'contain',
): FitBox {
  const k = mode === 'cover' ? Math.max(vw / W, vh / H) : Math.min(vw / W, vh / H)
  return { k, left: Math.round((vw - W * k) / 2), top: Math.round((vh - H * k) / 2) }
}
