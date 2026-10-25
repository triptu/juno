import { expect, type Page } from '@playwright/test'
import { openState, paintTest as test, readRoutes, type Route, type Theme } from './support'

/**
 * A control that opens a menu or popover keeps the fill it had under the
 * pointer: hover, press and open all draw the same background, so opening
 * changes no colour (primitives.md, "Open"). Each fixture set's `Open` group
 * holds four states per trigger, `<name>-hover`, `-press`, `-open` and
 * `-open-hover`; the trigger is the element the hover state hovers.
 */
const themes: ReadonlyArray<Theme> = ['light', 'dark']
// `open-hover` first, so `-hover` does not claim it.
const kinds = ['open-hover', 'hover', 'press', 'open'] as const

async function background(page: Page, route: Route, theme: Theme, selector: string): Promise<string> {
  await openState(page, route, theme)
  const frame = page.locator(`[data-fixture-frame="${route.route}"]`)
  const trigger = frame.locator(selector).first()
  await page.mouse.move(0, 0)
  const { hover, press } = route.frame
  if (hover !== undefined) await frame.locator(hover).first().hover()
  if (press !== undefined) {
    const box = await frame.locator(press).first().boundingBox()
    if (!box) throw new Error(`Nothing to press at ${press} in ${route.route}`)
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
  }
  // Under reduced motion the fill changes without a transition; two frames let hover and press reach the styles.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const value = await trigger.evaluate((element) => getComputedStyle(element).backgroundColor)
  if (press !== undefined) await page.mouse.up()
  return value
}

test('a trigger draws the same fill on hover, press and open', async ({ page }) => {
  const routes = (await readRoutes(page)).filter((route) => route.group === 'Open')
  const triggers = new Map<string, Map<string, Route>>()
  for (const route of routes) {
    const kind = kinds.find((name) => route.state.endsWith(`-${name}`))
    if (kind === undefined) continue
    const key = `${route.component}/${route.state.slice(0, -kind.length - 1)}`
    const set = triggers.get(key) ?? new Map<string, Route>()
    set.set(kind, route)
    triggers.set(key, set)
  }
  expect([...triggers.keys()]).toEqual(expect.arrayContaining(['IconButton/more', 'IconButton/island', 'Button/ghost', 'Button/filter', 'AvatarButton/avatar', 'TopicHeader/title', 'TopicHeader/more', 'Home/chip']))
  for (const [key, set] of triggers) {
    expect([...set.keys()].toSorted(), key).toEqual([...kinds].toSorted())
    const selector = set.get('hover')!.frame.hover!
    for (const theme of themes) {
      const fills: Partial<Record<(typeof kinds)[number], string>> = {}
      for (const kind of kinds) fills[kind] = await background(page, set.get(kind)!, theme, selector)
      expect(fills.hover, `${key} ${theme}: hover draws a fill`).not.toBe('rgba(0, 0, 0, 0)')
      for (const kind of kinds) expect(fills[kind], `${key} ${theme}: ${kind} matches hover`).toBe(fills.hover)
    }
  }
})
