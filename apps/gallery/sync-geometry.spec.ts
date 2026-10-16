import { expect, test, type Page } from '@playwright/test'
import { openState, type Route } from './support'

/**
 * The sidebar's sync status card (inventory 2, "Sync status card"): at the
 * sidebar inset on three sides, with its leading icon and its button the
 * same distance from either edge and centred on the card.
 */

const open = (page: Page, component: string, id: string) =>
  openState(page, { component, id, route: `${component}/${id}`, group: '', groupId: '', state: '', frame: {} } satisfies Route)

test('sync/stopped: the status card sits at the inset, its icon and Restart 10px from either side and centred', async ({ page }) => {
  await open(page, 'Sidebar', 'sync/stopped')
  const at = await page.evaluate(() => {
    const aside = document.querySelector('aside[aria-label="Sidebar"]')!
    const box = aside.getBoundingClientRect()
    const right = box.right - parseFloat(getComputedStyle(aside).borderRightWidth)
    const card = aside.querySelector('[data-sync-status]')!.getBoundingClientRect()
    const icon = aside.querySelector('[data-sync-status] > span')!.getBoundingClientRect()
    const restart = aside.querySelector('[data-sync-status] button')!.getBoundingClientRect()
    const middle = (rect: DOMRect) => rect.top + rect.height / 2 - (card.top + card.height / 2)
    return {
      card: { left: card.left - box.left, right: right - card.right, bottom: box.bottom - card.bottom },
      inner: { icon: icon.left - card.left, restart: card.right - restart.right },
      offCentre: { icon: middle(icon), restart: middle(restart) },
    }
  })
  expect(at.card).toEqual({ left: 10, right: 10, bottom: 10 })
  expect(at.inner).toEqual({ icon: 10, restart: 10 })
  expect(at.offCentre).toEqual({ icon: 0, restart: 0 })
})
