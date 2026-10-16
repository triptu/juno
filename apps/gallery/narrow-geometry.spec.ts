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
  [route('Home', 'items/minimum-window'), false],
  [route('CommandPalette', 'states/minimum-window'), false],
  [route('SettingsPage', 'states/notifications-minimum-window'), false],
  [route('JunoChatList', 'chat/minimum-window'), false],
  [route('JunoHeader', 'banner/recovery-minimum-window'), false],
  [route('JunoHeader', 'banner/paused-minimum-window'), false],
  [route('TopicView', 'interaction/minimum-window'), false],
  [route('Workspace', 'page/minimum-window'), false],
  [route('Shell', 'window/sidebar-hidden-minimum-window'), false],
]

const frameOf = (page: Page, at: Route) => page.locator(`[data-fixture-frame="${at.route}"]`)

test.describe('the minimum window', () => {
  for (const theme of ['light', 'dark'] as const) {
    for (const [at, buttons] of STATES) {
      test(`${at.route}, ${theme}: no text overlaps`, async ({ page }) => {
        await openState(page, at, theme)
        expect(await findOverlaps(page, { route: at.route, buttons })).toEqual([])
      })
    }
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

  test('All topics hides Where under 648px, then Msgs under 560px, and the table still fits', async ({ page }) => {
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
