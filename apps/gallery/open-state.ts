import { expect, type Page } from '@playwright/test'

// How the gallery opens one state. The broad walks import this, so a walk
// record (walk-cache.mjs) keys on it; support.ts holds the scaffolding.

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
function stateUrl(route: Pick<Route, 'component' | 'id'>, theme: Theme = 'light', accent?: string): string {
  return `/#/${encodeURIComponent(route.component)}?__state=${route.id}${theme === 'light' ? '' : `&theme=${theme}`}${accent === undefined ? '' : `&accent=${accent}`}`
}

/**
 * Opens one state and waits until it is drawn: chunks, fonts and images loaded, theme applied, entrance animations done.
 * With `finishMotion`, entrance animations are finished at once instead of waited for (the computed shift check).
 * With `inPlace`, the open gallery document moves to the state through its hash instead of loading again: the frame is
 * keyed by state, so the fixture mounts fresh, but module state, the window's scroll and listeners on it remain.
 */
export async function openState(page: Page, route: Route, theme: Theme = 'light', accent?: string, { finishMotion = false, inPlace = false } = {}): Promise<void> {
  if (inPlace) {
    await page.evaluate(async (hash) => {
      ;(document.activeElement as HTMLElement | null)?.blur?.()
      getSelection()?.removeAllRanges()
      // A state opened again must mount again, so pass through a page that draws no frame.
      if (location.hash === hash) {
        location.hash = '#/~'
        const deadline = performance.now() + 5_000
        while (document.querySelector('[data-fixture-frame]') !== null) {
          if (performance.now() >= deadline) throw new Error('The gallery did not leave the state within 5 s')
          await new Promise((resolve) => setTimeout(resolve, 0))
        }
      }
      scrollTo(0, 0)
      location.hash = hash
    }, stateUrl(route, theme, accent).slice(1))
  } else {
    await page.goto(stateUrl(route, theme, accent))
  }
  await expect(page.locator(`[data-fixture-frame="${route.route}"]`)).toBeVisible()
  // Wait for code, not data: loading and pending-image fixtures intentionally never settle. Some chunks start in an idle
  // callback with a 5 s deadline (the destination lists), so on a busy machine the load begins only then.
  await expect(page.locator('[data-chunk-pending]')).toHaveCount(0, { timeout: 15_000 })
  // Let the frame's images load or fail: a failed unfurl image removes its box (AttachmentCard), and on a busy machine
  // the error can land after the state looks drawn. The held Avatar photo and lazy images out of view are not waited for.
  await page.evaluate(async ({ frameName, finish }) => {
    document.body.getBoundingClientRect()
    await document.fonts.ready
    const frame = document.querySelector(`[data-fixture-frame="${frameName}"]`)
    const inView = (img: HTMLImageElement) => {
      const box = img.getBoundingClientRect()
      return box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth
    }
    const loading = Array.from(frame?.querySelectorAll('img') ?? []).filter(
      (img) => !img.complete && !img.src.endsWith('/__fixture/pending.png') && (img.loading !== 'lazy' || inView(img)),
    )
    const settled = loading.map((img) => new Promise((resolve) => {
      img.addEventListener('load', resolve, { once: true })
      img.addEventListener('error', resolve, { once: true })
    }))
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([Promise.all(settled), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Images did not settle in ${frameName}`)), 10_000)
      })])
    } finally { clearTimeout(timer) }
    // Two frames, so React has drawn what the load or error changed.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    // Usually already applied. Keep the check beside readiness, avoiding another driver round trip.
    const deadline = performance.now() + 15_000
    while (document.documentElement.hasAttribute('data-theme-switching')) {
      if (performance.now() >= deadline) throw new Error('Gallery theme did not settle within 15 s')
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }
    // Let entrances finish, with the same cap for long finite motion. Endless spinners are not waited for.
    if (finish) {
      for (const animation of document.getAnimations()) if (Number.isFinite(Number(animation.effect?.getComputedTiming().endTime))) animation.finish()
      return
    }
    try {
      await Promise.race([
        Promise.all(document.getAnimations()
          .filter(animation => Number.isFinite(Number(animation.effect?.getComputedTiming().endTime)))
          .map(animation => animation.finished.catch(() => {}))),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Entrance motion did not settle in ${frameName}`)), 5_000)
        }),
      ])
    } finally { clearTimeout(timer) }

  }, { frameName: route.route, finish: finishMotion })
}
