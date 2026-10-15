import { expect, test, type Page } from '@playwright/test'
import { openState, type Route } from './support'

/**
 * Settings' geometry (inventory 14): the section list keeps the sidebar's
 * inset on both sides and starts on the section title's top edge, and the
 * section sits in the settings column, where the old Notifications page
 * put its column and title.
 */

const open = (page: Page, component: string, id: string) =>
  openState(page, { component, id, route: `${component}/${id}`, group: '', groupId: '', state: '', frame: {} } satisfies Route)

test.describe('Settings', () => {
  /** The list's rows against its content box (inside its right hairline), and the open section's title and column, from the frame's top left. */
  const measure = (page: Page) =>
    page.evaluate(() => {
      const frame = document.querySelector('[data-fixture-frame]')!.getBoundingClientRect()
      const title = document.querySelector('[data-fixture-frame] h1')!
      const column = title.closest('header')!.parentElement!
      const scroller = column.parentElement!
      const nav = document.querySelector('[data-settings-nav]')
      const navBox = nav?.getBoundingClientRect()
      const navRight = nav === null ? 0 : navBox!.right - parseFloat(getComputedStyle(nav).borderRightWidth)
      const rows = nav === null ? [] : [...nav.querySelectorAll('[role="button"]')].map((row) => row.getBoundingClientRect())
      const box = column.getBoundingClientRect()
      const area = scroller.getBoundingClientRect()
      return {
        rows: rows.map((row) => ({ left: row.left - navBox!.left, right: navRight - row.right, top: row.top - frame.top })),
        titleTop: title.getBoundingClientRect().top - frame.top,
        titleInPage: title.getBoundingClientRect().top - area.top,
        column: { width: box.width, left: box.left - area.left, right: area.right - (scroller.offsetWidth - scroller.clientWidth) - box.right },
      }
    })

  for (const id of ['sections/general', 'sections/notifications', 'sections/juno', 'sections/backup', 'sections/about']) {
    test(`${id}: the section list keeps the sidebar's 10px inset on both sides, and its first row starts on the title's top edge`, async ({ page }) => {
      await open(page, 'SettingsPage', id)
      const at = await measure(page)
      expect(at.rows).toHaveLength(8)
      for (const row of at.rows) expect({ left: row.left, right: row.right }).toEqual({ left: 10, right: 10 })
      expect(at.rows[0]!.top).toBe(at.titleTop)
      // The settings column: 760 wide, centred in the space beside the list.
      expect(at.column.width).toBe(760)
      expect(at.column.left).toBe(at.column.right)
    })
  }

  test('the column and its title sit where the old Notifications page put them: the same width and top edge', async ({ page }) => {
    await open(page, 'NotificationsPage', 'page/default')
    const alone = await measure(page)
    await open(page, 'SettingsPage', 'sections/notifications')
    const inSettings = await measure(page)
    expect(inSettings.column.width).toBe(alone.column.width)
    expect(inSettings.titleInPage).toBe(alone.titleInPage)
  })
})
