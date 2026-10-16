// Opens one gallery state and prints what an expression returns.
// node probe.mjs <Component> <group/state> <light|dark> <width> '<js expression>'
const pw = await import(process.env.PW ?? '@playwright/test')
const chromium = pw.chromium ?? pw.default.chromium
const [component, state, theme = 'light', width = '1100', expr = 'null'] = process.argv.slice(2)
const port = process.env.GALLERY_PORT ?? '4391'
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: Number(width), height: 900 }, deviceScaleFactor: 2 })
await page.goto(`http://localhost:${port}/#/${component}?__state=${state}${theme === 'dark' ? '&theme=dark' : ''}`)
await page.waitForSelector('[data-fixture-frame]')
await page.evaluate(() => document.fonts.ready)
await page.waitForTimeout(400)
const out = await page.evaluate(`(() => { const box = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x*10)/10, y: Math.round(r.y*10)/10, w: Math.round(r.width*10)/10, h: Math.round(r.height*10)/10, r: Math.round(r.right*10)/10, b: Math.round(r.bottom*10)/10 } }; const $$ = (s) => [...document.querySelectorAll(s)]; return ${expr} })()`)
console.log(JSON.stringify(out, null, 1))
// SHOT=file.png also saves the frame.
if (process.env.SHOT) await page.locator('[data-fixture-frame]').screenshot({ path: process.env.SHOT })
await browser.close()
