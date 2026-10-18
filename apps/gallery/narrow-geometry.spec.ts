// The main surfaces at the minimum window (720 by 480): with the sidebar
// shown a page is 336 wide, without it 720. No text paints over other
// text or runs out of its pill, and the buttons of a card keep their verbs.
import { expect, test, type Page } from '@playwright/test'
import { findOverlaps } from './overlap'
import { openState, type Route } from './support'

const route = (component: string, id: string): Route => ({ component, id, route: `${component}/${id}`, group: '', groupId: '', state: '', frame: {} })

/** Each state, and whether its buttons are all verbs that must never cut. */
const STATES: ReadonlyArray<readonly [Route, boolean]> = [
  [route('SendMessageCard', 'send-message/minimum-window'), true],
  [route('AllTopics', 'size/minimum-window'), false],
  [route('AllTopics', 'size/where-hidden'), false],
  [route('AllTopics', 'size/narrow'), false],
  [route('AllTopics', 'filters/narrow'), false],
  [route('AllTopics', 'size/minimum-window-sidebar'), false],
  [route('AllTopics', 'size/compact'), false],
  [route('Home', 'items/minimum-window'), false],
  [route('CommandPalette', 'states/minimum-window'), false],
  [route('SettingsPage', 'states/notifications-minimum-window'), false],
  [route('SettingsPage', 'states/general-minimum-window'), false],
  [route('SettingsPage', 'states/appearance-minimum-window'), false],
  [route('JunoChatList', 'chat/minimum-window'), false],
  [route('JunoHeader', 'banner/recovery-minimum-window'), false],
  [route('JunoHeader', 'banner/paused-minimum-window'), false],
  [route('TopicView', 'interaction/minimum-window'), false],
  [route('Workspace', 'page/minimum-window'), false],
  [route('Shell', 'window/sidebar-hidden-minimum-window'), false],
]

const frameOf = (page: Page, at: Route) => page.locator(`[data-fixture-frame="${at.route}"]`)

