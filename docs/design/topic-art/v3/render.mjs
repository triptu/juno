// Screenshots the gallery's all-art sidebar (Sidebar, Art, every-row) under
// each direction in directions.mjs, light and dark, plus the same drawings at
// 16px and 20px. Build the gallery first (`pnpm --filter @juno/gallery build`),
// then from the repo root: node docs/design/topic-art/v3/render.mjs [ids].
// Writes renders/<direction>-<sidebar|privacy|small>-<theme>.png.
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { createRequire } from 'node:module'
const only = process.argv[2]
const here = import.meta.dirname
const dist = join(here, '../../../../apps/gallery/dist')
const outDir = join(here, 'renders')
const require = createRequire(join(here, '../../../../apps/gallery/package.json'))
const { chromium } = require('@playwright/test')
import { css, directions, HUES } from './directions.mjs'
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' }
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (p === '/') p = '/index.html'
  try { const body = await readFile(join(dist, p)); res.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream' }); res.end(body) }
  catch { res.writeHead(404); res.end() }
})
await new Promise((r) => server.listen(0, r))
const port = server.address().port
await mkdir(outDir, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1200, height: 1800 }, deviceScaleFactor: 2 })
await page.emulateMedia({ reducedMotion: 'reduce' })
const states = [['every-row', 'sidebar'], ['every-row-privacy', 'privacy']]
// Direction 5: each drawing takes the hue the Tide pebble of its topic takes (the first draw of the pebble's seeded stream).
// Round 2 painted each drawing in the hue its recipe names; main now paints the
// topic's pebble hue, so a 'recipe' direction puts the recipe's hue back.
const fixture = readFileSync(join(here, '../../../../packages/views/src/fixtures/artRows.ts'), 'utf8')
const recipeHue = Object.fromEntries([...fixture.matchAll(/^  (\w+): "<svg.*?data-hue=\\"(\w+)\\"/gm)].map((m) => [m[1], m[2]]))
const hueById = Object.fromEntries([...fixture.matchAll(/row\(\{\s+id: '([^']+)',[\s\S]*?art: studyArt\.(\w+),/g)].map((m) => [m[1], recipeHue[m[2]]]))
const byRecipe = `
  const hues = ${JSON.stringify(hueById)}
  for (const row of document.querySelectorAll('[data-topic-id]')) {
    const layer = row.querySelector('[data-topic-art="art"] > span:last-child')
    const hue = hues[row.getAttribute('data-topic-id')]
    if (layer && hue) layer.innerHTML = layer.innerHTML.replace(/--art-[a-z]+-/g, '--art-' + hue + '-')
  }`
const byTopic = `
  const names = ${JSON.stringify(Object.keys(HUES))}
  const hash = (id) => { let h = 0x811c9dc5; for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193) } return h >>> 0 }
  const first = (seed) => { let a = (seed + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  for (const row of document.querySelectorAll('[data-topic-id]')) {
    const layer = row.querySelector('[data-topic-art="art"] > span:last-child')
    if (!layer) continue
    const hue = names[Math.floor(first(hash(row.getAttribute('data-topic-id'))) * names.length)]
    layer.innerHTML = layer.innerHTML.replace(/--art-[a-z]+-/g, '--art-' + hue + '-')
  }`
for (const d of directions) {
  if (only && !only.split(',').includes(d.id)) continue
  for (const theme of ['light', 'dark']) {
    for (const [state, tag] of states) {
      if (tag === 'privacy' && !['0-now', '4-two-tone', ...(d.privacy ? [d.id] : [])].includes(d.id)) continue
      await page.goto(`http://localhost:${port}/#/Sidebar?__state=art/${state}${theme === 'dark' ? '&theme=dark' : ''}`)
      await page.locator('[data-fixture-frame]').waitFor()
      await page.evaluate(({ css, script }) => {
        document.getElementById('dir-css')?.remove()
        const s = document.createElement('style'); s.id = 'dir-css'; s.textContent = '[data-fixture-frame]{height:1640px!important;max-height:none!important}' + css; document.head.append(s)
        if (script) new Function(script)()
      }, { css: css(d, theme), script: d.hueOf === 'topic' ? byTopic : d.hueOf === 'recipe' ? byRecipe : '' })
      await page.waitForTimeout(150)
      await page.locator('[data-fixture-frame]').screenshot({ path: join(outDir, `${d.id}-${tag}-${theme}.png`) })
      // Tabs at 16 and header at 20: draw the same recipes at small sizes in a strip.
      if (tag === 'sidebar') {
        const strip = await page.evaluate(() => [...document.querySelectorAll('[data-topic-art="art"] > span:last-child')].map((n) => n.innerHTML))
        await page.evaluate((svgs) => {
          document.getElementById('dir-strip')?.remove()
          const div = document.createElement('div'); div.id = 'dir-strip'
          div.style.cssText = 'position:fixed;left:0;top:0;padding:12px;display:flex;flex-direction:column;gap:10px;z-index:99999;background:var(--background-subtle)'
          for (const size of [16, 20]) {
            const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:10px;align-items:center'
            for (const svg of svgs) { const s = document.createElement('span'); s.setAttribute('data-topic-art', 'art'); s.style.cssText = `display:inline-block;width:${size}px;height:${size}px;position:relative`; const inner = document.createElement('span'); inner.style.cssText = 'position:absolute;inset:0;line-height:0'; inner.innerHTML = svg.replace(/width="\d+" height="\d+"/, `width="${size}" height="${size}"`).replace(/stroke-width="2.75"/, size < 20 ? 'stroke-width="3.58"' : 'stroke-width="2.75"'); s.append(inner); row.append(s) }
            div.append(row)
          }
          document.body.append(div)
        }, strip)
        await page.locator('#dir-strip').screenshot({ path: join(outDir, `${d.id}-small-${theme}.png`) })
        await page.evaluate(() => document.getElementById('dir-strip')?.remove())
      }
      console.log('shot', d.id, tag, theme)
    }
  }
}
await browser.close(); server.close()
