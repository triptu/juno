// Puts the sidebar renders side by side, cropped to the rows, one sheet per theme: renders/compare-<theme>.png.
// `node sheet.mjs <name> <id,id,...>` sheets only those directions, as renders/<name>-<theme>.png.
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { directions as all } from './directions.mjs'
const here = import.meta.dirname
const [name = 'compare', ids] = process.argv.slice(2)
const directions = ids ? ids.split(',').map((id) => all.find((d) => d.id === id)) : all.filter((d) => /^[0-5]-/.test(d.id))
const { chromium } = createRequire(join(here, '../../../../apps/gallery/package.json'))('@playwright/test')
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ deviceScaleFactor: 1 })
for (const theme of ['light', 'dark']) {
  const cells = directions.map((d) => {
    const src = `data:image/png;base64,${readFileSync(join(here, 'renders', `${d.id}-sidebar-${theme}.png`)).toString('base64')}`
    return `<figure><figcaption>${d.id.split('-')[0]} · ${d.name}</figcaption><div class="crop"><img src="${src}"></div></figure>`
  })
  await page.setContent(`<style>body{margin:0;padding:16px;background:${theme === 'dark' ? '#0d0c0a' : '#e8e6e0'};font:600 15px system-ui;color:${theme === 'dark' ? '#ddd' : '#222'}}
    main{display:flex;gap:12px}figure{margin:0}figcaption{padding:0 0 8px}
    .crop{width:384px;height:1150px;overflow:hidden}.crop img{width:384px;margin-top:-205px}</style><main>${cells.join('')}</main>`)
  await page.setViewportSize({ width: 16 * 2 + directions.length * 396, height: 1200 })
  await page.screenshot({ path: join(here, 'renders', `${name}-${theme}.png`), fullPage: true })
}
await browser.close()
