import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'

const ROOT = 'D:/workbuddy/2026-11-13-10-17-31/screenforge'
const b = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' })
const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, acceptDownloads: true })
await p.goto('http://localhost:8321/', { waitUntil: 'networkidle' })
await p.waitForSelector('#screenRoot > div')
await p.waitForTimeout(600)

await p.locator('#topbar').screenshot({ path: `${ROOT}/.shots/topbar-json.png` })

// 先改一个字段，确认导出的是「当前状态」而不是初始值
await p.locator('#screenRoot > div[data-cid="c5"]').click()
await p.waitForTimeout(200)
const titleInput = p.locator('input[aria-label="标题"]')
await titleInput.fill('热门站点 TOP8')
await titleInput.blur()
await p.waitForTimeout(300)

const [dl] = await Promise.all([
  p.waitForEvent('download'),
  p.getByRole('button', { name: '导出 JSON' }).click(),
])
const name = dl.suggestedFilename()
const file = `${ROOT}/.shots/dl/${name}`
await dl.saveAs(file)
const txt = readFileSync(file, 'utf8')
const obj = JSON.parse(txt)

console.log('文件名:', name)
console.log('体积:', txt.length, 'bytes')
console.log('顶层键:', Object.keys(obj).join(', '))
console.log('组件数:', obj.components.length)
console.log('第一个组件:', JSON.stringify(obj.components[0]))
const c5 = obj.components.find((c) => c.id === 'c5')
console.log('改过的 c5.props:', JSON.stringify(c5.props))
console.log('c1 是否含空 http:', 'http' in obj.components.find((c) => c.id === 'c1'))
console.log('toast:', (await p.locator('#toast').textContent())?.trim())
await b.close()
