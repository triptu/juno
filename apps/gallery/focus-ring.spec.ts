import { expect, test, type Page } from '@playwright/test'
import { claimQueue, openState, readRoutes, walkPages, type Route } from './support'

/**
 * A focus ring must show whole. Every state of each main surface is tabbed
 * through from the keyboard. For each element that draws
 * a ring, the ring's box (the element's box grown by the outline's width and
 * offset) must sit inside the client box of every ancestor that clips: one
 * whose overflow is not visible on that axis, or with paint containment. A
 * ring that is cut off shows as `( )` around a pill.
 *
 * Light only: a theme sets colours and shadows, never a size, an outline
 * width or offset, an overflow or a containment, so dark draws every ring in
 * the same box and the same clips.
 *
 * To look at one component: GALLERY_RING_ONLY=Sidebar bun run test:gallery
 * (GALLERY_RING_ONLY=* walks every component).
 */

/** The surfaces a person tabs through, plus the primitives that hold a scroller. */
const surfaces = [
  'Sidebar',
  'Tabs',
  'Shell',
  'Workspace',
  'TitlebarNav',
  'TopicHeader',
  'TopicView',
  'TopicRow',
  'TopicSwitcher',
  'CommandPalette',
  'AllTopics',
  'Home',
  'Composer',
  'Message',
  'SettingsPage',
  'AppearanceSettings',
  'NotificationsPage',
  'JunoChatList',
  'JunoHeader',
  'JunoComposer',
  'EmptyChat',
  'JunoSettingsPage',
  'ConnectionsPage',
  'MemoryPage',
  'ReviewPage',
  'ScheduledPage',
  'ActivityPage',
  'EmojiPicker',
  'ChannelIconPicker',
  'AccountMenu',
  'Segmented',
  'OptionList',
  'ScrollArea',
  'Popover',
  'PeekView',
  'ConnectionToolsSheet',
]

/** The parts share the states through one queue, so they run in parallel and finish together. */
const parts = Number(process.env.GALLERY_RING_PARTS ?? 4)

/** Tab stops tried per state; enough to leave every frame in the gallery. */
const maxStops = 60

const only = process.env.GALLERY_RING_ONLY?.split(',').map((name) => name.trim())

interface Clip {
  readonly element: string
  readonly ancestor: string
  readonly sides: string
}

interface Measured {
  /** Where the element sits under the frame, so a repeat visit is recognised. */
  readonly key: string
  readonly clips: ReadonlyArray<Clip>
}

/**
 * Measures the focused element's ring against every clipping ancestor up to
 * the frame. Runs in the page. Undefined when focus is not inside the frame.
 */
function measure(frameRoute: string): Measured | undefined {
  const frame = document.querySelector(`[data-fixture-frame="${CSS.escape(frameRoute)}"]`)
  const element = document.activeElement
  if (frame === null || !(element instanceof HTMLElement) || !frame.contains(element) || element === frame) return undefined
  const name = (node: Element) => {
    const label = node.getAttribute('aria-label') ?? node.getAttribute('title') ?? node.textContent?.trim().slice(0, 30) ?? ''
    const data = [...node.attributes].find((attribute) => attribute.name.startsWith('data-'))?.name
    const role = node.getAttribute('role')
    return `<${node.tagName.toLowerCase()}${data ? ` ${data}` : ''}${role ? ` role=${role}` : ''}> "${label}"`
  }
  const path: number[] = []
  for (let node: Element | null = element; node && node !== frame; node = node.parentElement) {
    path.push(node.parentElement ? [...node.parentElement.children].indexOf(node) : 0)
  }
  const key = path.join('.')
  const style = getComputedStyle(element)
  const width = parseFloat(style.outlineWidth) || 0
  if (style.outlineStyle === 'none' || width === 0 || !element.matches(':focus-visible')) return { key, clips: [] }
  // An inset ring (a negative offset) draws inside the box and needs no room.
  const grow = Math.max(0, width + (parseFloat(style.outlineOffset) || 0))
  const box = element.getBoundingClientRect()
  const ring = { left: box.left - grow, top: box.top - grow, right: box.right + grow, bottom: box.bottom + grow }
  const clips: Clip[] = []
  for (let node = element.parentElement; node && node !== frame; node = node.parentElement) {
    const ancestor = getComputedStyle(node)
    const paint = /paint|content|strict/.test(ancestor.contain)
    const clipsX = paint || ancestor.overflowX !== 'visible'
    const clipsY = paint || ancestor.overflowY !== 'visible'
    if (!clipsX && !clipsY) continue
    // Paint containment and overflow: clip may paint past the edge by overflow-clip-margin.
    const margin = paint || ancestor.overflowX === 'clip' || ancestor.overflowY === 'clip' ? parseFloat(/-?[\d.]+px/.exec(ancestor.overflowClipMargin)?.[0] ?? '0') : 0
    const outer = node.getBoundingClientRect()
    const left = outer.left + node.clientLeft - margin
    const top = outer.top + node.clientTop - margin
    const client = { left, top, right: left + node.clientWidth + 2 * margin, bottom: top + node.clientHeight + 2 * margin }
    // Half a pixel for rounding at fractional device pixels.
    const sides = [
      clipsX && ring.left < client.left - 0.5 ? 'left' : '',
      clipsX && ring.right > client.right + 0.5 ? 'right' : '',
      clipsY && ring.top < client.top - 0.5 ? 'top' : '',
      clipsY && ring.bottom > client.bottom + 0.5 ? 'bottom' : '',
    ].filter(Boolean)
    if (sides.length > 0) clips.push({ element: name(element), ancestor: name(node), sides: sides.join(', ') })
  }
  return { key, clips }
}

