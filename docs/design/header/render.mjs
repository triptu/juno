// Screenshots each section of mock.html to <key>.png. Run from this folder:
// node render.mjs [--only key1,key2]. Playwright comes from the gallery's
// dependencies; a worktree without node_modules falls back to the main checkout.
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
const candidates = [path.resolve('../../../apps/gallery/package.json'), '/Users/tushar/.t3/projects/juno/apps/gallery/package.json']
const galleryPkg = candidates.find((p) => fs.existsSync(path.join(path.dirname(p), 'node_modules')))
const { chromium } = createRequire(galleryPkg)('@playwright/test')

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]] : [])).filter(Boolean))
const only = args.only ? args.only.split(',') : null
const dir = process.cwd()
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 }, deviceScaleFactor: 2, reducedMotion: 'reduce' })
await page.goto('file://' + path.join(dir, 'mock.html'))
await page.evaluate(() => document.fonts.ready)
await page.waitForTimeout(800)
for (const s of await page.$$('section[data-key]')) {
  const key = await s.getAttribute('data-key')
  if (only && !only.includes(key)) continue
  await s.screenshot({ path: path.join(dir, `${key}.png`) })
  console.log('wrote', `${key}.png`)
}
await browser.close()
