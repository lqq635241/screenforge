import { chromium } from 'playwright'
import fs from 'node:fs'
const b = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' })
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } })
await p.goto('http://localhost:8321/', { waitUntil: 'networkidle' })
await p.waitForSelector('#screenRoot > div')
await p.waitForTimeout(700)
for (const kind of ['vue', 'react']) {
  const dl = p.waitForEvent('download')
  await p.getByRole('button', { name: kind === 'vue' ? '导出 Vue 工程' : '导出 React 工程' }).click()
  const d = await dl
  const out = `.shots/screen-${kind}.zip`
  await d.saveAs(out)
  console.log('saved', out, (fs.statSync(out).size / 1024).toFixed(0) + 'KB')
  await p.waitForTimeout(500)
}
await b.close()
