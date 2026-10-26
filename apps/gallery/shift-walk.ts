import type { Locator, Page } from '@playwright/test'
import { layoutShiftError, waitForLayoutReady, watchLayoutShift, type LayoutShiftWatch } from '@juno/testing/layout-shift'
import { openState, type Route } from './open-state'

/**
 * What the broad shift walk does to one state. A walk record (walk-cache.mjs)
 * keys on this file and what it imports (open-state.ts and the guard), so a
 * change here walks every state again; the spec's other tests and support.ts
 * do not.
 */

/** Motion is left on: reduced motion collapses transitions, which would hide a shift that only a real transition produces. */
export const walkUse = { reducedMotion: 'no-preference' } as const

/** What a person can point at or tab to, plus scroll areas. Disabled controls cannot be pointed at. */
export const interactive = [
  'button:not(:disabled)',
  'a[href]',
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[role="button"]',
  '[role="tab"]',
  '[role="option"]',
  '[role="radio"]',
  '[role="menuitem"]',
  '[role="switch"]',
  '[role="slider"]',
  '[tabindex]:not([tabindex="-1"])',
  // Scroll areas show their thumb on hover; the gutter must not change.
  '[data-scroll-area]',
].join(', ')

/** The guard waits out only motion that can move a box: every touch starts colour fades. */
const walkGuard = { motion: 'layout' } as const

/** Elements tried per state. A state with more (an icon grid) is sampled from both ends. */
const perState = 8

/**
 * The elements a state's walk touches, kept in the page on `__junoWalkTargets` so each touch reaches its element
 * without querying the frame again. Returns how many there are.
 */
const findTargets = (page: Page, route: Route) => page.evaluate(({ frameName, selector, max }) => {
  const frame = document.querySelector(`[data-fixture-frame="${frameName}"]`)
  // A disclosure that grows its content in place (Show more) moves what is under it on purpose.
  const all = Array.from(frame?.querySelectorAll<HTMLElement>(selector) ?? []).filter((el) => el.closest('[data-expands-in-place]') === null)
  const picked = all.length <= max ? all : [...all.slice(0, max - 3), ...all.slice(-3)]
  // Visible as Playwright counts it: a box with some size and not visibility: hidden.
  const visible = picked.filter((el) => {
    const box = el.getBoundingClientRect()
    return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== 'hidden'
  })
  Object.assign(globalThis, { __junoWalkTargets: visible })
  return visible.length
}, { frameName: route.route, selector: interactive, max: perState })

/** What `touch` needs of an element: a way to run code on it in the page. */
type Target = (fn: (node: HTMLElement) => unknown) => Promise<unknown>

const ofLocator = (element: Locator): Target => (fn) => element.evaluate(fn, undefined, { timeout: 5_000 })

/** The `index`th element `findTargets` kept. `fn` reaches the page as source, so it uses only its argument. */
const ofWalkTarget = (page: Page, index: number): Target => (fn) =>
  page.evaluate(`(${fn.toString()})(globalThis.__junoWalkTargets[${index}])`)

/**
 * Touches one element every way a person can; returns what shifted, as readable text. A walk passes its state's
 * watch, so the last touch's boxes are this one's baseline; otherwise the touch watches on its own.
 */
export async function touch(page: Page, element: Locator | Target, shared?: LayoutShiftWatch): Promise<string[]> {
  const run = typeof element === 'function' ? element : ofLocator(element)
  const failures: string[] = []

  // In one call, and without Playwright's actionability waits: the state is still, and they cost more than a touch.
  const position = await run((node) => {
    const before = node.getBoundingClientRect()
    node.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    const box = node.getBoundingClientRect()
    return node.getClientRects().length > 0 ? { x: box.x, y: box.y, width: box.width, height: box.height, scrolled: before.x !== box.x || before.y !== box.y } : null
  }) as { x: number; y: number; width: number; height: number; scrolled: boolean } | null
  if (!position) return failures
  // Scrolling can lay out content-visibility rows; finish that, and measure from there, before measuring input.
  if (position.scrolled) {
    await waitForLayoutReady(page)
    await shared?.rebase()
  }
  const box = position.scrolled ? await run((node) => node.getBoundingClientRect().toJSON()) as { x: number; y: number; width: number; height: number } : position
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2

  // One watch for the six touches: each check's last snapshot is the next one's first.
  const watch = shared ?? await watchLayoutShift(page, walkGuard)
  const check = async (what: string, action: () => Promise<unknown>) => {
    try {
      // Code the touch started loading (a popover's content) renders before the boxes are read, so what it moves is measured too.
      const error = layoutShiftError(await watch.check(action, { pending: '[data-chunk-pending]' }))
      if (error) failures.push(`${what}: ${error.message}`)
    } catch (error) {
      failures.push(`${what}: ${(error as Error).message}`)
    }
  }
  try {
    await check('hover', () => page.mouse.move(x, y))
    await check('focus from the keyboard', async () => {
      // A key first, so the browser is in keyboard mode and :focus-visible matches.
      await page.keyboard.press('Shift')
      await run((node) => node.focus())
    })
    await check('blur', () => run((node) => node.blur()))
    await check('press', () => page.mouse.down())
    await check('release', () => page.mouse.up())
    await check('leave', () => page.mouse.move(2, 2))
  } finally {
    if (!shared) await watch.stop()
  }
  return failures
}

