import { chromium } from 'playwright'
const b = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' })
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } })
const errs = []
p.on('pageerror', (e) => errs.push(String(e)))
await p.goto('http://localhost:8327/', { waitUntil: 'networkidle' })
await p.waitForTimeout(1600)
for (const [w, h, name] of [[1920, 1080, '16x9'], [2560, 1080, '21x9']]) {
  await p.setViewportSize({ width: w, height: h })
  await p.waitForTimeout(900)
  await p.screenshot({ path: `.shots/vue-${name}.png` })
}
const m = await p.evaluate(() => {
  const els = [...document.querySelectorAll('.screen > .abs')]
  const vw = innerWidth, vh = innerHeight
  const rects = els.map((e) => e.getBoundingClientRect())
  return {
    vw, vh,
    minL: Math.min(...rects.map((r) => r.x)),
    minT: Math.min(...rects.map((r) => r.y)),
    maxR: Math.max(...rects.map((r) => r.x + r.width)),
    maxB: Math.max(...rects.map((r) => r.y + r.height)),
    n: els.length,
  }
})
console.log(JSON.stringify(m), errs.length ? 'errs:' + errs.join('|') : 'no-js-error')
await b.close()
