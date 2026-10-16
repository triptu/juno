// Tabs through one gallery state and prints each stop's role and name.
// node tabwalk.mjs <Component> <group/state> [stops]
const pw = await import(process.env.PW ?? '@playwright/test')
const chromium = pw.chromium ?? pw.default.chromium
const [component, state, stops = '30'] = process.argv.slice(2)
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
await page.goto(`http://localhost:${process.env.GALLERY_PORT ?? '4391'}/#/${component}?__state=${state}`)
await page.waitForSelector('[data-fixture-frame]')
await page.locator('[data-fixture-frame]').evaluate((frame) => { frame.setAttribute('tabindex', '-1'); frame.focus() })
const walk = []
for (let i = 0; i < Number(stops); i++) {
  await page.keyboard.press('Tab')
  walk.push(await page.evaluate(() => {
    const e = document.activeElement
    if (!e || !e.closest('[data-fixture-frame]')) return '(left the frame)'
    const ring = getComputedStyle(e).outlineStyle !== 'none'
    return `${e.getAttribute('role') ?? e.tagName.toLowerCase()} "${(e.getAttribute('aria-label') ?? e.textContent ?? '').trim().slice(0, 30)}"${ring ? '' : ' (no ring)'}`
  }))
  if (walk.at(-1) === '(left the frame)') break
}
console.log(walk.join('\n'))
await browser.close()
