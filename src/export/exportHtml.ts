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
// 构建产物以纯文本引入（?raw），随编辑器一起打包，导出时直接内联
import runtimeSrc from './runtime.iife.js?raw'

/** 触发浏览器下载 Blob */
function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}

/** 生成单文件 HTML 字符串 */
export function buildExportHtml(schema: ScreenSchema, themes: Record<string, ThemeToken>): string {
  // schema 内联时转义 </，防止 JSON 里出现 </script> 截断页面
  const schemaStr = JSON.stringify(schema).replace(/<\//g, '<\\/')
  const themesStr = JSON.stringify(themes)
  const runtime = runtimeSrc.replace(/<\/script/gi, '<\\/script')
  const title = schema.page.title || '大屏'

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  html,body{margin:0;height:100%;overflow:hidden;background:#000}
  #stage{position:fixed;inset:0}
  #screen{position:absolute;left:0;top:0;transform-origin:0 0}
</style>
</head>
<body>
<div id="stage"><div id="screen"></div></div>
<script>${runtime}<\/script>
<script>
var SCHEMA = ${schemaStr};
var THEMES = ${themesStr};
var el = document.getElementById("screen");
var scene = ScreenForgeCore.createScreen(el, SCHEMA, { themes: THEMES });
// 16:9 letterbox 等比缩放 + 居中
function fit() {
  var w = SCHEMA.page.width, h = SCHEMA.page.height;
  var k = Math.min(window.innerWidth / w, window.innerHeight / h);
  el.style.transform = "scale(" + k + ")";
  el.style.left = Math.round((window.innerWidth - w * k) / 2) + "px";
  el.style.top = Math.round((window.innerHeight - h * k) / 2) + "px";
}
fit();
window.addEventListener("resize", function () { fit(); scene.resize(); });
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
