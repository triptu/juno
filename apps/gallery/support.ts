import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

/** One state, as the gallery lists it on `window.__galleryRoutes`. */
export interface Route {
  readonly component: string
  /** The group heading as declared; empty when the state has no group. */
  readonly group: string
  readonly groupId: string
  /** The state key, for example `loading`. */
  readonly state: string
  /** The `__state` URL value, for example `data/loading`. */
  readonly id: string
  /** `<component>/<id>`: the frame's `data-fixture-frame`. */
  readonly route: string
  readonly frame: {
    readonly hover?: string
    readonly press?: string
    readonly focus?: string
    readonly drag?: { readonly from: string; readonly by: number }
    readonly tooltip?: string
  }
}

export type Theme = 'light' | 'dark'

/** The address of a state, for example `/#/Button?__state=variant/primary&theme=dark`. */
export function stateUrl(route: Pick<Route, 'component' | 'id'>, theme: Theme = 'light'): string {
  return `/#/${encodeURIComponent(route.component)}?__state=${route.id}${theme === 'light' ? '' : `&theme=${theme}`}`
}

/** Opens the index once and reads every state from the page. */
export async function readRoutes(page: Page): Promise<ReadonlyArray<Route>> {
  await page.goto('/#/')
  // The gallery sets the list once its script has run, which a busy machine can delay past the load event.
  await page.waitForFunction(() => (window as unknown as { __galleryRoutes?: unknown }).__galleryRoutes !== undefined)
  const routes = await page.evaluate(() => (window as unknown as { __galleryRoutes: ReadonlyArray<Route> }).__galleryRoutes)
  expect(routes.length).toBeGreaterThan(0)
  return routes
}

/** Opens one state and waits until it is drawn: chunks and fonts loaded, theme applied, entrance animations done. */
export async function openState(page: Page, route: Route, theme: Theme = 'light'): Promise<void> {
  await page.goto(stateUrl(route, theme))
  await expect(page.locator(`[data-fixture-frame="${route.route}"]`)).toBeVisible()
  // Wait for code, not data: loading and pending-image fixtures intentionally never settle. Some chunks start in an idle
  // callback with a 5 s deadline (the destination lists), so on a busy machine the load begins only then.
  await expect(page.locator('[data-chunk-pending]')).toHaveCount(0, { timeout: 15_000 })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-theme-switching'))
  // Let entrances (toasts, popovers) finish; an endless animation does not hold this up.
  await page.evaluate(() =>
    Promise.race([
      Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => {}))),
      new Promise((resolve) => setTimeout(resolve, 600)),
    ]),
  )
}

/**
 * A queue of states that several tests (the parts of one check) share, so
 * the parts finish together however long each state takes. The run's id
 * comes from playwright.config.ts, so every worker sees the same queue.
 * Each repeat (`--repeat-each`, as `pnpm flake` runs) has its own queue, so
 * every repeat walks every state. A claim is a directory: mkdir succeeds for
 * one process only.
 */
export function claimQueue(name: string) {
  const dir = join(tmpdir(), 'juno-gallery-shift', process.env.GALLERY_SHIFT_RUN ?? 'local', `${name}-${test.info().repeatEachIndex}`)
  mkdirSync(dir, { recursive: true })
  const claim = (key: string): boolean => {
    try {
      mkdirSync(join(dir, encodeURIComponent(key)))
      return true
    } catch {
      return false
    }
  }
  // Every state before the last one claimed here was taken by some part already.
  let from = 0
  return {
    /** The next state of `routes` no part has taken yet, in order. Pass the same list each time. */
    next: (routes: ReadonlyArray<Route>): Route | undefined => {
      for (; from < routes.length; from++) {
        if (claim(`state ${routes[from]!.route}`)) return routes[from++]
      }
      return undefined
    },
    /** Claims any other key (a DOM signature); false when a part already has it. */
    claim,
  }
}
