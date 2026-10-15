import { expect, test, type Page } from '@playwright/test'
import { openState, type Route } from './support'

/**
 * Insets are measured, not eyeballed. A scroll area's 10px gutter sits on
 * the right only, so content that ignores it is 10px further from the right
 * edge than from the left. These checks hold the sidebar's rows, filter row,
 * nav and title bar to one inset on both sides, and the message list and the
 * Juno chat to a column centred in its pane, to the pixel, with a scrollbar
 * and without one.
 */

const open = (page: Page, component: string, id: string) =>
  openState(page, { component, id, route: `${component}/${id}`, group: '', groupId: '', state: '', frame: {} } satisfies Route)

interface Inset {
  readonly left: number
  readonly right: number
}

/** The sidebar parts' distances from its content box (inside the right border), in CSS px. */
function sidebarInsets(page: Page) {
  return page.evaluate(() => {
    const aside = document.querySelector('aside[aria-label="Sidebar"]')!
    const box = aside.getBoundingClientRect()
    const right = box.right - parseFloat(getComputedStyle(aside).borderRightWidth)
    const inset = (element: Element | null): Inset => {
      const b = element!.getBoundingClientRect()
      return { left: b.left - box.left, right: right - b.right }
    }
    const filters = aside.querySelector('[aria-label="Quick filters"]')!
    const buttons = [...filters.querySelectorAll('button')]
    const list = aside.querySelector('[aria-label="Topics"]') as HTMLElement
    return {
      rows: [...aside.querySelectorAll('[data-topic-row]')].map(inset),
      nav: [...aside.querySelectorAll('nav [role="button"], nav button')].map(inset),
      firstPill: inset(buttons[0]!),
      unread: inset(buttons.at(-1)!),
      account: inset(aside.querySelector('header button[aria-label^="Account"]')),
      overflows: list.scrollHeight > list.clientHeight,
    }
  })
}

test.describe('sidebar inset', () => {
  for (const [id, overflows] of [
    ['list/default', true],
    ['views/overflowing', true],
    ['list/dms-only', false],
  ] as const) {
    test(`${id}: rows, filters, nav and title bar share one inset on both sides`, async ({ page }) => {
      await open(page, 'Sidebar', id)
      const at = await sidebarInsets(page)
      expect(at.overflows).toBe(overflows)
      const inset = at.nav[0]!.left
      expect(inset).toBe(10)
      expect(at.rows.length).toBeGreaterThan(0)
      for (const row of at.rows) expect(row).toEqual({ left: inset, right: inset })
      for (const item of at.nav) expect(item).toEqual({ left: inset, right: inset })
      expect(at.firstPill.left).toBe(inset)
      expect(at.unread.right).toBe(inset)
      expect(at.account.right).toBe(inset)
    })
  }

  test('privacy/on: the footer widget sits at the inset on the left, right and bottom, with Show 4px from its edges', async ({ page }) => {
    await open(page, 'Sidebar', 'privacy/on')
    const at = await page.evaluate(() => {
      const aside = document.querySelector('aside[aria-label="Sidebar"]')!
      const box = aside.getBoundingClientRect()
      const right = box.right - parseFloat(getComputedStyle(aside).borderRightWidth)
      const widget = aside.querySelector('[data-privacy-footer]')!.getBoundingClientRect()
      const show = aside.querySelector('[data-privacy-footer] button')!.getBoundingClientRect()
      const row = aside.querySelector('[data-topic-row]')!.getBoundingClientRect()
      return {
        widget: { left: widget.left - box.left, right: right - widget.right, bottom: box.bottom - widget.bottom },
        show: { top: show.top - widget.top, right: widget.right - show.right, bottom: widget.bottom - show.bottom },
        row: { left: row.left - box.left, right: right - row.right },
      }
    })
    expect(at.widget).toEqual({ left: 10, right: 10, bottom: 10 })
    expect(at.row).toEqual({ left: 10, right: 10 })
    expect(at.show).toEqual({ top: 4, right: 4, bottom: 4 })
  })

  test('views do not make the filter row taller or move the list', async ({ page }) => {
    const measure = () =>
      page.evaluate(() => {
        const filters = document.querySelector('[aria-label="Quick filters"]')!.getBoundingClientRect()
        const row = document.querySelector('[data-pill-row]') as HTMLElement
        const list = document.querySelector('[aria-label="Topics"]')!.getBoundingClientRect()
        return { height: filters.height, top: filters.top, listTop: list.top, rowOverflows: row.scrollWidth > row.clientWidth }
      })
    await open(page, 'Sidebar', 'list/default')
    const plain = await measure()
    await open(page, 'Sidebar', 'views/overflowing')
    const views = await measure()
    expect(views.rowOverflows).toBe(true)
    expect(plain.rowOverflows).toBe(false)
    expect({ height: views.height, top: views.top, listTop: views.listTop }).toEqual({ height: plain.height, top: plain.top, listTop: plain.listTop })
  })
})

test.describe('centred columns', () => {
  for (const [component, id] of [
    ['TopicView', 'thread/long-thread'],
    ['TopicView', 'header/narrow-thread'],
    ['TopicView', 'data/empty'],
    ['JunoChatList', 'chat/conversation'],
    ['JunoChatList', 'chat/empty'],
  ] as const) {
    test(`${component} ${id}: the column is as far from the left edge as from the right`, async ({ page }) => {
      await open(page, component, id)
      const at = await page.evaluate(() => {
        const scroller = document.querySelector('[data-scroll]') as HTMLElement
        const box = scroller.getBoundingClientRect()
        const column = scroller.firstElementChild!.getBoundingClientRect()
        return { left: column.left - box.left, right: box.right - column.right, gutter: scroller.offsetWidth - scroller.clientWidth }
      })
      expect(at.gutter).toBe(10)
      expect(at.left).toBe(at.right)
    })
  }
})
