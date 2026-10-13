// Screenshots each section of sheet.html to <key>.png, one page, one at a
// time. Run from this folder: node render.mjs [--only key1,key2]
import { createRequire } from 'node:module'
import path from 'node:path'
const require = createRequire(path.resolve('../../../../apps/gallery/package.json'))
const { chromium } = require('@playwright/test')

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]] : []).filter(Boolean))
const only = args.only ? args.only.split(',') : null
const dir = process.cwd()
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1780, height: 1000 }, deviceScaleFactor: 2 })
await page.goto('file://' + path.join(dir, 'sheet.html'))
await page.evaluate(() => document.fonts.ready)
await page.waitForTimeout(300)
for (const s of await page.$$('section[data-key]')) {
  const key = await s.getAttribute('data-key')
  if (only && !only.includes(key)) continue
  await s.screenshot({ path: path.join(dir, `${key}.png`) })
  console.log('wrote', `${key}.png`)
}
await browser.close()