/** Items that arrow keys move focus to: out of the tab order until they are reached. */
const roving = '[tabindex="-1"]:is([role="tab"], [role="radio"], [role="listitem"], [role="menuitem"], [role="option"], [role="button"])'

/**
 * States whose clipping is the gallery's, not the product's. The peek's
 * width reads `100vw`, the window's width in the app, but the gallery frame
 * of a minimum window is narrower than the gallery's viewport, so the whole
 * peek overruns the frame's shell.
 */
const exempt = new Set(['PeekView/window/minimum-window'])

/**
 * Focuses the frame and presses Tab until focus leaves it or comes back to
 * an element it has seen; then focuses each item arrow keys would reach, as
 * a roving focus handler does. Returns every ring that something cut off.
 */
async function tabThrough(page: Page, route: Route): Promise<Clip[]> {
  const frame = page.locator(`[data-fixture-frame="${route.route}"]`)
  await frame.evaluate((node) => {
    node.setAttribute('tabindex', '-1')
    ;(node as HTMLElement).focus()
  })
  const clips: Clip[] = []
  const seen = new Set<string>()
  for (let stop = 0; stop < maxStops; stop++) {
    await page.keyboard.press('Tab')
    const found = await page.evaluate(measure, route.route)
    if (found === undefined || seen.has(found.key)) break
    seen.add(found.key)
    clips.push(...found.clips)
  }
  const items = frame.locator(roving)
  const count = Math.min(await items.count(), maxStops)
  for (let index = 0; index < count; index++) {
    const item = items.nth(index)
    if (!(await item.isVisible())) continue
    await item.evaluate((node) => (node as HTMLElement).focus())
    const found = await page.evaluate(measure, route.route)
    if (found === undefined || seen.has(found.key)) continue
    seen.add(found.key)
    clips.push(...found.clips)
  }
  return clips
}

for (let part = 0; part < parts; part++) {
  test(`a focus ring is never cut off by a scroller (part ${part + 1} of ${parts})`, async ({ browser }) => {
    test.setTimeout(15 * 60_000)
    const pages = await walkPages(browser)
    const wanted = only ?? surfaces
    const routes = (await readRoutes(pages.page())).filter((route) => (wanted.includes('*') || wanted.includes(route.component)) && !exempt.has(route.route))
    expect(routes.length).toBeGreaterThan(0)
    const queue = claimQueue('ring')
    const failures: string[] = []
    for (let route = queue.next(routes); route !== undefined; route = queue.next(routes)) {
      const page = await pages.next()
      await openState(page, route)
      // A key first, so the browser is in keyboard mode and :focus-visible matches.
      await page.keyboard.press('Shift')
      for (const clip of await tabThrough(page, route)) {
        failures.push(`${route.route}: ${clip.element} is cut off at the ${clip.sides} by ${clip.ancestor}`)
      }
    }
    await pages.close()
    expect([...new Set(failures)].join('\n')).toBe('')
  })
}
