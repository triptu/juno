import { expect, test, type Locator, type Page } from '@playwright/test'
import { readInk, type Ink } from './ink'
import { openState, type Route, type Theme } from './support'

/**
 * A text emoji drawn next to text or in a pill sits on the centre line of
 * what holds it, read from screenshots: the reaction chips (the emoji and
 * the count), the quick-reaction pills in Settings, the emoji picker's cells
 * and the reactors card's large emoji. In Figtree's line box a chip's emoji
 * drew 1.25px under the chip's centre and a pill's 1px over it; the picker's
 * emoji, centred by its advance, drew 1px left. `toolbar-align.spec.ts`
 * covers the hover toolbar.
 */

const open = (page: Page, component: string, id: string, theme: Theme) =>
  openState(page, { component, id, route: `${component}/${id}`, group: '', groupId: '', state: '', frame: {} } satisfies Route, theme)

// Juno ships on macOS, where emoji are Apple Color Emoji. A Linux runner draws them in Noto Color Emoji, with other
// metrics, so there text emoji are not checked; images and the count are.
const appleEmoji = process.platform === 'darwin'

const expectOn = (ink: Ink | undefined, line: number, what: string, axis: 'x' | 'y' = 'y') => {
  expect(ink, `${what}: nothing painted`).toBeDefined()
  expect(Math.abs(ink![axis] - line), `${what} off the centre line: ${JSON.stringify(ink)}`).toBeLessThanOrEqual(0.5)
}

/** Each chip's emoji (a text emoji or an image) and count, then the chip's height. */
async function readChips(page: Page, chips: Locator) {
  const found = []
  for (const chip of await chips.all()) {
    const name = (await chip.getAttribute('data-reaction')) ?? ''
    const text = (await chip.locator('img').count()) === 0
    const reading = await readInk(page, chip, { parts: '[aria-hidden], img, [aria-hidden] + span, img + span', fillAt: { x: 3, y: 12 } })
    found.push({ name, text, height: reading.height, emoji: reading.parts[0], count: reading.parts[1] })
  }
  return found
}

for (const theme of ['light', 'dark'] as const) {
  for (const id of ['display/few', 'display/many', 'toggle/toggleable', 'display/custom']) {
    test(`Reactions ${id} (${theme}): each chip's emoji and count are on the chip's centre line`, async ({ page }) => {
      await open(page, 'Reactions', id, theme)
      // `:blob-wave:` is a custom emoji the workspace does not know: text, not an emoji.
      const chips = page.locator('[data-fixture-frame] [data-reaction]:not([data-reaction="blob-wave"])')
      const found = await readChips(page, chips)
      expect(found.length).toBeGreaterThan(0)
      for (const chip of found) {
        if (!chip.text || appleEmoji) expectOn(chip.emoji, chip.height / 2, `${chip.name}'s emoji`)
        expectOn(chip.count, chip.height / 2, `${chip.name}'s count`)
      }
    })
  }

  test(`QuickReactionsSetting (${theme}): each pill's emoji is on the pill's centre line`, async ({ page }) => {
    test.skip(!appleEmoji, 'text emoji are checked where Apple Color Emoji draws them')
    await open(page, 'QuickReactionsSetting', 'reactions/full', theme)
    const pills = await page.locator('[data-quick-reaction]').all()
    expect(pills.length).toBe(7)
    for (const pill of pills) {
      const reading = await readInk(page, pill, { parts: ':scope > [aria-hidden], :scope > img', fillAt: { x: 3, y: 14 } })
      expectOn(reading.parts[0], reading.height / 2, `${await pill.getAttribute('data-quick-reaction')}`)
    }
  })

  test(`EmojiPicker (${theme}): each emoji is centred in its cell`, async ({ page }) => {
    test.skip(!appleEmoji, 'text emoji are checked where Apple Color Emoji draws them')
    await open(page, 'EmojiPicker', 'browse/recent-and-custom', theme)
    const cells = (await page.locator('button[data-emoji]:not(:has(img))').all()).slice(0, 27)
    expect(cells.length).toBe(27)
    for (const cell of cells) {
      const reading = await readInk(page, cell, { parts: ':scope', fillAt: { x: 2, y: 16 }, inset: 0 })
      const name = (await cell.getAttribute('data-emoji')) ?? ''
      expectOn(reading.parts[0], reading.height / 2, name)
      expectOn(reading.parts[0], reading.width / 2, name, 'x')
    }
  })

  test(`ReactorsCard (${theme}): the large emoji is centred in its 32px square`, async ({ page }) => {
    test.skip(!appleEmoji, 'text emoji are checked where Apple Color Emoji draws them')
    for (const id of ['reactors/one', 'reactors/three', 'reactors/six', 'reactors/forty', 'data/partial', 'data/nobody-listed', 'data/long-name']) {
      await open(page, 'ReactorsCard', id, theme)
      const card = page.locator('[data-reactors]')
      // The square's centre, by layout: a custom emoji's image fills the same square.
      const line = await card.evaluate((element) => parseFloat(getComputedStyle(element).paddingTop) + (element.firstElementChild as HTMLElement).offsetHeight / 2)
      // Only the square and 3px around it: the sentence starts 6px under it.
      const reading = await readInk(page, card, { parts: ':scope > [aria-hidden]', fillAt: { x: 4, y: 4 }, inset: 1, spill: 3 })
      expectOn(reading.parts[0], line, id)
    }
  })
}
