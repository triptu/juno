import { expect, type Page } from '@playwright/test'

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
  // Wait for code, not data: loading and pending-image fixtures intentionally never settle.
  await expect(page.locator('[data-chunk-pending]')).toHaveCount(0)
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
