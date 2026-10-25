import { expect, type Locator, type Page } from '@playwright/test'
import { layoutTest as test, openState, type Route } from './support'

/**
 * The delete confirm (ADR 0010) straddles the row's top edge, mostly above
 * it, so it never covers the row's text (SPEC 7, inventory 6.5): not the
 * name and time of a header row, not the first line of a grouped row. Where
 * there is no room above, under the header band at the list's top, a row
 * whose own top is in view (the first message at scroll top, right at the
 * band) takes it inside its top edge, clear of the name and time; a row whose
 * top is under the band has it flip below. A row taller than the list, as the
 * last message is when its end sits on the composer, has room for neither,
 * so the confirm goes inside it, at the top of the part in view. It never
 * goes above the list's visible top or below its bottom, where the list clips it.
 */

const open = (page: Page, id: string) =>
  openState(page, { component: 'MessageList', id, route: `MessageList/${id}`, group: '', groupId: '', state: '', frame: {} } satisfies Route)

interface Geometry {
  readonly header: boolean
  readonly row: { readonly top: number; readonly bottom: number }
  readonly confirm: { readonly top: number; readonly bottom: number }
  /** Top of the row's first text and bottom of its last, from the text boxes themselves. */
  readonly textTop: number
  readonly textBottom: number
  /** Where the list stops showing rows: its top plus `scroll-padding-top`. */
  readonly listTop: number
  /** The list's bottom edge, on the composer. */
  readonly listBottom: number
}

/** Measures the row that asks to confirm a delete. */
const measure = (page: Page) => read(page.locator('[data-fixture-frame] [data-message-row]').filter({ has: page.locator('[data-delete-confirm]') }))

/** Measures `row` and its confirm. */
async function read(row: Locator): Promise<Geometry> {
  await expect(row.locator('[data-delete-confirm]')).toBeVisible()
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
    const confirm = element.querySelector('[data-delete-confirm]')!.getBoundingClientRect()
    const box = element.getBoundingClientRect()
    return {
      header: element.querySelector('[data-message-header]') !== null,
      row: { top: box.top, bottom: box.bottom },
      confirm: { top: confirm.top, bottom: confirm.bottom },
      textTop: Math.min(...tops),
      textBottom: Math.max(...bottoms),
      listTop: scroller.getBoundingClientRect().top + Number.parseFloat(getComputedStyle(scroller).scrollPaddingTop),
      listBottom: scroller.getBoundingClientRect().bottom,
    }
  })
}

/** Whether the confirm runs over the row's name or time: their boxes against the confirm's left edge. */
const clearOfHeader = (row: Locator) =>
  row.evaluate((element) => {
    const confirm = element.querySelector('[data-delete-confirm]')!.getBoundingClientRect()
    const header = element.querySelector('[data-message-header]')!
    const right = Math.max(...[...header.children].map((child) => child.getBoundingClientRect().right))
    return confirm.left >= right
  })

// One document, each placement in turn: above the row, inside its top, flipped below, inside a tall last row.
test('the delete confirm takes the room the row has, and never covers its text', async ({ page }) => {
  for (const [id, header] of [
    ['interaction/confirm-delete', true],
    ['interaction/confirm-delete-grouped', false],
  ] as const) {
    // It straddles the row's top edge, above its text.
    await open(page, id)
    const at = await measure(page)
    expect(at.header, id).toBe(header)
    expect(at.confirm.top, id).toBeLessThan(at.row.top)
    // It comes into the row by the row's top padding less 2px: none in Compact density, so its bottom meets the edge.
    expect(at.confirm.bottom, id).toBeGreaterThanOrEqual(at.row.top)
    expect(at.confirm.bottom, id).toBeLessThanOrEqual(at.textTop)
    expect(at.confirm.top, id).toBeGreaterThanOrEqual(at.listTop)
  }

  // The first row at scroll top, with no room above, gets the confirm inside its top edge, clear of its name and time.
  await open(page, 'interaction/confirm-delete-first')
  let at = await measure(page)
  expect(at.header).toBe(true)
  // At scroll top the row starts where the band ends: a confirm above it would sit under the band.
  expect(at.row.top).toBeGreaterThanOrEqual(at.listTop)
  expect(at.row.top - (at.confirm.bottom - at.confirm.top)).toBeLessThan(at.listTop)
  expect(at.confirm.top).toBeGreaterThan(at.row.top)
  expect(at.confirm.top).toBeGreaterThanOrEqual(at.listTop)
  // Inside the row, not flipped below it over the next row's name.
  expect(at.confirm.bottom).toBeLessThan(at.row.bottom)
  expect(await clearOfHeader(page.locator('[data-fixture-frame] [data-message-row]').first())).toBe(true)

  // A row whose top is under the header band gets the confirm below it, clear of its text.
  await open(page, 'interaction/confirm-delete-under-band')
  at = await measure(page)
  expect(at.row.top).toBeLessThan(at.listTop)
  expect(at.confirm.top).toBeGreaterThanOrEqual(at.textBottom)
  // Flipped, it straddles the bottom edge the same way: in Compact density its top meets the edge.
  expect(at.confirm.top).toBeLessThanOrEqual(at.row.bottom)
  expect(at.confirm.bottom).toBeGreaterThan(at.row.bottom)

  // A last row taller than the list, ending on the composer, gets the confirm inside it, in full view.
  await open(page, 'interaction/confirm-delete-tall-last')
  at = await measure(page)
  expect(at.row.top).toBeLessThan(at.listTop)
  // No room below either: a confirm under the row would run past the list's bottom.
  expect(at.row.bottom + (at.confirm.bottom - at.confirm.top)).toBeGreaterThan(at.listBottom)
  expect(at.confirm.top).toBeGreaterThanOrEqual(at.listTop)
  expect(at.confirm.bottom).toBeLessThanOrEqual(at.listBottom)
  expect(at.confirm.top).toBeGreaterThan(at.row.top)
  expect(at.confirm.bottom).toBeLessThan(at.row.bottom)
})