/**
 * Keep the exact markup in the browser: some states have hundreds of KB of DOM. A mutation observer notes whether
 * anything under the frame changed since, so a touch that changed nothing costs no serialisation.
 */
const rememberMarkup = (page: Page, route: Route) => page.evaluate((frameName) => {
  const scope = globalThis as { __junoShiftMarkup?: { frame: Element | null; html: string; touched: boolean; observer: MutationObserver } }
  scope.__junoShiftMarkup?.observer.disconnect()
  const frame = document.querySelector(`[data-fixture-frame="${frameName}"]`)
  const remembered = { frame, html: frame?.innerHTML ?? '', touched: false, observer: new MutationObserver(() => { remembered.touched = true }) }
  if (frame) remembered.observer.observe(frame, { subtree: true, childList: true, attributes: true, characterData: true })
  scope.__junoShiftMarkup = remembered
}, route.route)

/** True when the frame's markup differs from what `rememberMarkup` kept. A change put back counts as no change. */
const markupChanged = (page: Page, route: Route) => page.evaluate((frameName) => {
  const remembered = (globalThis as { __junoShiftMarkup?: { frame: Element | null; html: string; touched: boolean } }).__junoShiftMarkup
  if (!remembered) return true
  // The observer sees inside the frame; a frame that went (a link left the state) is a change too.
  if (!remembered.touched && remembered.frame?.isConnected === true) return false
  return remembered.html !== (document.querySelector(`[data-fixture-frame="${frameName}"]`)?.innerHTML ?? '')
}, route.route)

/**
 * SPEC section 16: the arrow cursor everywhere, the text cursor only over
 * editable or selectable text, never the pointer. An element may compute
 * `cursor: text` only when it also computes `user-select: text`, or when it
 * is part of a field (a label wrapping an input), which focuses the input
 * wherever it is clicked. Links that open outside Juno are the one place the
 * hand cursor is allowed.
 */
const cursorOffenders = (page: Page, route: Route) =>
  page.evaluate((frameName) => {
    const frame = document.querySelector(`[data-fixture-frame="${frameName}"]`)
    if (!frame) return ['no frame']
    const bad: string[] = []
    for (const element of Array.from(frame.querySelectorAll('*'))) {
      const style = getComputedStyle(element)
      const describe = () => `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}[cursor=${style.cursor}]`
      const external = element.closest('a[href^="http:"], a[href^="https:"], a[href^="mailto:"]') !== null
      if (style.cursor === 'pointer' && !external) bad.push(describe())
      const inField = element.closest('label') !== null && element.closest('label')!.querySelector('input, textarea') !== null
      if (style.cursor === 'text' && style.userSelect !== 'text' && !inField) bad.push(describe())
    }
    return bad
  }, route.route)

export async function checkStateWithin(route: Route, check: () => Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      check(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${route.route}: state check did not finish within 30 s`)), 30_000)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export interface StateResult {
  readonly failures: ReadonlyArray<string>
  readonly cursors: ReadonlyArray<string>
  readonly elements: number
  readonly resets: number
}

/** States one document opens before it is loaded again, so what fixtures leave behind stays small. */
export const statesPerDocument = 150

/** The walk opens its states in place in the test's page; the document is loaded again every `statesPerDocument` states. */
export function walkPages(page: Page) {
  let opened = 0
  return {
    page: () => page,
    next: async (): Promise<Page> => {
      if (opened === statesPerDocument) {
        await page.evaluate(() => { location.hash = '#/~' })
        await page.reload()
        opened = 0
      }
      opened++
      await page.mouse.move(0, 0)
      return page
    },
  }
}

/** Opens one state, checks the cursor rule, and touches each target every way a person can. */
export async function walkState(pages: { readonly next: () => Promise<Page> }, route: Route): Promise<StateResult> {
  const failures: string[] = []
  const cursors: string[] = []
  let elements = 0, resets = 0
  await checkStateWithin(route, async () => {
    const page = await pages.next()
    await openState(page, route, 'light', undefined, { inPlace: true })
    for (const hit of await cursorOffenders(page, route)) cursors.push(`${route.route}: ${hit}`)
    await rememberMarkup(page, route)
    // An interactive fixture can change when touched (a press on Undo puts back other buttons), so the elements
    // after it would be gone or different: open the state again whenever a touch changed what it draws.
    const count = await findTargets(page, route)
    let watch = await watchLayoutShift(page, walkGuard)
    for (let index = 0; index < count; index++) {
      if (await markupChanged(page, route)) {
        // In place, the same state again passes through a page that draws no frame, so the fixture mounts fresh.
        resets++
        await openState(page, route, 'light', undefined, { inPlace: true })
        await rememberMarkup(page, route)
        // The state drawn again is the same, so the same sample keeps its places.
        if (index >= await findTargets(page, route)) {
          failures.push(`${route.route}: opened again, it drew fewer elements to touch`)
          break
        }
        watch = await watchLayoutShift(page, walkGuard)
      }
      elements++
      for (const failure of await touch(page, ofWalkTarget(page, index), watch)) failures.push(`${route.route} (element ${index + 1}) ${failure}`)
    }
    await watch.stop()
    await page.evaluate(() => {
      const scope = globalThis as { __junoShiftMarkup?: { observer: MutationObserver } }
      scope.__junoShiftMarkup?.observer.disconnect()
      delete scope.__junoShiftMarkup
    })
  })
  return { failures, cursors, elements, resets }
}
