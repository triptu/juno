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
    const started = performance.now()
    const timing = { open: 0, rules: 0, reload: 0, forced: 0, act: 0, settle: 0, boxes: 0, diff: 0, pseudo: 0, total: 0 }
    const failures: string[] = []
    let elements = 0, resets = 0, unforced = 0
    await checkStateWithin(route, async () => {
      if (opened === statesPerDocument) {
        const start = performance.now()
        await page.evaluate(() => { location.hash = '#/~' })
        await page.reload()
        timing.reload += performance.now() - start
        opened = 0
      }
      opened++
      const open = async () => {
        const start = performance.now()
        await openState(page, route, 'light', undefined, { finishMotion: true, inPlace: true })
        timing.open += performance.now() - start
      }
      const check = async (from = 0) => {
        const start = performance.now()
        const report = await forced(page, from)
        timing.forced += performance.now() - start
        for (const key of ['act', 'settle', 'boxes', 'diff', 'pseudo', 'total'] as const) timing[key] += report.timing[key]
        return report
      }
      await open()
      const rulesStart = performance.now()
      failures.push(...await drawnRules(page, route))
      timing.rules += performance.now() - rulesStart
      for (let report = await check(); ; report = await check(report.next)) {
        elements += report.touched
        unforced = Math.max(unforced, report.unforced)
        failures.push(...report.shifts.map(shift => `element ${shift.element + 1}, ${shift.target}: ${formatForcedShift(shift)}`))
        if (report.next === undefined) break
        resets++
        await open()
      }
    })
    if (process.env.GALLERY_PROFILE === '1') console.log(`gallery-state: ${JSON.stringify({ route: route.route, ms: performance.now() - started, elements, resets, timing })}`)
    return { failures, elements, resets, unforced }
  }
}