test.describe('the minimum window', () => {
  // In light only: the dark theme changes colours and shadows, never a size (packages/tokens/src/themes.stylex.ts).
  for (const [at, buttons] of STATES) {
    test(`${at.route}: no text overlaps`, async ({ page }) => {
      await openState(page, at)
      expect(await findOverlaps(page, { route: at.route, buttons })).toEqual([])
    })
  }

  test('the Send message card keeps its kind label whole and puts "in {topic}" under the pill', async ({ page }) => {
    const at = route('SendMessageCard', 'send-message/minimum-window')
    await openState(page, at)
    const frame = frameOf(page, at)
    const label = frame.getByText('Send message', { exact: true })
    expect(await label.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
    const where = await frame.locator('[data-send-row]').first().evaluate((row) => {
      const pill = row.querySelector('[title="Public channel"]')!.getBoundingClientRect()
      const topic = [...row.querySelectorAll('span, p')].find((node) => node.textContent?.startsWith('in ') === true)!.getBoundingClientRect()
      return { pillBottom: pill.bottom, topicTop: topic.top }
    })
    expect(where.topicTop).toBeGreaterThanOrEqual(where.pillBottom)
  })

  test('All topics hides Where under 664px, then Msgs under 576px, and the table still fits', async ({ page }) => {
    const states = [
      ['size/minimum-window', true, true],
      ['size/where-hidden', false, true],
      ['size/narrow', false, false],
    ] as const
    for (const [id, where, messages] of states) {
      const at = route('AllTopics', id)
      await openState(page, at)
      const frame = frameOf(page, at)
      await expect(frame.getByRole('columnheader', { name: 'Where' })).toBeVisible({ visible: where })
      await expect(frame.getByRole('columnheader', { name: 'Msgs' })).toBeVisible({ visible: messages })
      // Nothing to scroll sideways to, so a focused row's ring is whole.
      expect(await frame.locator('[data-all-topics-table]').evaluate((table) => table.scrollWidth <= table.clientWidth)).toBe(true)
    }
  })

  test('the command palette ends above the bottom of a 480px window', async ({ page }) => {
    const at = route('CommandPalette', 'states/minimum-window')
    await openState(page, at)
    const frame = await frameOf(page, at).boundingBox()
    const palette = await frameOf(page, at).getByRole('dialog').boundingBox()
    expect(palette!.y + palette!.height).toBeLessThanOrEqual(frame!.y + frame!.height)
  })
})

test.describe('the minimum window with the sidebar shown', () => {
  test('Settings at 336 narrows its list to a rail of named icons, and the page keeps its controls whole', async ({ page }) => {
    for (const id of ['states/general-minimum-window', 'states/appearance-minimum-window']) {
      const at = route('SettingsPage', id)
      await openState(page, at)
      const frame = frameOf(page, at)
      const nav = frame.locator('[data-settings-nav="rail"]')
      await expect(nav).toBeVisible()
      expect((await nav.boundingBox())!.width).toBeLessThanOrEqual(41)
      const items = nav.getByRole('button')
      await expect(items).toHaveCount(10)
      await expect(nav.getByRole('button', { name: 'Backup & This Mac' })).toHaveAttribute('data-tooltip', 'Backup & This Mac')
      // Every card's content stays inside the card: a row's control goes under its label rather than past the edge.
      const cut = await frame.locator('[data-settings-section] section, [data-settings-section] header').evaluateAll((nodes) =>
        nodes.flatMap((node) => {
          const box = node.getBoundingClientRect()
          return [...node.querySelectorAll('button, [role="radiogroup"], select, input')]
            .filter((control) => control.getBoundingClientRect().right > box.right + 0.5)
            .map((control) => control.textContent ?? control.tagName)
        }),
      )
      expect(cut).toEqual([])
    }
  })

  test('All topics at 336 shows Status as a pop-up and never scrolls sideways, so a focused row keeps its whole ring', async ({ page }) => {
    const at = route('AllTopics', 'size/minimum-window-sidebar')
    await openState(page, at)
    const frame = frameOf(page, at)
    await expect(frame.getByRole('combobox', { name: 'Status' })).toBeVisible()
    await expect(frame.getByRole('radiogroup', { name: 'Status' })).toBeHidden()
    await expect(frame.getByRole('columnheader', { name: 'Status' })).toBeHidden()
    const filters = frame.locator('[data-all-topics-filters]')
    expect(await filters.evaluate((row) => [...row.querySelectorAll('select, [role="radiogroup"], button')].every((node) => node.getBoundingClientRect().right <= row.getBoundingClientRect().right + 0.5))).toBe(true)
    const table = frame.locator('[data-all-topics-table]')
    expect(await table.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
    const row = frame.locator('[data-all-topics-row]').first()
    await row.focus()
    const [rowBox, tableBox] = await Promise.all([row.boundingBox(), table.evaluate((node) => {
      const box = node.getBoundingClientRect()
      return { left: box.left, right: box.left + node.clientWidth }
    })])
    expect(rowBox!.x).toBeGreaterThanOrEqual(tableBox.left)
    expect(rowBox!.x + rowBox!.width).toBeLessThanOrEqual(tableBox.right)
  })

  test('the Juno chat at 336 gives Juno\'s bubbles the width, with the time as their tooltip', async ({ page }) => {
    const at = route('JunoChatList', 'chat/minimum-window')
    await openState(page, at)
    const frame = frameOf(page, at)
    const bubbles = frame.locator('[data-chat-juno]')
    // The widest bubble: before, the time and React and Reply beside it left about 146px.
    const width = await bubbles.evaluateAll((rows) => Math.max(...rows.flatMap((row) => [...row.querySelectorAll('[data-tooltip]')].map((node) => node.getBoundingClientRect().width))))
    expect(width).toBeGreaterThanOrEqual(220)
    await expect(bubbles.locator('time')).toHaveCount(0)
  })
})

test('under 480px a thread header shows the place pill as its icon and gives the title the room; a Main keeps its name', async ({ page }) => {
  const pill = page.locator('[data-island="left"] button[aria-label$="Show in sidebar."]')
  await openState(page, route('TopicHeader', 'narrow/thread-336'))
  const narrow = (await pill.boundingBox())!
  expect(narrow.width).toBe(narrow.height)
  await expect(pill).toHaveAttribute('aria-label', /^hiring, private channel\./)
  await expect(pill).toHaveAttribute('data-tooltip', 'hiring · Private channel')
  await openState(page, route('TopicHeader', 'narrow/main-336'))
  expect((await pill.boundingBox())!.width).toBeGreaterThan((await pill.boundingBox())!.height)
  await openState(page, route('TopicHeader', 'thread/private'))
  expect((await pill.boundingBox())!.width).toBeGreaterThan((await pill.boundingBox())!.height)
})
