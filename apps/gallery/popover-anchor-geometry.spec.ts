import { expect, test } from '@playwright/test'
import { openState, readRoutes } from './support'

/**
 * A popover lines up with the control that opened it, not with a wrapper
 * around it (primitives.md, Popover `alignTo`): a start placement's left
 * edge is the trigger's left edge, within a pixel. Where that would run
 * past the frame, it moves in and stays inside.
 */
const cases = [
  { component: 'TopicHeader', state: 'switcher-thread', trigger: 'h1 button', panel: '[aria-label="Topics in this channel"]' },
  { component: 'TopicHeader', state: 'switcher-main', trigger: 'h1 button', panel: '[aria-label="Topics in this channel"]' },
  { component: 'JunoHeader', state: 'open', trigger: 'button[aria-haspopup="menu"]', panel: '[aria-label="Juno menu"]' },
  { component: 'Home', state: 'chip-open', trigger: 'button[aria-label="Send to: Juno"]', panel: '[aria-label="Send to"]' },
] as const

for (const { component, state, trigger, panel } of cases) {
  test(`${component} ${state}: the popover starts at its trigger's left edge`, async ({ page }) => {
    const route = (await readRoutes(page)).find((each) => each.component === component && each.state === state)
    expect(route, `${component}/${state} exists`).toBeDefined()
    await openState(page, route!)
    const frame = page.locator(`[data-fixture-frame="${route!.route}"]`)
    const button = (await frame.locator(trigger).first().boundingBox())!
    const box = (await frame.locator(panel).first().boundingBox())!
    expect(Math.abs(box.x - button.x)).toBeLessThanOrEqual(1)
  })
}

test('TopicHeader at 336px: the switcher moves in from the window edge and stays inside', async ({ page }) => {
  const route = (await readRoutes(page)).find((each) => each.component === 'TopicHeader' && each.state === 'switcher-336')!
  await openState(page, route)
  const frame = page.locator(`[data-fixture-frame="${route.route}"]`)
  const wide = (await frame.boundingBox())!
  // The frame does not clip, so the window's edge stands in for the pane's: end the window at the frame's right edge.
  await page.setViewportSize({ width: Math.ceil(wide.x + wide.width), height: page.viewportSize()!.height })
  await openState(page, route)
  const width = await page.evaluate(() => document.documentElement.clientWidth)
  const button = (await frame.locator('h1 button').first().boundingBox())!
  const box = (await frame.locator('[aria-label="Topics in this channel"]').first().boundingBox())!
  expect(box.x + box.width).toBeLessThanOrEqual(width)
  // It moved in only as far as the edge needed: at the trigger's left edge, or left of it by the overflow.
  expect(box.x).toBeLessThanOrEqual(button.x + 1)
  expect(box.x).toBeGreaterThanOrEqual(0)
})
