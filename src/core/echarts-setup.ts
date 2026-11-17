/**
 * ============================================================
 * ECharts 按需注册 —— 全项目唯一的 echarts 出口（P1 性能优化核心）
 * ============================================================
 * 为什么存在：
 *   - `import * as echarts from 'echarts'` 是全量入口（约 1MB min），
 *     即使大屏只用折线图，1MB 也一分不少地进了产物；
 *   - echarts 5 官方推荐 tree-shaking 用法：从 'echarts/core' 引入核心 +
 *     按声明顺序注册用到的图表 / 组件 / 渲染器，产物体积按实际用量裁剪。
 *
 * 谁在用它（三种运行形态必须全部走这里，缺一会导致注册不一致）：
 *   - 编辑器 / 预览：renderer.ts、option.ts；
 *   - 导出单文件 HTML：runtime-entry.ts → renderer.ts（esbuild 打包）；
 *   - 导出 Vue / React 工程：project.ts 会生成一份同样内容的
 *     src/lib/echarts.ts（模板见 generateEchartsSetup()），子组件从它导入。
 *
 * 新增一种图表/组件时：
 *   1. 在下方 use([...]) 里补对应 Chart/Component；
 *   2. 同步更新 project.ts 里的 generateEchartsSetup() 模板，保持两处一致。
 */

import * as echarts from 'echarts/core'
import {
  LineChart, BarChart, PieChart, GaugeChart, MapChart, RadarChart,
} from 'echarts/charts'
import {
  GridComponent, TooltipComponent, LegendComponent,
  VisualMapComponent, AxisPointerComponent, DataZoomComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

/* 本项目物料用到的能力全景：
 * - 图表：line / bar / pie / gauge / map / radar（见 materials.ts）
 * - 组件：grid(直角坐标系) / tooltip / legend / visualMap(地图色阶) /
 *         axisPointer(tooltip 的指示线) / dataZoom(折线柱状的数据缩放条)
 * - 渲染器：Canvas（大屏多图表场景下 canvas 比 svg 更稳）
 *
 * 注意 dataZoom：不注册的话 option 里的 dataZoom 会被静默忽略 ——
 * 没有任何报错，图表照常渲染，只是缩放条不出现，很难排查。
 */
echarts.use([
  LineChart, BarChart, PieChart, GaugeChart, MapChart, RadarChart,
  GridComponent, TooltipComponent, LegendComponent, VisualMapComponent,
  AxisPointerComponent, DataZoomComponent, CanvasRenderer,
])

/** 命名空间整体再导出：调用方写法与全量引入完全一致（echarts.init / registerMap ...） */
export { echarts }

/** 图表实例类型（echarts/core 下的类型别名） */
export type ECharts = echarts.EChartsType
