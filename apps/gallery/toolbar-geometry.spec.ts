import { expect, test, type Locator, type Page } from '@playwright/test'
import { openState, type Route } from './support'

/**
 * The message toolbar straddles the row's top edge, mostly above it, so it
 * never covers the row's text (SPEC 7, inventory 6.5): not the name and time
 * of a header row, not the first line of a grouped row. Where there is no
 * room above, under the header band at the list's top, it flips below the
 * row. It never goes above the list's visible top, where the list clips it.
 */

const open = (page: Page, id: string) =>
  openState(page, { component: 'MessageList', id, route: `MessageList/${id}`, group: '', groupId: '', state: '', frame: {} } satisfies Route)

interface Geometry {
  readonly header: boolean
  readonly row: { readonly top: number; readonly bottom: number }
  readonly toolbar: { readonly top: number; readonly bottom: number }
  /** Top of the row's first text and bottom of its last, from the text boxes themselves. */
  readonly textTop: number
  readonly textBottom: number
  /** Where the list stops showing rows: its top plus `scroll-padding-top`. */
  readonly listTop: number
}

/** Hovers `target` in the frame and measures the row it is in. */
async function measure(page: Page, target: string): Promise<Geometry> {
  const hovered = page.locator('[data-fixture-frame]').locator(target).first()
  await hovered.hover()
  return read(hovered.locator('xpath=ancestor-or-self::*[@data-message-row][1]'))
}

/** Measures `row`, whose toolbar shows, without moving the pointer. */
async function read(row: Locator): Promise<Geometry> {
  await expect(row.getByRole('toolbar')).toBeVisible()
  return row.evaluate((element) => {
    const content = element.children[1]!
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT)
    const tops: number[] = []
    const bottoms: number[] = []
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      if ((node.textContent ?? '').trim() === '') continue
      const range = document.createRange()
      range.selectNodeContents(node)
      for (const rect of range.getClientRects()) {
        if (rect.width === 0) continue
        tops.push(rect.top)
        bottoms.push(rect.bottom)
      }
    }
    const scroller = element.closest('[data-scroll-area]')!
    const toolbar = element.querySelector('[role="toolbar"]')!.getBoundingClientRect()
    const box = element.getBoundingClientRect()
    return {
      header: element.querySelector('[data-message-header]') !== null,
      row: { top: box.top, bottom: box.bottom },
      toolbar: { top: toolbar.top, bottom: toolbar.bottom },
      textTop: Math.min(...tops),
      textBottom: Math.max(...bottoms),
      listTop: scroller.getBoundingClientRect().top + Number.parseFloat(getComputedStyle(scroller).scrollPaddingTop),
    }
  })
}

for (const [id, target, header] of [
  ['interaction/hover-toolbar', '[data-message-row]:nth-of-type(4)', true],
  ['interaction/hover-toolbar-grouped', '[data-message-row]:nth-of-type(6)', false],
  ['interaction/hover-toolbar-first', '[data-message-row]', true],
] as const) {
  test(`${id}: the toolbar straddles the row's top edge, above its text`, async ({ page }) => {
    await open(page, id)
    const at = await measure(page, target)
    expect(at.header).toBe(header)
    expect(at.toolbar.top).toBeLessThan(at.row.top)
    expect(at.toolbar.bottom).toBeGreaterThan(at.row.top)
    expect(at.toolbar.bottom).toBeLessThanOrEqual(at.textTop)
    expect(at.toolbar.top).toBeGreaterThanOrEqual(at.listTop)
  })
}

test('a row whose top is under the header band gets the toolbar below it, clear of its text', async ({ page }) => {
  await open(page, 'interaction/hover-toolbar-under-band')
  const at = await measure(page, '[data-message-row] [data-msg-text]')
  expect(at.row.top).toBeLessThan(at.listTop)
  expect(at.toolbar.top).toBeGreaterThanOrEqual(at.textBottom)
  expect(at.toolbar.top).toBeLessThan(at.row.bottom)
  expect(at.toolbar.bottom).toBeGreaterThan(at.row.bottom)
})

/** Scrolls the list to `top` and waits for `scrollend`. Returns where it was. */
const scrollList = (page: Page, top: number) =>
  page.locator('[data-fixture-frame] [data-scroll-area]').evaluate(
    (element, to) =>
      new Promise<number>((resolve) => {
        const from = element.scrollTop
        element.addEventListener('scrollend', () => resolve(from), { once: true })
        element.scrollTop = to
      }),
    top,
  )

test('a hovered row that scrolls under the header band under a still pointer gets the toolbar below it', async ({ page }) => {
  await open(page, 'interaction/hover-toolbar-under-band')
  const underBand = await scrollList(page, 0)
  // The pointer rests on the name, which is still inside the row once the row has scrolled up.
  const before = await measure(page, '[data-message-row] [data-sender]')
  expect(before.row.top).toBeGreaterThanOrEqual(before.listTop)
  expect(before.toolbar.top).toBeLessThan(before.row.top)
  await scrollList(page, underBand)
  const row = page.locator('[data-fixture-frame] [data-message-row]').first()
  expect(await row.evaluate((element) => element.matches(':hover'))).toBe(true)
  const at = await read(row)
  expect(at.row.top).toBeLessThan(at.listTop)
  expect(at.toolbar.top).toBeGreaterThanOrEqual(at.textBottom)
  expect(at.toolbar.top).toBeLessThan(at.row.bottom)
  expect(at.toolbar.bottom).toBeGreaterThan(at.row.bottom)
})
