import { chromium } from 'playwright'
const b = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' })
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } })
await p.goto('http://localhost:8321/', { waitUntil: 'networkidle' })
await p.waitForSelector('#screenRoot > div')
await p.waitForTimeout(700)
await p.getByRole('button', { name: '预览' }).click()
await p.waitForTimeout(1800)
for (const [w, h, name] of [[1920, 1080, '16x9'], [2560, 1080, '21x9'], [1600, 1200, '4x3'], [1366, 768, 'small']]) {
  await p.setViewportSize({ width: w, height: h })
  await p.waitForTimeout(900)
  await p.screenshot({ path: `D:/workbuddy/2026-11-13-10-17-31/screenforge/.shots/fill-${name}.png` })
}
// 饼图正圆校验：量 canvas 里彩色像素的包围盒（忽略透明）
await p.setViewportSize({ width: 2560, height: 1080 })
await p.waitForTimeout(900)
const info = await p.evaluate(() => [...document.querySelectorAll('#previewRoot > div[data-cid]')].map((el) => {
  const f = el.querySelector('.sf-fit')
  const box = el.getBoundingClientRect()
  const fit = f ? f.getBoundingClientRect() : null
  return { cid: el.getAttribute('data-cid'), box: [Math.round(box.width), Math.round(box.height)], fit: fit ? [Math.round(fit.width), Math.round(fit.height)] : null }
}))
console.log(JSON.stringify(info))
await b.close()
