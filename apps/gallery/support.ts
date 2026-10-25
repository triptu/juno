import { mkdirSync } from 'node:fs'
import { tmpdir, release } from 'node:os'
import { join, relative, resolve as resolvePath } from 'node:path'
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import type { Route } from './open-state'
import { testCache, walkCache } from './walk-cache.mjs'

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

const root = resolvePath(import.meta.dirname, '../..')
function cacheOptions(browser: Browser) {
  const { baseURL: _baseURL, ...options } = test.info().project.use
  return {
    root,
    runtime: { playwright: test.info().config.version, browser: browser.version(), platform: process.platform, arch: process.arch, os: release(), options },
    // Repeats are flake hunts: every repeat must exercise the state again.
    all: process.env.GALLERY_SHIFT_ALL === '1' || test.info().project.repeatEach > 1 || test.info().retry > 0,
  }
}

export function stateCache(kind: 'shift' | 'ring', browser: Browser) {
  return walkCache({ ...cacheOptions(browser), kind })
}

/**
 * The component a gallery address opens: `#index` for the list of states, `*`
 * (all source) for anything else. `?test-fixtures` states are not registered
 * in a package, so they key on all source too.
 */
function openedComponent(url: string): string | undefined {
  if (url === 'about:blank') return undefined
  const { hash, search } = new URL(url)
  const name = /^#\/([^?]*)/.exec(hash)?.[1]
  if (search !== '' || name === undefined) return '*'
  // `#/~` draws no frame: openState passes through it to open a state again.
  return name === '~' ? undefined : name === '' ? '#index' : decodeURIComponent(name)
}

const renderingCaches = new Map<string, ReturnType<typeof testCache>>()
/**
 * A test that only reads what states draw (boxes, or with `paint` also colours),
 * so it is a pure function of the components it opens. It is skipped while those
 * components, its spec and the runtime are unchanged since it last passed;
 * `GALLERY_SHIFT_ALL=1` (nightly and no-cache runs), repeats and retries run it.
 * Never use it for interaction timing, motion or a delayed load.
 */
function renderingTest(kind: 'layout' | 'paint') {
  return test.extend<{ renderedComponents: Set<string> }>({
    renderedComponents: [async ({ browser }, use, info) => {
      const key = `${kind} ${browser.version()}`
      if (!renderingCaches.has(key)) renderingCaches.set(key, testCache({ ...cacheOptions(browser), kind }))
      const cache = renderingCaches.get(key)!
      const file = relative(root, info.file)
      const title = info.titlePath.slice(1).join(' › ')
      if (cache.passed(file, title)) info.skip(true, 'Unchanged since it passed')
      cache.forget(file, title)
      const opened = new Set<string>()
      await use(opened)
      if (info.status === 'passed' && opened.size > 0) cache.pass(file, title, opened)
    }, { auto: true }],
    page: async ({ page, renderedComponents }, use) => {
      page.on('framenavigated', (frame) => {
        const component = frame === page.mainFrame() ? openedComponent(frame.url()) : undefined
        if (component !== undefined) renderedComponents.add(component)
      })
      await use(page)
      // Every state is opened by a navigation; a missed one would leave a component out of the record.
      const last = openedComponent(page.url())
      if (last !== undefined && !renderedComponents.has(last)) throw new Error(`The cache missed ${last}`)
    },
  })
}
export const layoutTest = renderingTest('layout')
export const paintTest = renderingTest('paint')

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
