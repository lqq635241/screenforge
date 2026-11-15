/**
 * 铺满自适应回归：多种屏幕比例下验证
 *   ① 盒子铺满：内容在四周留出固定 gap（默认 24px，偏差 ≤ 1.5px），覆盖留白内区 100%
 *   ② 不裁切：没有组件超出视口
 *   ③ 盒子尺寸是百分比（宽高都随屏幕变）
 *   ④ 图表卡片：图表容器撑满卡片（宽度差 ≤ 2px，高度 = 卡片 - 标题栏）
 *   ⑤ DOM 卡片：内容层保持设计稿宽高比（文字排版不被打散）
 *   ⑥ 饼图保圆：donut 内圈横向直径 ≈ 纵向直径（容器再宽也不能变椭圆）
 *   ⑦ 编辑器画布保持 1920×1080 不受影响
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
await page.waitForTimeout(900)

/** 饼图圆度：取 donut 内圈，横向与纵向直径应相等（与容器宽高无关） */
async function pieRoundness() {
  return page.evaluate(() => {
    // 只看饼图：其他图表（地图 / 仪表盘 / 折线）的形状本来就不是环形，不能套这个尺子
    const cards = [...document.querySelectorAll('#previewRoot > div[data-type="echarts.pie"]')]
    const out = []
    for (const c of cards) {
      const cv = c.querySelector('canvas')
      if (!cv) continue
      const scale = cv.width / cv.getBoundingClientRect().width
      const ctx = cv.getContext('2d')
      const img = ctx.getImageData(0, 0, cv.width, cv.height).data
      const A = (x, y) => img[((y | 0) * cv.width + (x | 0)) * 4 + 3]
      const cx = Math.round(cv.width * 0.5)
      const cy = Math.round(cv.height * 0.46)
      const scan = (dx, dy) => {
        for (let r = 1; r < Math.min(cv.width, cv.height) / 2; r++) {
          const x = cx + dx * r
          const y = cy + dy * r
          if (x < 0 || y < 0 || x >= cv.width || y >= cv.height) return 0
          if (A(x, y) > 24) return r
        }
        return 0
      }
      const l = scan(-1, 0), r = scan(1, 0), u = scan(0, -1), d = scan(0, 1)
      const hx = l + r, hy = u + d
      // 只认「四个方向都有内圈边缘」的环形图（饼图 donut 的内圈）
      if (hx > 4 && hy > 4) out.push({ cid: c.getAttribute('data-cid'), hx: hx / scale, hy: hy / scale })
    }
    return out
  })
}

