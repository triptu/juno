import { linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir, release } from 'node:os'
import { join, resolve as resolvePath } from 'node:path'
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { walkCache } from './walk-cache.mjs'

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

/** Runs one state's check with a 30-second deadline, so one stuck state names itself instead of using up its part. */
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


/** The address of a state, for example `/#/Button?__state=variant/primary&theme=dark`. */
export function stateUrl(route: Pick<Route, 'component' | 'id'>, theme: Theme = 'light', accent?: string): string {
  return `/#/${encodeURIComponent(route.component)}?__state=${route.id}${theme === 'light' ? '' : `&theme=${theme}`}${accent === undefined ? '' : `&accent=${accent}`}`
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

/**
 * Opens one state and waits until it is drawn: chunks, fonts and images loaded, theme applied, entrance animations done.
 * With `finishMotion`, entrance animations are finished at once instead of waited for (the computed shift check).
 */
export async function openState(page: Page, route: Route, theme: Theme = 'light', accent?: string, { finishMotion = false } = {}): Promise<void> {
  await page.goto(stateUrl(route, theme, accent))
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

/** Each test owns its browser context; parts claim work through atomic directories. */
export function claimQueue(name: string) {
  const { repeatEachIndex, retry } = test.info()
  const dir = join(tmpdir(), 'juno-gallery-shift', process.env.GALLERY_SHIFT_RUN ?? 'local', `${name}-${repeatEachIndex}-${retry}`)
  mkdirSync(dir, { recursive: true })
  let from = 0
  return {
    /**
     * The same list for every part: the first part to get here computes and records it.
     * Parts pass states while others start, so computing it in each part could differ.
     */
    shared(compute: () => ReadonlyArray<string>): ReadonlyArray<string> {
      const file = join(dir, 'selection.json')
      try {
        return JSON.parse(readFileSync(file, 'utf8')) as string[]
      } catch {
        const temporary = `${file}.${process.pid}.${Date.now()}.tmp`
        writeFileSync(temporary, JSON.stringify(compute()))
        try {
          linkSync(temporary, file)
        } catch (error) {
          if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
        } finally {
          rmSync(temporary, { force: true })
        }
        return JSON.parse(readFileSync(file, 'utf8')) as string[]
      }
    },
    next(routes: ReadonlyArray<Route>): Route | undefined {
      while (from < routes.length) {
        const route = routes[from++]!
        try {
          mkdirSync(join(dir, encodeURIComponent(route.route)))
          return route
        } catch (error) {
          if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
        }
      }
      return undefined
    },
  }
}

/** With `own`, records are keyed by the component's own files only (`ownKeys` in walk-cache.mjs). */
export function stateCache(kind: 'shift' | 'ring', browser: Browser, { own = false } = {}) {
  const { baseURL: _baseURL, ...options } = test.info().project.use
  return walkCache({
    root: resolvePath(import.meta.dirname, '../..'),
    kind,
    own,
    runtime: { playwright: test.info().config.version, browser: browser.version(), platform: process.platform, arch: process.arch, os: release(), options },
    // Repeats are flake hunts: every repeat must exercise the state again.
    all: process.env.GALLERY_SHIFT_ALL === '1' || test.info().project.repeatEach > 1 || test.info().retry > 0,
  })
}

/** Recycle documents, not contexts: the test fixture owns exactly one context. */
export async function walkPages(context: BrowserContext) {
  let page = await context.newPage()
  let opened = 0
  return {
    page: () => page,
    next: async (): Promise<Page> => {
      if (opened === 20) {
        await page.close({ runBeforeUnload: false })
        page = await context.newPage()
        opened = 0
      }
      opened++
      // A new document resets fixture/module state, focus, selection and scroll.
      // HTTP caching remains in the context; the previous document can be collected.
      await page.goto('about:blank')
      await page.mouse.move(0, 0)
      return page
    },
  }
}
