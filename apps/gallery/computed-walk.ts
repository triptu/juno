import type { Page } from '@playwright/test'
import { checkForcedInteractions, formatForcedShift } from '@juno/testing/forced-shift'
import { openState, type Route } from './open-state'
import { checkStateWithin, interactive, statesPerDocument } from './shift-walk'

/** These inputs, including readiness and the forced guard, belong to the computed walk's cache key. */
export const forced = (page: Page, from = 0) =>
  checkForcedInteractions(page, { targets: interactive, skipWithin: '[data-expands-in-place]', pending: '[data-chunk-pending]', max: 8, from })

/** Rules read from the drawn state before its styles are forced. Trigger fills keep their separate paint-aware test. */
export const drawnRules = (page: Page, route: Route) => page.evaluate((frameName) => {
  const frame = document.querySelector(`[data-fixture-frame="${frameName}"]`)
  if (!frame) throw new Error(`Missing fixture ${frameName}`)
  const failures: string[] = []
  for (const element of frame.querySelectorAll('*')) {
    const style = getComputedStyle(element)
    const external = element.closest('a[href^="http:"], a[href^="https:"], a[href^="mailto:"]') !== null
    const label = element.closest('label')
    const inField = label !== null && label.querySelector('input, textarea') !== null
    if ((style.cursor === 'pointer' && !external) || (style.cursor === 'text' && style.userSelect !== 'text' && !inField)) {
      failures.push(`${element.tagName.toLowerCase()}: cursor ${style.cursor}`)
    }
  }
  for (const row of frame.querySelectorAll<HTMLElement>('[data-message-row]')) {
    const height = row.getBoundingClientRect().height
    if (Math.abs(height - Math.round(height)) > 0.001) failures.push(`message ${row.dataset['messageRow']}: fractional height ${height}px`)
  }
  return failures
}, route.route)

/** One dedicated document per part: forced CSS and the click-default blocker must never reach real-input tests. */
export function computedWalk(page: Page) {
  let opened = 0
  return async (route: Route) => {
    const failures: string[] = []
    let elements = 0, resets = 0, unforced = 0
    await checkStateWithin(route, async () => {
      if (opened === statesPerDocument) {
        await page.evaluate(() => { location.hash = '#/~' })
        await page.reload()
        opened = 0
      }
      opened++
      const open = () => openState(page, route, 'light', undefined, { finishMotion: true, inPlace: true })
      await open()
      failures.push(...await drawnRules(page, route))
      for (let report = await forced(page); ; report = await forced(page, report.next)) {
        elements += report.touched
        unforced = Math.max(unforced, report.unforced)
        failures.push(...report.shifts.map(shift => `element ${shift.element + 1}, ${shift.target}: ${formatForcedShift(shift)}`))
        if (report.next === undefined) break
        resets++
        await open()
      }
    })
    return { failures, elements, resets, unforced }
  }
}
