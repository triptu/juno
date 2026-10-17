import { expect, test, type Locator, type Page } from '@playwright/test'
import { openState, type Route } from './support'

/**
 * The message toolbar straddles the row's top edge, mostly above it, so it
 * never covers the row's text (SPEC 7, inventory 6.5): not the name and time
 * of a header row, not the first line of a grouped row. Where there is no
 * room above, under the header band at the list's top, a row whose own top is
 * in view (the first message at scroll top, right at the band) takes it
 * inside its top edge, clear of the name and time; a row whose top is under
 * the band has it flip below. A row taller than the list, as the last message
 * is when its end sits on the composer, has room for neither, so the toolbar
 * goes inside it, at the top of the part in view. It never goes above the
 * list's visible top or below its bottom, where the list clips it.
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
  /** The list's bottom edge, on the composer. */
  readonly listBottom: number
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
      listBottom: scroller.getBoundingClientRect().bottom,
    }
  })
}

for (const [id, target, header] of [
  ['interaction/hover-toolbar', '[data-message-row]:nth-of-type(4)', true],
  ['interaction/hover-toolbar-grouped', '[data-message-row]:nth-of-type(6)', false],
] as const) {
  test(`${id}: the toolbar straddles the row's top edge, above its text`, async ({ page }) => {
    await open(page, id)
    const at = await measure(page, target)
    expect(at.header).toBe(header)
    expect(at.toolbar.top).toBeLessThan(at.row.top)
    // It comes into the row by the row's top padding less 2px: none in Compact density, so its bottom meets the edge.
    expect(at.toolbar.bottom).toBeGreaterThanOrEqual(at.row.top)
    expect(at.toolbar.bottom).toBeLessThanOrEqual(at.textTop)
    expect(at.toolbar.top).toBeGreaterThanOrEqual(at.listTop)
  })
}

/** Whether the toolbar runs over the row's name or time: their boxes against the toolbar's left edge. */
const clearOfHeader = (row: Locator) =>
  row.evaluate((element) => {
    const toolbar = element.querySelector('[role="toolbar"]')!.getBoundingClientRect()
    const header = element.querySelector('[data-message-header]')!
    const right = Math.max(...[...header.children].map((child) => child.getBoundingClientRect().right))
    return toolbar.left >= right
  })

test('the first row at scroll top, with no room above, gets the toolbar inside its top edge, clear of its name and time', async ({ page }) => {
  await open(page, 'interaction/hover-toolbar-first')
  const at = await measure(page, '[data-message-row]')
  expect(at.header).toBe(true)
  // At scroll top the row starts where the band ends: a toolbar above it would sit under the band.
  expect(at.row.top).toBeGreaterThanOrEqual(at.listTop)
  expect(at.row.top - (at.toolbar.bottom - at.toolbar.top)).toBeLessThan(at.listTop)
  expect(at.toolbar.top).toBeGreaterThan(at.row.top)
  expect(at.toolbar.top).toBeGreaterThanOrEqual(at.listTop)
  // Inside the row, not flipped below it over the next row's name.
  expect(at.toolbar.bottom).toBeLessThan(at.row.bottom)
  expect(await clearOfHeader(page.locator('[data-fixture-frame] [data-message-row]').first())).toBe(true)
})

test('a row whose top is under the header band gets the toolbar below it, clear of its text', async ({ page }) => {
  await open(page, 'interaction/hover-toolbar-under-band')
  const at = await measure(page, '[data-message-row] [data-msg-text]')
  expect(at.row.top).toBeLessThan(at.listTop)
  expect(at.toolbar.top).toBeGreaterThanOrEqual(at.textBottom)
  // Flipped, it straddles the bottom edge the same way: in Compact density its top meets the edge.
  expect(at.toolbar.top).toBeLessThanOrEqual(at.row.bottom)
  expect(at.toolbar.bottom).toBeGreaterThan(at.row.bottom)
})

test('a last row taller than the list, ending on the composer, gets the toolbar inside it, in full view', async ({ page }) => {
  await open(page, 'interaction/hover-toolbar-tall-last')
  const at = await measure(page, '[data-message-row]:last-of-type [data-msg-text]')
  expect(at.row.top).toBeLessThan(at.listTop)
  // No room below either: a toolbar under the row would run past the list's bottom.
  expect(at.row.bottom + (at.toolbar.bottom - at.toolbar.top)).toBeGreaterThan(at.listBottom)
  expect(at.toolbar.top).toBeGreaterThanOrEqual(at.listTop)
  expect(at.toolbar.bottom).toBeLessThanOrEqual(at.listBottom)
  expect(at.toolbar.top).toBeGreaterThan(at.row.top)
  expect(at.toolbar.bottom).toBeLessThan(at.row.bottom)
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
  // At scroll top the first row has no room above it: the toolbar is inside its top edge.
  expect(before.toolbar.top).toBeGreaterThan(before.row.top)
  expect(before.toolbar.bottom).toBeLessThan(before.row.bottom)
  await scrollList(page, underBand)
  const row = page.locator('[data-fixture-frame] [data-message-row]').first()
  expect(await row.evaluate((element) => element.matches(':hover'))).toBe(true)
  const at = await read(row)
  expect(at.row.top).toBeLessThan(at.listTop)
  expect(at.toolbar.top).toBeGreaterThanOrEqual(at.textBottom)
  // Flipped, it straddles the bottom edge the same way: in Compact density its top meets the edge.
  expect(at.toolbar.top).toBeLessThanOrEqual(at.row.bottom)
  expect(at.toolbar.bottom).toBeGreaterThan(at.row.bottom)
})