let fails = 0
for (const s of SIZES) {
  await page.setViewportSize({ width: s.w, height: s.h })
  await page.waitForTimeout(600)
  const r = await page.evaluate(() => {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const items = [...document.querySelectorAll('#previewRoot > div[data-cid]')].map((el) => {
      const b = el.getBoundingClientRect()
      const f = el.querySelector('.sf-fit')
      const host = el.querySelector('.sf-chart')
      const fb = f ? f.getBoundingClientRect() : null
      const hb = host ? host.getBoundingClientRect() : null
      const k = parseFloat(getComputedStyle(el).getPropertyValue('--sf-k')) || 1
      return {
        cid: el.getAttribute('data-cid'),
        kind: host ? 'chart' : 'dom',
        dw: f ? parseFloat(f.style.width) : 0,
        dh: f ? parseFloat(f.style.height) : 0,
        fw: fb ? +fb.width.toFixed(2) : 0,
        fh: fb ? +fb.height.toFixed(2) : 0,
        hostW: hb ? +hb.width.toFixed(2) : 0,
        hostH: hb ? +hb.height.toFixed(2) : 0,
        boxW: +b.width.toFixed(2),
        boxH: +b.height.toFixed(2),
        headH: +(42 * k).toFixed(2),
        k,
        x: +b.x.toFixed(2), y: +b.y.toFixed(2),
        right: +(b.x + b.width).toFixed(2), bottom: +(b.y + b.height).toFixed(2),
        pctW: el.style.width,
        pctH: el.style.height,
      }
    })
    return { vw, vh, items }
  })
  const { vw, vh, items } = r
  // 与 core/fit.ts 的 EDGE_GAP 规则一致：固定 24px，小屏按短边 2.5% 收窄
  const gap = Math.min(24, Math.min(vw, vh) * 0.025)
  const minL = Math.min(...items.map((i) => i.x))
  const maxR = Math.max(...items.map((i) => i.right))
  const minT = Math.min(...items.map((i) => i.y))
  const maxB = Math.max(...items.map((i) => i.bottom))

  const edges = {
    left: Math.abs(minL - gap), top: Math.abs(minT - gap),
    right: Math.abs(vw - gap - maxR), bottom: Math.abs(vh - gap - maxB),
  }
  const flushed = Object.values(edges).every((v) => v <= 1.5)
  const spill = items.filter((i) => i.x < gap - 1.5 || i.y < gap - 1.5 || i.right > vw - gap + 1.5 || i.bottom > vh - gap + 1.5)
  const pctBad = items.filter((i) => !String(i.pctW).endsWith('%') || !String(i.pctH).endsWith('%'))

  // 图表卡片：容器宽度撑满卡片（左右各 0 边距），高度 = 卡片 - 标题栏
  const charts = items.filter((i) => i.kind === 'chart')
  const chartBad = charts.filter((i) =>
    Math.abs(i.hostW - i.boxW) > 2 || Math.abs(i.hostH - (i.boxH - i.headH)) > 2)

  // DOM 卡片：内容层保持设计稿宽高比
  const doms = items.filter((i) => i.kind === 'dom' && i.dw > 0)
  const distort = doms.filter((i) => Math.abs(i.fw / i.dw - i.fh / i.dh) > 0.005)

  const ok = flushed && !spill.length && !pctBad.length && !chartBad.length && !distort.length
  if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${s.name.padEnd(9)} ${String(vw).padStart(4)}×${vh}`)
  console.log(
    `      留白 左 ${edges.left.toFixed(1)} / 上 ${edges.top.toFixed(1)} / 右 ${edges.right.toFixed(1)} / 下 ${edges.bottom.toFixed(1)}（偏差，越小越准，gap=${gap.toFixed(1)}px）` +
      `  覆盖 ${(((maxR - minL) / (vw - 2 * gap)) * 100).toFixed(1)}% × ${(((maxB - minT) / (vh - 2 * gap)) * 100).toFixed(1)}%` +
      `  图表 ${charts.length} / DOM ${doms.length}`,
  )
  if (!flushed) console.log('      ✗ 四周留白不等于 gap')
  if (spill.length) console.log(`      ✗ 超出视口 ${spill.length} 个: ${spill.slice(0, 3).map((i) => i.cid).join(',')}`)
  if (pctBad.length) console.log(`      ✗ 盒子尺寸不是百分比: ${pctBad.slice(0, 2).map((i) => `${i.cid}=${i.pctW}/${i.pctH}`).join(',')}`)
  if (chartBad.length)
    console.log(`      ✗ 图表没撑满卡片 ${chartBad.length} 个: ` +
      chartBad.slice(0, 2).map((i) => `${i.cid} 容器 ${i.hostW}×${i.hostH} / 卡片 ${i.boxW}×${i.boxH}`).join(' | '))
  if (distort.length)
    console.log(`      ✗ DOM 内容变形 ${distort.length} 个: ` +
      distort.slice(0, 2).map((i) => `${i.cid} 设计 ${(i.dw / i.dh).toFixed(3)} → 实际 ${(i.fw / i.fh).toFixed(3)}`).join(' | '))

  // 饼图圆度（只有存在 donut 内圈时才检查）
  const pies = await pieRoundness()
  for (const p of pies) {
    const ratio = p.hx / p.hy
    const round = Math.abs(ratio - 1) <= 0.04
    if (!round) fails++
    console.log(`      饼图保圆 ${p.cid}: 横向 ${p.hx.toFixed(1)} / 纵向 ${p.hy.toFixed(1)} = ${ratio.toFixed(3)} ${round ? '✓' : '✗'}`)
  }
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
