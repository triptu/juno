import { mkdirSync } from 'node:fs'
import { tmpdir, release } from 'node:os'
import { join, resolve as resolvePath } from 'node:path'
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import type { Route } from './open-state'
import { walkCache } from './walk-cache.mjs'

export { openState, type Route, type Theme } from './open-state'

/** Opens the index once and reads every state from the page. */
export async function readRoutes(page: Page): Promise<ReadonlyArray<Route>> {
  await page.goto('/#/')
  // The gallery sets the list once its script has run, which a busy machine can delay past the load event.
  await page.waitForFunction(() => (window as unknown as { __galleryRoutes?: unknown }).__galleryRoutes !== undefined)
  const routes = await page.evaluate(() => (window as unknown as { __galleryRoutes: ReadonlyArray<Route> }).__galleryRoutes)
  expect(routes.length).toBeGreaterThan(0)
  return routes
}

/** Each test owns its browser context; parts claim work through atomic directories. */
export function claimQueue(name: string) {
  const { repeatEachIndex, retry } = test.info()
  const dir = join(tmpdir(), 'juno-gallery-shift', process.env.GALLERY_SHIFT_RUN ?? 'local', `${name}-${repeatEachIndex}-${retry}`)
  mkdirSync(dir, { recursive: true })
  let from = 0
  return {
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

export function stateCache(kind: 'shift' | 'ring', browser: Browser) {
  const { baseURL: _baseURL, ...options } = test.info().project.use
  return walkCache({
    root: resolvePath(import.meta.dirname, '../..'),
    kind,
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
