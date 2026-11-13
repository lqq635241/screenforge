/**
 * 初始示例大屏 —— 首次打开编辑器时加载的内容
 * 13 个组件覆盖全部物料类型，方便用户开箱即看到各种效果。
 */

import type { ScreenSchema } from './schema'

export const INITIAL: ScreenSchema = {
  version: 1,
  page: { width: 1920, height: 1080, theme: 'deep-blue', background: '', title: '城市运行监测中心' },
  components: [
    { id: 't1', type: 'deco.title', name: '主标题', rect: { x: 0, y: 22, w: 1920, h: 96 }, z: 9,
      props: { text: '城市运行监测中心', sub: 'CITY OPERATION MONITORING CENTER', size: 38 } },
    { id: 'clk', type: 'deco.clock', name: '时间', rect: { x: 1480, y: 26, w: 400, h: 40 }, z: 10, props: {} },

    { id: 'k1', type: 'deco.number', name: '今日客流', rect: { x: 40, y: 132, w: 442, h: 132 }, z: 1,
      props: { label: '今日客流', value: 128436, unit: '人次', delta: '+12.4%', dir: 'up' } },
    { id: 'k2', type: 'deco.number', name: '在线设备', rect: { x: 506, y: 132, w: 442, h: 132 }, z: 1,
      props: { label: '在线设备', value: 3842, unit: '台', delta: '98.2% 在线', dir: '' } },
    { id: 'k3', type: 'deco.number', name: '事件告警', rect: { x: 972, y: 132, w: 442, h: 132 }, z: 1,
      props: { label: '事件告警', value: 27, unit: '件', delta: '8 件', dir: 'down' } },
    { id: 'k4', type: 'deco.number', name: '平均响应', rect: { x: 1438, y: 132, w: 442, h: 132 }, z: 1,
      props: { label: '平均响应', value: 4.2, unit: '分钟', dec: 1, delta: '0.6', dir: 'down' } },

    { id: 'c1', type: 'echarts.line', name: '客流趋势', rect: { x: 40, y: 292, w: 940, h: 336 }, z: 1,
      props: { title: '今日客流趋势（分时）', smooth: true, area: true, showLegend: true },
      data: {
        categories: ['00', '02', '04', '06', '08', '10', '12', '14', '16', '18', '20', '22'],
        series: [
          { name: '进站', values: [120, 86, 64, 320, 980, 1240, 1080, 960, 1180, 1420, 860, 320] },
          { name: '出站', values: [96, 72, 58, 260, 820, 1080, 1240, 1020, 1080, 1560, 980, 380] },
        ],
      } },
    { id: 'c2', type: 'echarts.pie', name: '出行方式', rect: { x: 1004, y: 292, w: 380, h: 336 }, z: 1,
      props: { title: '出行方式占比', donut: true },
      data: { items: [
        { name: '地铁', value: 4820 }, { name: '公交', value: 3140 }, { name: '出租', value: 1620 },
        { name: '骑行', value: 980 }, { name: '其他', value: 420 },
      ] } },
    { id: 'm1', type: 'echarts.map', name: '全国分布', rect: { x: 1408, y: 292, w: 472, h: 336 }, z: 1,
      props: { title: '全国客流分布' },
      data: { items: [
        { name: '广东', value: 820 }, { name: '北京', value: 640 }, { name: '浙江', value: 520 },
        { name: '江苏', value: 430 }, { name: '四川', value: 460 }, { name: '山东', value: 380 },
        { name: '湖北', value: 300 }, { name: '福建', value: 260 }, { name: '陕西', value: 200 },
        { name: '河南', value: 240 }, { name: '辽宁', value: 170 }, { name: '上海', value: 350 },
      ] } },

    { id: 'c3', type: 'echarts.bar', name: '区域客流', rect: { x: 40, y: 662, w: 600, h: 368 }, z: 1,
      props: { title: '各区域客流对比', showLegend: true, barWidth: 16 },
      data: {
        categories: ['中心区', '东城区', '西城区', '南山区', '北站区', '高新区'],
        series: [
          { name: '本周', values: [1820, 1460, 1280, 1120, 940, 760] },
          { name: '上周', values: [1560, 1320, 1180, 980, 880, 690] },
        ],
      } },
    { id: 'c4', type: 'echarts.gauge', name: '车位占用', rect: { x: 664, y: 662, w: 380, h: 368 }, z: 1,
      props: { title: '车位占用率', label: '当前占用', max: 100, unit: '%' }, data: { value: 68 } },
    { id: 's1', type: 'deco.scrollList', name: '实时事件流', rect: { x: 1068, y: 662, w: 380, h: 368 }, z: 1,
      props: { title: '实时事件流', rowH: 34, speed: 2 },
      data: { items: [
        { name: '东区机房 A-01', value: 'CPU 92%', status: 'err' },
        { name: '南区网关 G-14', value: '丢包 3.1%', status: 'warn' },
        { name: '支付网关 P-02', value: '延迟 820ms', status: 'warn' },
        { name: '北区存储 S-07', value: '容量 76%', status: 'ok' },
        { name: '调度中心 D-01', value: '队列 1204', status: 'ok' },
        { name: '西区缓存 C-19', value: '命中率 98%', status: 'ok' },
        { name: '东区机房 A-05', value: 'CPU 45%', status: 'ok' },
        { name: '数据库主库 M-01', value: '连接 4820', status: 'warn' },
        { name: '备份节点 B-03', value: '进度 64%', status: 'ok' },
      ] } },
    { id: 'c5', type: 'deco.rank', name: '热门站点', rect: { x: 1472, y: 662, w: 408, h: 368 }, z: 1,
      props: { title: '热门站点 TOP5', top: 5 },
      data: { items: [
        { name: '中央车站', value: 4820 }, { name: '科技园站', value: 3640 },
        { name: '体育中心', value: 2980 }, { name: '老城广场', value: 2140 },
        { name: '机场 T2', value: 1620 },
      ] } },
  ],
  dataSources: [],
}
