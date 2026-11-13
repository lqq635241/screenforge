/**
 * 运行时入口 —— 导出单文件 HTML 用
 *
 * 由 `npm run build:runtime`（esbuild）打包为 IIFE，
 * 暴露全局变量 ScreenForgeCore.createScreen。
 * echarts、地图 geoJSON、渲染器全部打进这一个文件，
 * 导出的 HTML 只需内联它 + schema JSON，即可离线运行。
 *
 * 注意：不要在编辑器代码里 import 本文件，编辑器直接用 renderer.ts。
 */

import { createScreen } from './renderer'

export { createScreen }
