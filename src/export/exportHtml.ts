/**
 * ============================================================
 * 导出单文件 HTML
 * ============================================================
 * 一致性红线（DESIGN.md §9）：导出不做「代码翻译」，只做「序列化」。
 * - runtime.iife.js 是 `npm run build:runtime` 的构建产物：
 *   echarts + 地图 geoJSON + createScreen 渲染器全部打包为一个 IIFE；
 * - 导出 HTML = 页面壳 + 内联 runtime + 内联 schema/themes JSON + 引导代码；
 * - 因此导出物与编辑器渲染走的是同一份构建产物，所见即所得。
 */

import type { ScreenSchema } from '../core/schema'
import type { ThemeToken } from '../core/themes'
import { pageBackground } from '../core/fit'
import { downloadBlob } from './download'
// 构建产物以纯文本引入（?raw），随编辑器一起打包，导出时直接内联
import runtimeSrc from './runtime.iife.js?raw'

/** 生成单文件 HTML 字符串 */
export function buildExportHtml(schema: ScreenSchema, themes: Record<string, ThemeToken>): string {
  // schema 内联时转义 </，防止 JSON 里出现 </script> 截断页面
  const schemaStr = JSON.stringify(schema).replace(/<\//g, '<\\/')
  const themesStr = JSON.stringify(themes)
  const runtime = runtimeSrc.replace(/<\/script/gi, '<\\/script')
  const title = schema.page.title || '大屏'
  // 页面背景：画在铺满窗口的背景层上，内容层保持透明
  const bg = pageBackground(schema, themes[schema.page.theme] || themes.custom)

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  html,body{margin:0;height:100%;overflow:hidden;background:#000}
  /* 背景层：铺满窗口 */
  #stage{position:fixed;inset:0;overflow:hidden;background-size:cover;background-position:center;background-repeat:no-repeat}
  /* 内容层：铺满窗口，组件按百分比落位（见 runtime 里的 core/fit）
   * 四周固定留白（EDGE_GAP）由 runtime 的 computeFill 算进百分比里，这里不用 padding */
  #screen{position:absolute;inset:0;overflow:hidden;background:transparent}
</style>
</head>
<body>
<div id="stage"><div id="screen"></div></div>
<script>${runtime}<\/script>
<script>
var SCHEMA = ${schemaStr};
var THEMES = ${themesStr};
var BG = ${JSON.stringify(bg)};
var stage = document.getElementById("stage");
var el = document.getElementById("screen");
// 背景铺满（background 简写会重置 size/position/repeat，必须随后单独设一次）
stage.style.background = BG;
stage.style.backgroundSize = "cover";
stage.style.backgroundPosition = "center";
stage.style.backgroundRepeat = "no-repeat";
// fill:true —— 每个组件的盒子按百分比铺满屏幕，盒子里的内容等比缩放（圆不变形）
var scene = ScreenForgeCore.createScreen(el, SCHEMA, { themes: THEMES, fill: true, paintBackground: false });
// 窗口尺寸变化：重算百分比布局 + 重排 + 图表 resize
window.addEventListener("resize", function () { scene.resize(); });
<\/script>
</body>
</html>`
}

/** 导出并下载 screen.html */
export function exportHtmlFile(schema: ScreenSchema, themes: Record<string, ThemeToken>): void {
  const html = buildExportHtml(schema, themes)
  downloadBlob('screen.html', new Blob([html], { type: 'text/html;charset=utf-8' }))
}

export { downloadBlob }
