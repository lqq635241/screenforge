import { chromium } from 'playwright'
const b = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' })
const p = await b.newPage({ viewport: { width: 2560, height: 1080 } })
const errs = []
p.on('pageerror', (e) => errs.push(String(e)))
await p.goto('http://localhost:8328/', { waitUntil: 'networkidle' })
await p.waitForTimeout(1800)
await p.screenshot({ path: '.shots/react-21x9.png' })
const m = await p.evaluate(() => {
  const rs = [...document.querySelectorAll('.screen > .abs')].map((e) => e.getBoundingClientRect())
  return { vw: innerWidth, vh: innerHeight, n: rs.length,
    minL: Math.min(...rs.map((r) => r.x)), minT: Math.min(...rs.map((r) => r.y)),
    maxR: Math.max(...rs.map((r) => r.x + r.width)), maxB: Math.max(...rs.map((r) => r.y + r.height)) }
})
console.log(JSON.stringify(m), errs.length ? 'errs:' + errs.join('|') : 'no-js-error')
await b.close()
