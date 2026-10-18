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
 * Home becomes ready while the first sync still reads history (owner,
 * 10-18): the syncing line goes and the reserved slots stay, so the
 * greeting and the rows shown keep their places.
 */
test('Home moves nothing when it becomes ready before the first sync ends', async ({ page }) => {
  const places: Array<{ readonly greeting: number; readonly row: number; readonly items: number }> = []
  for (const state of ['empty/syncing-rows', 'empty/ready-filling']) {
    await open(page, 'Home', state)
    places.push(await page.locator('[data-home]').evaluate((node) => ({
      greeting: node.querySelector('h2')!.getBoundingClientRect().top,
      row: node.querySelector('[data-home-item]')!.getBoundingClientRect().top,
      items: node.querySelector('ul')!.getBoundingClientRect().height,
    })))
  }
  await expect(page.locator('[data-home] h2 + p')).toHaveCount(0)
  expect(places[1]).toEqual(places[0])
})

/**
 * Home's thought (SPEC 12) is centred under the greeting, 14px under it as
 * the greeting is under the scene. During the first sync it sits over the
 * reserved slots, so a row that lands takes its place and the greeting
 * stays where it was.
 */
test("Home centres the thought under the greeting, and a row that lands takes its place without moving the greeting", async ({ page }) => {
  const places: Array<{ readonly greeting: number; readonly row: number | undefined }> = []
  for (const state of ['empty/thought-filling', 'empty/thought-gives-way']) {
    await open(page, 'Home', state)
    places.push(await page.locator('[data-home]').evaluate((node) => ({
      greeting: node.querySelector('h2')!.getBoundingClientRect().top,
      row: node.querySelector('[data-home-item]')?.getBoundingClientRect().top,
    })))
  }
  await expect(page.locator('[data-home-thought]')).toHaveCount(0)
  expect(places[1]!.greeting).toBe(places[0]!.greeting)

  for (const state of ['empty/thought-quote', 'empty/thought-fact', 'empty/thought-narrow', 'empty/thought-filling']) {
    await open(page, 'Home', state)
    const at = await page.locator('[data-home]').evaluate((node) => {
      const scene = node.querySelector('svg')!.getBoundingClientRect()
      const greeting = node.querySelector('h2')!.getBoundingClientRect()
      const thought = node.querySelector('[data-home-thought]')!.getBoundingClientRect()
      return { sceneGap: greeting.top - scene.bottom, thoughtGap: thought.top - greeting.bottom, greetingMid: greeting.left + greeting.width / 2, thoughtMid: thought.left + thought.width / 2 }
    })
    expect(Math.abs(at.thoughtGap - at.sceneGap), state).toBeLessThan(0.5)
    expect(Math.abs(at.thoughtMid - at.greetingMid), state).toBeLessThan(1)
  }
})
