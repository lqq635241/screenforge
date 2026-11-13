/**
 * ============================================================
 * 主题 token —— 换肤的本质：改 12 个值，全屏颜色一起变
 * ============================================================
 * 管线：token ──┬─→ buildOption() 生成 ECharts option 的颜色
 *              └─→ renderer.ts  生成 DOM 组件的内联样式
 * 红线：物料 / 渲染器代码里禁止出现裸色值，一律取 token。
 */

/** 主题 token 定义 */
export interface ThemeToken {
  label: string
  /** 页面背景 */
  bg: string
  /** 卡片面板底色 */
  panel: string
  /** 卡片边框 */
  panelBorder: string
  /** 文字主色 */
  text: string
  /** 文字副色 */
  sub: string
  /** 强调色（标题光条、进度高亮、进度环……） */
  accent: string
  /** 网格线 / 分割线 / 地图低值区域 */
  grid: string
  /** 图表系列色（5 色） */
  palette: string[]
}

/** 四套预设主题 */
export const THEMES: Record<string, ThemeToken> = {
  'deep-blue': {
    label: '深海蓝', bg: '#060B1A', panel: '#0A1526', panelBorder: '#16304F',
    text: '#E8F3FF', sub: '#7C99BF', accent: '#00D8FF', grid: '#12253F',
    palette: ['#00D8FF', '#4C7DFF', '#00E3A3', '#FFC94A', '#FF6B8B'],
  },
  midnight: {
    label: '暗夜紫', bg: '#0A0716', panel: '#140F26', panelBorder: '#2C2050',
    text: '#EFE9FF', sub: '#9B8FC4', accent: '#A97BFF', grid: '#201838',
    palette: ['#A97BFF', '#5B8CFF', '#38E0C8', '#FF7BC4', '#FFD166'],
  },
  obsidian: {
    label: '曜石金', bg: '#0A0A0B', panel: '#131314', panelBorder: '#2A2823',
    text: '#F5F0E6', sub: '#9A9384', accent: '#E8B35A', grid: '#232120',
    palette: ['#E8B35A', '#C9A227', '#8FA88C', '#D8D2C4', '#A8703E'],
  },
  paper: {
    label: '极简白', bg: '#F2F5F9', panel: '#FFFFFF', panelBorder: '#DCE4EE',
    text: '#16202E', sub: '#64748B', accent: '#2563EB', grid: '#E9EEF6',
    palette: ['#2563EB', '#0EA5A4', '#F59E0B', '#8B5CF6', '#EF4444'],
  },
}

/**
 * 6 位 hex + alpha（0~1）→ 8 位 hex。
 * 用于发光、半透明色；非 hex 输入原样返回（防御用户手填 rgb() 等）。
 */
export function al(hex: string, a: number): string {
  if (typeof hex === 'string' && hex.length === 7 && hex.charAt(0) === '#') {
    const v = Math.round(a * 255).toString(16)
    return hex + (v.length === 1 ? '0' + v : v)
  }
  return hex
}

/** 两个 hex 颜色按比例 t 混合（t=0 → a，t=1 → b） */
export function hexMix(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.substr(i, 2), 16))
  const pb = [1, 3, 5].map((i) => parseInt(b.substr(i, 2), 16))
  return (
    '#' +
    pa
      .map((v, i) => {
        const s = Math.round(v + (pb[i] - v) * t).toString(16)
        return s.length < 2 ? '0' + s : s
      })
      .join('')
  )
}

/**
 * 自定义主题的派生规则：
 *   panelBorder = panel 与 text 混 22%，grid = panel 与 text 混 14%。
 * 用户只调 5 个面板色 + 5 个图表色，其余 token 自动推导——
 * 否则改了背景/面板后，边框和网格仍残留旧主题的蓝调（原型实测踩过的坑）。
 */
export function deriveCustomTheme(custom: ThemeToken): void {
  if (custom.panel.length === 7 && custom.text.length === 7) {
    custom.panelBorder = hexMix(custom.panel, custom.text, 0.22)
    custom.grid = hexMix(custom.panel, custom.text, 0.14)
  }
}

/** 初始化自定义主题（深海蓝副本）。模块加载时调用一次。 */
export function ensureCustomTheme(): void {
  if (!THEMES.custom) {
    THEMES.custom = JSON.parse(JSON.stringify(THEMES['deep-blue']))
    THEMES.custom.label = '自定义'
  }
}

// 模块加载即初始化，保证任何入口拿到 THEMES 时 custom 已存在
ensureCustomTheme()
