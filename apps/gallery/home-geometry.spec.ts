import { expect, test, type Page } from '@playwright/test'
import { openState, type Route } from './support'

/**
 * Home's Automated question (inventory, Home "Automated"): its title and
 * meta lines start at one edge, the reason takes an ellipsis before the
 * buttons, and the buttons sit the same distance from the row's top and
 * bottom.
 */

const open = (page: Page, component: string, id: string) =>
  openState(page, { component, id, route: `${component}/${id}`, group: '', groupId: '', state: '', frame: {} } satisfies Route)

for (const [state, title, meta] of [
  ['items/automated', 'Move #releases?', 'To Automated · Apps wrote 18 of the last 30 top-level messages'],
  ['items/automated-juno', 'Move #vendor-status-updates?', 'To Automated · Status updates from an app, a few replies'],
] as const) {
  test(`Home Automated keeps its two lines aligned, says why it asks, and insets its actions evenly (${state})`, async ({ page }) => {
    await open(page, 'Home', state)
    const row = page.locator('[data-home-item=automated]')
    await row.hover()
    await expect(row.locator('[data-home-title]')).toHaveText(title)
    await expect(row.locator('[data-home-meta]')).toHaveText(meta)
    const at = await row.evaluate((node) => {
      const title = node.querySelector('[data-home-title]')!.getBoundingClientRect()
      const meta = node.querySelector('[data-home-meta]')!.getBoundingClientRect()
      const buttons = [...node.querySelectorAll('button')].map((button) => button.getBoundingClientRect())
      const slot = node.getBoundingClientRect()
      return { title: title.left, meta: meta.left, metaEnd: meta.right, buttons: buttons.map((box) => ({ top: box.top - slot.top, bottom: slot.bottom - box.bottom })), first: buttons[0]!.left, gap: buttons[1]!.left - buttons[0]!.right }
    })
    expect(at.title).toBe(at.meta)
    // A long reason takes an ellipsis before the buttons; it never runs under them.
    expect(at.metaEnd).toBeLessThanOrEqual(at.first)
    for (const button of at.buttons) expect(button).toEqual({ top: 12, bottom: 12 })
    expect(at.gap).toBeGreaterThan(0)
  })
}

/**
 * Home's syncing line (SPEC 12) starts under the greeting's first letter, so
 * "Syncing with Slack." becoming the count moves no word: the first word is
 * at the same place in both states.
 */
test('Home keeps the syncing line under the greeting as its copy changes', async ({ page }) => {
  const starts: Array<{ readonly greeting: number; readonly line: number; readonly first: number }> = []
  for (const [state, copy] of [
    ['empty/syncing', 'Syncing with Slack.'],
    ['empty/syncing-count', /^Syncing\s*7\s*of 143 conversations\.$/],
  ] as const) {
    await open(page, 'Home', state)
    const line = page.locator('[data-home] h2 + p')
    await expect(line).toHaveText(copy)
    starts.push(await line.evaluate((node) => {
      const range = document.createRange()
      range.setStart(node.firstChild!, 0)
      range.setEnd(node.firstChild!, 1)
      return { greeting: node.previousElementSibling!.getBoundingClientRect().left, line: node.getBoundingClientRect().left, first: range.getBoundingClientRect().left }
    }))
  }
  for (const start of starts) expect(start.line).toBe(start.greeting)
  expect(starts[1]!.first).toBe(starts[0]!.first)
})

/**
 * Home's picture (SPEC 12, "A picture"): its label is one line, "Title ·
 * Artist, date", 16px under the picture's box and no wider than it, a long
 * title taking an ellipsis; the picture's line hangs 10px under the label,
 * no wider than the box.
 */
test("Home's picture has a one-line label under its box and its line under that, never wider than the box", async ({ page }) => {
  for (const [state, label] of [
    ['picture/wide', 'Impression, Sunrise · Claude Monet, 1872'],
    ['picture/fact', 'The Milkmaid · Johannes Vermeer, c. 1660'],
    ['picture/tall', null],
    ['picture/panorama', 'Cosmic Cliffs in the Carina Nebula · James Webb Space Telescope, 2022'],
    ['picture/long-title', null],
    ['picture/long-line', null],
  ] as const) {
    await open(page, 'Home', state)
    const caption = page.locator('[data-home-caption]')
    await expect(caption.locator('p')).toHaveCount(1)
    if (label !== null) await expect(caption).toHaveText(label)
    const at = await page.locator('[data-home-picture]').evaluate((node) => {
      const box = node.firstElementChild!.getBoundingClientRect()
      const words = node.querySelector('[data-home-caption]')!.getBoundingClientRect()
      const line = node.querySelector('[data-picture-line]')!.getBoundingClientRect()
      return { gap: words.top - box.bottom, lineGap: line.top - words.bottom, width: words.width, lineWidth: line.width, box: box.width, label: words.height }
    })
    expect(at.gap, state).toBe(16)
    expect(at.lineGap, state).toBe(10)
    expect(at.width, state).toBeLessThanOrEqual(at.box)
    expect(at.lineWidth, state).toBeLessThanOrEqual(at.box)
    // One line: the label's height is its leading, never two.
    expect(at.label, state).toBeLessThan(20)
  }
})
