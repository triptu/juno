import { expect, test, type Page } from '@playwright/test'
import { openState, type Route } from './support'

/**
 * The message list is as dense as Slack's (SPEC 7, "Stable geometry";
 * inventory 6.1). A row is as tall as what it shows: no empty line is held
 * for reactions, a thread link or a name that might arrive later. Messages
 * from different senders sit the group gap apart, a run from one sender
 * touches, and the time follows the name at the header's gap.
 *
 * The 2026-10-16 regression held a reaction line and a thread-link line on
 * every row and gave every name a fixed-width slot; on real data that showed
 * as 60px or more of empty space under each message and a time far from its
 * name. The fixtures here are the shapes that showed it.
 */

const open = (page: Page, component: string, id: string) =>
  openState(page, { component, id, route: `${component}/${id}`, group: '', groupId: '', state: '', frame: {} } satisfies Route)

interface RowGeometry {
  readonly ts: string
  readonly header: boolean
  readonly top: number
  readonly bottom: number
  readonly paddingBottom: number
  readonly groupGap: number
  /** Bottom of the last piece of content that shows something. */
  readonly inkBottom: number
  /** Children of the content column with no text, image or control: held space. */
  readonly empty: ReadonlyArray<string>
  readonly nameRight?: number
  readonly timeLeft?: number
  readonly headerGap: number
}

const rows = (page: Page) =>
  page.locator('[data-message-row]').evaluateAll((nodes): RowGeometry[] => {
    const shows = (element: Element) => (element.textContent ?? '').trim() !== '' || element.querySelector('img, svg, button, video, canvas') !== null || element.matches('img, svg')
    return nodes.map((row) => {
      const style = getComputedStyle(row)
      const content = row.children[1]!
      const parts = [...content.children].filter((child) => child.getClientRects().length > 0)
      const header = row.querySelector('[data-message-header]')
      const name = header?.querySelector('[data-sender]')
      const time = header?.querySelector('time')
      const box = row.getBoundingClientRect()
      return {
        ts: row.getAttribute('data-message-row')!,
        header: header !== null,
        top: box.top,
        bottom: box.bottom,
        paddingBottom: Number.parseFloat(style.paddingBottom),
        groupGap: Number.parseFloat(style.getPropertyValue('--density-message-group-gap')),
        inkBottom: Math.max(...parts.filter(shows).map((part) => part.getBoundingClientRect().bottom)),
        empty: parts.filter((part) => !shows(part)).map((part) => part.outerHTML.slice(0, 120)),
        ...(name && time ? { nameRight: name.getBoundingClientRect().right, timeLeft: time.getBoundingClientRect().left } : {}),
        headerGap: header ? Number.parseFloat(getComputedStyle(header).columnGap) : 0,
      }
    })
  })

for (const id of ['main/conversation', 'thread/long', 'main/thread-links']) {
  test(`${id}: rows hold no empty space, senders sit the group gap apart, runs touch`, async ({ page }) => {
    await open(page, 'MessageList', id)
    const measured = await rows(page)
    expect(measured.length).toBeGreaterThan(3)
    for (const [index, row] of measured.entries()) {
      expect(row.empty, `row ${index} holds empty space`).toEqual([])
      // The content column rounds up to a whole pixel (performance 3.3) and an emoji-only line's
      // images can sit a fraction past its box, so the row may end up to two pixels later.
      const below = row.bottom - row.inkBottom - row.paddingBottom
      expect(below, `row ${index}: space under its content`).toBeGreaterThanOrEqual(-0.01)
      expect(below, `row ${index}: space under its content`).toBeLessThan(2)
      const previous = measured[index - 1]
      if (previous === undefined) continue
      const gap = row.top - previous.bottom
      if (row.header) expect(gap, `gap before row ${index}, a new sender`).toBeCloseTo(row.groupGap, 1)
      else expect(gap, `gap before row ${index}, the same sender`).toBeCloseTo(0, 1)
    }
  })
}

test('the time sits right after the name, short or long', async ({ page }) => {
  await open(page, 'MessageList', 'main/conversation')
  const headers = (await rows(page)).filter((row) => row.nameRight !== undefined)
  expect(headers.length).toBeGreaterThan(3)
  for (const row of headers) expect(row.timeLeft! - row.nameRight!, `row ${row.ts}`).toBeCloseTo(row.headerGap, 0)
})

test('custom reactions show the workspace image, and an unknown one shows its name apart from the count', async ({ page }) => {
  await open(page, 'MessageList', 'main/conversation')
  const known = page.getByRole('button', { name: '1 :makes-sense:' })
  await expect(known.locator('img')).toHaveCount(1)
  await expect(known).toHaveText('1')
  const unknown = page.getByRole('button', { name: '1 :shipit-old:' })
  await expect(unknown.locator('img')).toHaveCount(0)
  // `:shipit-old:` then the count, apart: never `:shipit-old:1`.
  const parts = await unknown.evaluate((chip) => {
    const name = chip.querySelector('span[aria-hidden]')!
    return [name, name.nextElementSibling!].map((span) => ({ text: span.textContent, left: span.getBoundingClientRect().left, right: span.getBoundingClientRect().right }))
  })
  expect(parts.map((part) => part.text)).toEqual([':shipit-old:', '1'])
  expect(parts[1]!.left - parts[0]!.right).toBeGreaterThan(2)
  // The custom emoji on a line is an image too.
  await expect(page.locator('[data-msg-text] img[alt=":makes-sense:"]')).toHaveCount(1)
})

test('at scroll top the first row sits the toolbar’s room below the header band, and “Loading older messages” takes no space', async ({ page }) => {
  const firstRow = () =>
    page.evaluate(() => {
      const row = document.querySelector('[data-message-row]')!
      const scroller = row.closest('[data-scroll-area]')!
      const band = scroller.getBoundingClientRect().top + Number.parseFloat(getComputedStyle(scroller).scrollPaddingTop)
      const toolbar = Number.parseFloat(getComputedStyle(row).getPropertyValue('--toolbar-height'))
      const padding = Number.parseFloat(getComputedStyle(row).paddingTop)
      const line = document.querySelector('[data-older-line]')?.getBoundingClientRect()
      return { below: row.getBoundingClientRect().top - band, room: toolbar - padding + 2, lineBottom: line?.bottom ?? 0, rowTop: row.getBoundingClientRect().top }
    })
  await open(page, 'MessageList', 'thread/long')
  const none = await firstRow()
  expect(none.below).toBe(none.room)
  await open(page, 'MessageList', 'thread/more-above')
  expect((await firstRow()).below).toBe(none.below)
  await open(page, 'MessageList', 'thread/loading-older')
  await expect(page.locator('[data-older-line]')).toHaveText('Loading older messages')
  const loading = await firstRow()
  expect(loading.below).toBe(none.below)
  expect(loading.lineBottom).toBeLessThanOrEqual(loading.rowTop)
})
