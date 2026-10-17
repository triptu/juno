import { expect, test, type Page } from '@playwright/test'
import { expectNoLayoutShift } from '@juno/testing/layout-shift'
import { openState, type Route } from './support'

/**
 * Sidebar rows and the topic list as views: what a row says and shows, its
 * Resolve slot, the title tooltip and the list's scrollbar. The app's e2e
 * tests cover where rows come from and how they change.
 */

const open = (page: Page, component: string, id: string) =>
  openState(page, { component, id, route: `${component}/${id}`, group: '', groupId: '', state: '', frame: {} } satisfies Route)

const row = (page: Page, title: string) => page.getByRole('listitem', { name: new RegExp(`^${title}`) })

test('a DM’s Main previews the message alone, your own message keeps “You:”, and a group DM’s tile is two members', async ({ page }) => {
  await open(page, 'TopicRow', 'sidebar/mixed-rows')
  const maya = page.locator('[data-topic-id="m:D0MAYA"]')
  await expect(maya.locator('[data-row-part="preview"]')).toHaveText('Sent you the deck. Tell me if the pricing slide reads.')
  await expect(maya.getByText(/Maya/)).toHaveCount(1)
  await expect(page.locator('[data-topic-id="m:D0DEV"] [data-row-part="preview"]')).toHaveText('You: its good')
  await expect(page.locator('[data-topic-id="G0MAYALEO:main"] [data-group-avatar] [data-kind="person"]')).toHaveCount(2)
})

test('a row says its unread count and a mention in words, not only in tooltips', async ({ page }) => {
  await open(page, 'TopicRow', 'state/mention')
  await expect(row(page, 'Rina Sato')).toHaveAccessibleDescription(/^2 unread, mentions you\. \S/)
  await open(page, 'TopicRow', 'state/read')
  await expect(row(page, 'Postgres 16')).toHaveAccessibleDescription('Dev: Booked 2–4pm. Will post results here.')
})

test('a title cut off by the row shows in full on hover, and one that fits shows no tooltip', async ({ page }) => {
  await open(page, 'TopicRow', 'content/long-title')
  const long = page.locator('[data-row-part="title"]')
  expect(await long.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true)
  await long.hover()
  await expect(long).toHaveAttribute('title', (await long.textContent()) ?? '')

  await open(page, 'TopicRow', 'state/read')
  const short = page.locator('[data-row-part="title"]')
  await short.hover()
  await expect(short).not.toHaveAttribute('title')
})

test('hovering a row shows Resolve in its reserved slot without moving anything, and keyboard focus shows it too', async ({ page }) => {
  await open(page, 'TopicRow', 'state/read')
  const postgres = row(page, 'Postgres 16')
  const resolve = postgres.getByRole('button', { name: /^Resolve Postgres 16/ })
  const slot = resolve.locator('..')
  await expect(slot).toHaveCSS('opacity', '0')
  await expectNoLayoutShift(page, () => postgres.hover())
  await expect(slot).toHaveCSS('opacity', '1')
  await expect(resolve).toHaveAttribute('data-tooltip', 'Resolve')

  // Leaving hides it again.
  await expectNoLayoutShift(page, () => page.mouse.move(0, 0))
  await expect(slot).toHaveCSS('opacity', '0')

  // A mouse press focuses the row, but that is not keyboard focus.
  await postgres.click()
  await page.mouse.move(0, 0)
  await expect(postgres).toBeFocused()
  await expect(slot).toHaveCSS('opacity', '0')

  // Keyboard focus shows it, and Tab reaches it.
  await page.keyboard.press('Shift')
  await expectNoLayoutShift(page, () => postgres.focus())
  await expect(slot).toHaveCSS('opacity', '1')
  await page.keyboard.press('Tab')
  await expect(resolve).toBeFocused()
  await expect(slot).toHaveCSS('opacity', '1')
})

test('the place line sits at one height with or without Resolve: renaming, and a resolved row', async ({ page }) => {
  const placeTop = (id: string) =>
    page.evaluate((topicId) => {
      const row = document.querySelector(`[data-topic-id="${topicId}"]`)!
      return row.querySelector('[data-row-part="place"]')!.getBoundingClientRect().top - row.getBoundingClientRect().top
    }, id)
  await open(page, 'TopicRow', 'state/read')
  const id = (await row(page, 'Postgres 16').getAttribute('data-topic-id'))!
  const read = await placeTop(id)
  await open(page, 'TopicRow', 'state/renaming')
  expect(await placeTop(id)).toBe(read)
  await open(page, 'TopicRow', 'kind/pinned-resolved')
  const notes = (await page.locator('[data-topic-row]').first().getAttribute('data-topic-id'))!
  expect(await placeTop(notes)).toBe(read)
})

test('the list scrollbar shows only while the pointer is over the list, and nothing moves', async ({ page }) => {
  await open(page, 'Sidebar', 'list/default')
  const list = page.getByRole('group', { name: 'Topics' })
  const thumb = () => list.evaluate((node) => getComputedStyle(node, '::-webkit-scrollbar-thumb').backgroundColor)
  const width = () => list.evaluate((node) => node.clientWidth)

  expect(await list.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true)
  expect(await thumb()).toBe('rgba(0, 0, 0, 0)')
  const gutterBefore = await width()

  const box = (await list.boundingBox())!
  await expectNoLayoutShift(page, () => page.mouse.move(box.x + 10, box.y + 10), { root: 'aside' })
  await expect.poll(thumb).not.toBe('rgba(0, 0, 0, 0)')
  expect(await width()).toBe(gutterBefore)

  // The wheel and the keyboard still scroll it.
  await page.mouse.wheel(0, 400)
  await expect.poll(() => list.evaluate((node) => node.scrollTop)).toBeGreaterThan(0)
  await page.mouse.move(box.x + box.width + 200, box.y + 10)
  await expect.poll(thumb).toBe('rgba(0, 0, 0, 0)')
  const top = await list.evaluate((node) => node.scrollTop)
  await list.locator('[data-topic-row]').first().focus()
  await page.keyboard.press('End')
  await expect.poll(() => list.evaluate((node) => node.scrollTop)).toBeGreaterThan(top)
})
