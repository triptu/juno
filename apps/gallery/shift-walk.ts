import type { Locator, Page } from '@playwright/test'
import { expectNoLayoutShift, waitForLayoutReady } from '@juno/testing/layout-shift'
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

/** Elements tried per state. A state with more (an icon grid) is sampled from both ends. */
const perState = 8

async function targets(page: Page, route: Route): Promise<Locator[]> {
  // A disclosure that grows its content in place (Show more) moves what is under it on purpose.
  const all = page.locator(`[data-fixture-frame="${route.route}"]`).locator(interactive).and(page.locator(':not([data-expands-in-place] *)'))
  const count = await all.count()
  const indexes = Array.from({ length: count }, (_, index) => index)
  const picked = count <= perState ? indexes : [...indexes.slice(0, perState - 3), ...indexes.slice(-3)]
  const selected = picked.map((index) => all.nth(index))
  const visible = await Promise.all(selected.map((element) => element.isVisible()))
  return selected.filter((_, index) => visible[index])
}

/** After a touch: code the touch started loading (a popover's content) has rendered, so what it moves is measured too. */
const chunksLoaded = (page: Page) => page.evaluate(() => {
  if (document.querySelector('[data-chunk-pending]') === null) return
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      observer.disconnect()
      reject(new Error('Gallery chunks did not load within 15 s'))
    }, 15_000)
    const observer = new MutationObserver(() => {
      if (document.querySelector('[data-chunk-pending]') !== null) return
      clearTimeout(timer)
      observer.disconnect()
      resolve()
    })
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true })
  })
})

/** Touches one element every way a person can; returns what shifted, as readable text. */
export async function touch(page: Page, element: Locator): Promise<string[]> {
  const failures: string[] = []
  const check = async (what: string, action: () => Promise<unknown>) => {
    try {
      await expectNoLayoutShift(
        page,
        async () => {
          await action()
          await chunksLoaded(page)
        },
        { motion: 'layout' },
      )
    } catch (error) {
      failures.push(`${what}: ${(error as Error).message}`)
    }
  }

  // In one call, and without Playwright's actionability waits: the state is still, and they cost more than a touch.
  const position = await element.evaluate((node) => {
    const before = node.getBoundingClientRect()
    node.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    const box = node.getBoundingClientRect()
    return node.getClientRects().length > 0 ? { x: box.x, y: box.y, width: box.width, height: box.height, scrolled: before.x !== box.x || before.y !== box.y } : null
  }, undefined, { timeout: 5_000 })
  if (!position) return failures
  // Scrolling can lay out content-visibility rows; finish that before measuring input.
  if (position.scrolled) await waitForLayoutReady(page)
  const box = position.scrolled ? await element.boundingBox() : position
  if (!box) return failures
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2

  await check('hover', () => page.mouse.move(x, y))
  await check('focus from the keyboard', async () => {
    // A key first, so the browser is in keyboard mode and :focus-visible matches.
    await page.keyboard.press('Shift')
    await element.evaluate((node) => (node as HTMLElement).focus(), undefined, { timeout: 5_000 })
  })
  await check('blur', () => element.evaluate((node) => (node as HTMLElement).blur(), undefined, { timeout: 5_000 }))
  await check('press', () => page.mouse.down())
  await check('release', () => page.mouse.up())
  await check('leave', () => page.mouse.move(2, 2))
  return failures
}

/** Keep the exact markup in the browser: some states have hundreds of KB of DOM. */
const rememberMarkup = (page: Page, route: Route) => page.evaluate((frameName) => {
  Object.assign(globalThis, { __junoShiftMarkup: document.querySelector(`[data-fixture-frame="${frameName}"]`)?.innerHTML ?? '' })
}, route.route)

const markupChanged = (page: Page, route: Route) => page.evaluate((frameName) => {
  const scope: object = globalThis
  return !('__junoShiftMarkup' in scope) || scope.__junoShiftMarkup !== (document.querySelector(`[data-fixture-frame="${frameName}"]`)?.innerHTML ?? '')
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
    for (const [index, element] of (await targets(page, route)).entries()) {
      if (await markupChanged(page, route)) {
        // In place, the same state again passes through a page that draws no frame, so the fixture mounts fresh.
        resets++
        await openState(page, route, 'light', undefined, { inPlace: true })
        await rememberMarkup(page, route)
      }
      elements++
      for (const failure of await touch(page, element)) failures.push(`${route.route} (element ${index + 1}) ${failure}`)
    }
    await page.evaluate(() => { delete (globalThis as { __junoShiftMarkup?: string }).__junoShiftMarkup })
  })
  return { failures, cursors, elements, resets }
}
