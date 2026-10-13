// Screenshots each section of sheet.html to <key>.png.
// Run from this folder: node render.mjs
import { createRequire } from 'node:module'
import path from 'node:path'
const require = createRequire('/Users/tushar/.t3/projects/juno/.claude/worktrees/topic-art/apps/gallery/package.json')
const { chromium } = require('@playwright/test')

const dir = process.cwd()
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1480, height: 1000 }, deviceScaleFactor: 2 })
await page.goto('file://' + path.join(dir, 'sheet.html'))
await page.evaluate(() => document.fonts.ready)
await page.waitForTimeout(300)
for (const s of await page.$$('section[data-key]')) {
  const key = await s.getAttribute('data-key')
  await s.screenshot({ path: path.join(dir, `${key}.png`) })
  console.log('wrote', `${key}.png`)
}
await browser.close()
