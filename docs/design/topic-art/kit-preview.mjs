// Renders every kit motif at 40 and 16px, light and dark, to kit.png.
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { motifs, motifNames } from './motifs.mjs'
import { render } from './vocab.mjs'
import { compose } from './run-compose.mjs'

const hues = ['teal', 'sky', 'amber', 'coral', 'sage', 'olive', 'periwinkle', 'plum']
const cells = (theme) => motifNames.map((n, i) => {
  const spec = { hue: hues[i % hues.length], elements: motifs[n].elements }
  return `<div class="cell">${render(spec, { theme, size: 40, id: `${theme}${i}` })}${render(spec, { theme, size: 16, id: `${theme}s${i}` })}<span>${n}</span></div>`
}).join('')
const pairs = (theme) => [['database', 'arrow-right'], ['coins', 'chart-up'], ['id-card', 'check'], ['bug', 'warning'], ['calendar', 'people'], ['flag', 'trash'], ['board', 'cross'], ['bowl', 'calendar']]
  .map(([a, b], i) => { const spec = compose({ main: a, secondary: b, hue: hues[i] }); return `<div class="cell">${render(spec, { theme, size: 40, id: `p${theme}${i}` })}${render(spec, { theme, size: 16, id: `ps${theme}${i}` })}<span>${a}+${b}</span></div>` }).join('')
const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;font:11px Figtree,system-ui;display:flex}
.panel{padding:16px;width:760px}.light{background:#FAF9F5;color:#605E52}.dark{background:#151411;color:#C6C4BE}
.grid{display:grid;grid-template-columns:repeat(8,1fr);gap:10px 6px}
.cell{display:flex;flex-direction:column;align-items:center;gap:4px}.cell svg{display:block}.cell span{font-size:9.5px}
h3{font-weight:500;margin:14px 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:.06em}
</style>
<div class="panel light"><h3>Kit, light</h3><div class="grid">${cells('light')}</div><h3>Compositions</h3><div class="grid">${pairs('light')}</div></div>
<div class="panel dark"><h3>Kit, dark</h3><div class="grid">${cells('dark')}</div><h3>Compositions</h3><div class="grid">${pairs('dark')}</div></div>`
writeFileSync('kit.html', html)
const require = createRequire('/Users/tushar/.t3/projects/juno/.claude/worktrees/topic-art/apps/gallery/package.json')
const { chromium } = require('@playwright/test')
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1520, height: 900 }, deviceScaleFactor: 2 })
await page.goto('file://' + process.cwd() + '/kit.html')
await page.screenshot({ path: 'kit.png', fullPage: true })
await browser.close()
console.log('wrote kit.png')
