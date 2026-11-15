/**
 * 导出工程（Vue / React）回归：四周固定留白 + 盒子铺满 + 图表撑满卡片
 * 依赖 .shots/vue/screen-vue（8327）、.shots/react/screen-react（8328）dev server
 */
import { chromium } from 'playwright'

const SIZES = [
  [1920, 1080, '16:9'],
  [1600, 1200, '4:3'],
  [2560, 1080, '21:9'],
  [1366, 768, '小屏'],
  [3840, 2160, '4K'],
]
const APPS = [
  { url: 'http://localhost:8327/', name: 'Vue' },
  { url: 'http://localhost:8328/', name: 'React' },
]

const b = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' })
let fails = 0

for (const app of APPS) {
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } })
  const errs = []
  p.on('pageerror', (e) => errs.push(String(e)))
  await p.goto(app.url, { waitUntil: 'networkidle' })
  await p.waitForSelector('.screen > .abs')
  await p.waitForTimeout(1200)

  for (const [w, h, label] of SIZES) {
    await p.setViewportSize({ width: w, height: h })
    await p.waitForTimeout(700)
    const r = await p.evaluate(() => {
      const vw = innerWidth, vh = innerHeight
      const items = [...document.querySelectorAll('.screen > .abs')].map((el) => {
        const b = el.getBoundingClientRect()
        const host = el.querySelector('.sf-chart-box, .sf-chart')
        const hb = host ? host.getBoundingClientRect() : null
        return {
          x: b.x, y: b.y, right: b.x + b.width, bottom: b.y + b.height,
          boxW: b.width, boxH: b.height,
          hostW: hb ? hb.width : 0, hostH: hb ? hb.height : 0,
          k: parseFloat(getComputedStyle(el).getPropertyValue('--sf-k')) || 1,
        }
      })
      return { vw, vh, items }
    })
    const { vw, vh, items } = r
    const gap = Math.min(24, Math.min(vw, vh) * 0.025)
    const minL = Math.min(...items.map((i) => i.x))
    const minT = Math.min(...items.map((i) => i.y))
    const maxR = Math.max(...items.map((i) => i.right))
    const maxB = Math.max(...items.map((i) => i.bottom))
    const edges = [
      Math.abs(minL - gap), Math.abs(minT - gap),
      Math.abs(vw - gap - maxR), Math.abs(vh - gap - maxB),
    ]
    const ok = edges.every((v) => v <= 1.5)
    if (!ok) fails++
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  ${app.name.padEnd(5)} ${label.padEnd(5)} ${vw}×${vh}` +
        `  留白偏差 ${edges.map((v) => v.toFixed(1)).join('/')}（gap=${gap.toFixed(1)}）` +
        `  覆盖 ${(((maxR - minL) / (vw - 2 * gap)) * 100).toFixed(1)}%×${(((maxB - minT) / (vh - 2 * gap)) * 100).toFixed(1)}%`,
    )
  }
  if (errs.length) { fails++; console.log(`${app.name} 页面错误: ${errs.join(' / ')}`) }
  await p.close()
}

console.log(fails === 0 ? '=== 导出工程通过 ===' : `=== ${fails} 项失败 ===`)
await b.close()
process.exit(fails ? 1 : 0)
