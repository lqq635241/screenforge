/**
 * 铺满自适应回归：多种屏幕比例下验证
 *   ① 盒子铺满：内容左/上贴 0、右/下贴视口（误差 ≤ 1.5px），覆盖率 100%
 *   ② 不裁切：没有组件超出视口
 *   ③ 内容等比：每个组件的内容层 .sf-fit 视觉宽高比 == 设计稿宽高比（圆不会被压扁）
 *   ④ 盒子自适应：盒子宽高比允许随屏幕变化（这正是百分比铺满的效果）
 *   ⑤ 编辑器画布保持 1920×1080 不受影响
 */
import { chromium } from 'playwright'

const SIZES = [
  { w: 1920, h: 1080, name: '16:9 基准' },
  { w: 1600, h: 1200, name: '4:3' },
  { w: 1366, h: 768, name: '16:9 小屏' },
  { w: 2560, h: 1080, name: '21:9 超宽' },
  { w: 1280, h: 1024, name: '5:4' },
  { w: 3840, h: 2160, name: '4K' },
]

const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e)))
await page.goto('http://localhost:8321/', { waitUntil: 'networkidle' })
await page.waitForSelector('#screenRoot > div')
await page.waitForTimeout(500)

const canvas = await page.evaluate(() => {
  const el = document.getElementById('screenRoot')
  const b = el.getBoundingClientRect()
  return { w: el.style.width, h: el.style.height, rectW: +b.width.toFixed(1), rectH: +b.height.toFixed(1) }
})
console.log(`编辑器画布: style ${canvas.w} × ${canvas.h}（视觉 ${canvas.rectW} × ${canvas.rectH}）`)

await page.getByRole('button', { name: '预览' }).click()
await page.waitForSelector('#previewRoot > div')
await page.waitForTimeout(700)

let fails = 0
for (const s of SIZES) {
  await page.setViewportSize({ width: s.w, height: s.h })
  await page.waitForTimeout(500)
  const r = await page.evaluate(() => {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const items = [...document.querySelectorAll('#previewRoot > div[data-cid]')].map((el) => {
      const b = el.getBoundingClientRect()
      const f = el.querySelector('.sf-fit')
      const fb = f ? f.getBoundingClientRect() : null
      return {
        cid: el.getAttribute('data-cid'),
        dw: parseFloat(el.style.width) && f ? parseFloat(f.style.width) : 0,
        dh: f ? parseFloat(f.style.height) : 0,
        x: +b.x.toFixed(2), y: +b.y.toFixed(2),
        w: +b.width.toFixed(2), h: +b.height.toFixed(2),
        right: +(b.x + b.width).toFixed(2), bottom: +(b.y + b.height).toFixed(2),
        fw: fb ? +fb.width.toFixed(2) : 0,
        fh: fb ? +fb.height.toFixed(2) : 0,
        boxPct: el.style.width,
      }
    })
    return { vw, vh, items }
  })
  const { vw, vh, items } = r
  const minL = Math.min(...items.map((i) => i.x))
  const maxR = Math.max(...items.map((i) => i.right))
  const minT = Math.min(...items.map((i) => i.y))
  const maxB = Math.max(...items.map((i) => i.bottom))

  const edges = {
    left: Math.abs(minL),
    top: Math.abs(minT),
    right: Math.abs(vw - maxR),
    bottom: Math.abs(vh - maxB),
  }
  const flushed = Object.values(edges).every((v) => v <= 1.5)
  const spill = items.filter((i) => i.x < -1.5 || i.y < -1.5 || i.right > vw + 1.5 || i.bottom > vh + 1.5)
  // 内容层比例：视觉宽高比 vs 设计稿宽高比
  const distort = items.filter((i) => i.dw > 0 && Math.abs(i.fw / i.dw - i.fh / i.dh) > 0.005)
  // 百分比：宽高都应是 % 字符串
  const pctBad = items.filter((i) => !String(i.boxPct).endsWith('%'))

  const ok = flushed && !spill.length && !distort.length && !pctBad.length
  if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${s.name.padEnd(9)} ${String(vw).padStart(4)}×${vh}`)
  console.log(
    `      贴边 左 ${edges.left.toFixed(1)} / 上 ${edges.top.toFixed(1)} / 右 ${edges.right.toFixed(1)} / 下 ${edges.bottom.toFixed(1)}` +
      `  覆盖 ${(((maxR - minL) / vw) * 100).toFixed(1)}% × ${(((maxB - minT) / vh) * 100).toFixed(1)}%`,
  )
  if (!flushed) console.log('      ✗ 有边没贴住')
  if (spill.length) console.log(`      ✗ 超出视口 ${spill.length} 个: ${spill.slice(0, 3).map((i) => i.cid).join(',')}`)
  if (pctBad.length) console.log(`      ✗ 盒子尺寸不是百分比: ${pctBad.slice(0, 2).map((i) => `${i.cid}=${i.boxPct}`).join(',')}`)
  if (distort.length)
    console.log(
      `      ✗ 内容变形 ${distort.length} 个: ` +
        distort.slice(0, 2).map((i) => `${i.cid} 设计 ${(i.dw / i.dh).toFixed(3)} → 实际 ${(i.fw / i.fh).toFixed(3)}`).join(' | '),
    )
}

console.log(errs.length ? `页面错误: ${errs.join(' / ')}` : '页面无 JS 错误')

await page.keyboard.press('Escape')
await page.waitForTimeout(200)
const back = await page.evaluate(() => {
  const el = document.getElementById('screenRoot')
  return { w: el.style.width, h: el.style.height }
})
console.log(`退出预览后画布: ${back.w} × ${back.h}`)
if (back.w !== '1920px' || back.h !== '1080px') { fails++; console.log('✗ 退出预览后画布尺寸被改坏') }

console.log(fails === 0 ? '\n=== 全部通过 ===' : `\n=== ${fails} 项失败 ===`)
await browser.close()
process.exit(fails === 0 ? 0 : 1)
