/** 导出 HTML 回归：file:// 直接打开，验证铺满 + 内容不变形 */
import { chromium } from 'playwright'
const SIZES = [[1920,1080,'16:9'],[1600,1200,'4:3'],[2560,1080,'21:9'],[1366,768,'小屏'],[3840,2160,'4K']]
const b = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' })
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } })
const errs = []
p.on('pageerror', (e) => errs.push(String(e)))
await p.goto('file:///D:/workbuddy/2026-11-13-10-17-31/screenforge/.shots/screen.html')
await p.waitForSelector('#screen > div')
await p.waitForTimeout(1800)

let fails = 0
for (const [w, h, name] of SIZES) {
  await p.setViewportSize({ width: w, height: h })
  await p.waitForTimeout(600)
  const r = await p.evaluate(() => {
    const vw = innerWidth, vh = innerHeight
    const items = [...document.querySelectorAll('#screen > div[data-cid]')].map((el) => {
      const b = el.getBoundingClientRect()
      const f = el.querySelector('.sf-fit')
      const fb = f ? f.getBoundingClientRect() : null
      return {
        cid: el.getAttribute('data-cid'),
        dw: f ? parseFloat(f.style.width) : 0,
        dh: f ? parseFloat(f.style.height) : 0,
        x: b.x, y: b.y, right: b.x + b.width, bottom: b.y + b.height,
        fw: fb ? fb.width : 0, fh: fb ? fb.height : 0,
        pct: el.style.width,
      }
    })
    return { vw, vh, items }
  })
  const { vw, vh, items } = r
  const minL = Math.min(...items.map((i) => i.x))
  const maxR = Math.max(...items.map((i) => i.right))
  const minT = Math.min(...items.map((i) => i.y))
  const maxB = Math.max(...items.map((i) => i.bottom))
  const edges = [Math.abs(minL), Math.abs(minT), Math.abs(vw - maxR), Math.abs(vh - maxB)]
  const flushed = edges.every((v) => v <= 1.5)
  const spill = items.filter((i) => i.x < -1.5 || i.y < -1.5 || i.right > vw + 1.5 || i.bottom > vh + 1.5)
  const distort = items.filter((i) => i.dw > 0 && Math.abs(i.fw / i.dw - i.fh / i.dh) > 0.005)
  const pctBad = items.filter((i) => !String(i.pct).endsWith('%'))
  const ok = flushed && !spill.length && !distort.length && !pctBad.length
  if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(5)} ${vw}×${vh}  贴边 ${edges.map((e) => e.toFixed(1)).join('/')}` +
    `  覆盖 ${(((maxR - minL) / vw) * 100).toFixed(1)}%×${(((maxB - minT) / vh) * 100).toFixed(1)}%` +
    `${spill.length ? `  溢出${spill.length}` : ''}${distort.length ? `  变形${distort.length}` : ''}${pctBad.length ? `  非百分比${pctBad.length}` : ''}`)
}
console.log(errs.length ? `页面错误: ${errs.join(' / ')}` : '导出 HTML 无 JS 错误')
console.log(fails === 0 ? '=== 导出 HTML 通过 ===' : `=== ${fails} 项失败 ===`)
await b.close()
process.exit(fails ? 1 : 0)
