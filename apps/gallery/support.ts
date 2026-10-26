import { mkdirSync } from 'node:fs'
import { tmpdir, release } from 'node:os'
import { join, relative, resolve as resolvePath } from 'node:path'
import { expect, test as base, type Browser, type BrowserContext, type BrowserContextOptions, type Frame, type Page } from '@playwright/test'
import type { Route } from './open-state'
import { testCache, walkCache } from './walk-cache.mjs'

export { openState, type Route, type Theme } from './open-state'

/** What a clean shared document looks like, read once it has loaded. */
interface Baseline {
  readonly globals: ReadonlyArray<string>
  readonly body: string
  readonly styles: number
  readonly root: string
}

interface Shared {
  readonly page: Page
  readonly baseline: Baseline
}

const contextOptions = (use: BrowserContextOptions): BrowserContextOptions => {
  const { baseURL, viewport, deviceScaleFactor, colorScheme, reducedMotion } = use
  return { baseURL, viewport, deviceScaleFactor, colorScheme, reducedMotion }
}

/** These outlive the test (routes, scripts, a clock) or hide in the document (a style or script tag): a test that needs one asks for `ownPage`. */
const needOwnPage = ['route', 'routeFromHAR', 'routeWebSocket', 'addInitScript', 'addScriptTag', 'addStyleTag', 'exposeFunction', 'exposeBinding'] as const
const clockCalls = ['install', 'pauseAt', 'setFixedTime', 'setSystemTime', 'fastForward', 'runFor', 'resume'] as const

/** Loads `address` at `#/~`, which draws nothing, and records how the clean document looks. */
async function loadShared(page: Page, address: string): Promise<Shared> {
  await page.goto(`${address}#/~`)
  await page.locator('[data-gallery-blank]').waitFor({ state: 'attached' })
  await page.locator('html:not([data-theme-switching])').waitFor({ state: 'attached' })
  const baseline = await page.evaluate(() => {
    // Exposed for the leak check: this document is the one the pool loaded.
    Object.assign(window, { __gallerySharedDocument: true })
    return {
      globals: Object.keys(window),
      body: Array.from(document.body.children, (child) => `${child.tagName}#${child.id}`).join(),
      styles: document.querySelectorAll('style').length,
      root: Array.from(document.documentElement.attributes, (attribute) => `${attribute.name}=${attribute.value}`).join(),
    }
  })
  return { page, baseline }
}

/**
 * Moves the shared document back to `#/~`, checks the test left nothing behind and clears what a test may leave.
 * Returns what leaked; the worker then fails the test.
 */
async function resetShared({ page, baseline }: Shared): Promise<ReadonlyArray<string>> {
  await page.mouse.move(0, 0)
  const leaks = await page.evaluate(async (baseline) => {
    const deadline = performance.now() + 5_000
    const until = async (done: () => boolean, what: string) => {
      while (!done()) {
        if (performance.now() >= deadline) throw new Error(`The gallery did not ${what} within 5 s`)
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    }
    if (location.hash !== '#/~') location.hash = '#/~'
    // The blank page also applies the default theme, accent and density.
    await until(() => document.querySelector('[data-gallery-blank]') !== null && !document.documentElement.hasAttribute('data-theme-switching'), 'reset')
    const leaks: string[] = []
    // The fixture is gone, so focus can only be on something it left outside it.
    if (document.activeElement !== document.body && document.activeElement !== null) leaks.push(`focus on ${document.activeElement.outerHTML.slice(0, 120)}`)
    const body = Array.from(document.body.children, (child) => `${child.tagName}#${child.id}`).join()
    if (body !== baseline.body) leaks.push(`body holds ${body}, not ${baseline.body}`)
    const styles = document.querySelectorAll('style').length
    if (styles !== baseline.styles) leaks.push(`${styles - baseline.styles} style elements added`)
    const globals = Object.keys(window).filter((key) => !baseline.globals.includes(key) && key !== '__fixtureControls')
    if (globals.length > 0) leaks.push(`window globals ${globals.join(', ')}`)
    const controls = Object.keys((window as { __fixtureControls?: object }).__fixtureControls ?? {})
    if (controls.length > 0) leaks.push(`fixture controls ${controls.join(', ')}`)
    const root = Array.from(document.documentElement.attributes, (attribute) => `${attribute.name}=${attribute.value}`).join()
    if (root !== baseline.root) leaks.push(`the root element is ${root}, not ${baseline.root}`)
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    getSelection()?.removeAllRanges()
    scrollTo(0, 0)
    localStorage.clear()
    sessionStorage.clear()
    return leaks
  }, baseline)
  // A press where nothing is drawn: the next programmatic focus follows a pointer, as in a new document, not the last key.
  await page.mouse.down()
  await page.mouse.up()
  await page.evaluate(() => getSelection()?.removeAllRanges())
  return leaks
}

/**
 * Every test in a worker runs on one loaded gallery document (a page load costs about 0.45 CPU-s, opening a state in an
 * open document about 0.03). `page.goto('/#/…')` and `openState` move it by its hash. Between tests the document goes
 * back to `#/~`, which unmounts the fixture and applies the default theme; the reset then fails the test if anything
 * is left (a node outside the root, focus, a style element, a window global, a fixture control) and clears focus,
 * selection, scroll and storage. Viewport and media follow the test's options. A test that leaves the document
 * (`about:blank`, `setContent`, another address) gets the pool a new one; a failed test restarts the worker.
 *
 * `ownPageTest`, or `test.use({ ownPage: true })` in a describe, gives a test a context and page of its own, as Playwright does by default: for routes,
 * init scripts, exposed functions, a clock or injected styles, which the shared page refuses.
 * `test.use({ galleryDocument: '/?test-fixtures' })` shares a document with the gallery's own test fixtures instead.
 */
export const test = base.extend<{ ownPage: boolean; galleryDocument: string }, { galleryPool: { readonly context: BrowserContext; readonly documents: Map<string, Shared> } }>({
  ownPage: [false, { option: true }],
  galleryDocument: ['/', { option: true }],
  galleryPool: [async ({ browser }, use, workerInfo) => {
    const context = await browser.newContext(contextOptions(workerInfo.project.use))
    for (const name of clockCalls) {
      Object.assign(context.clock, { [name]: () => { throw new Error(`clock.${name} needs test.use({ ownPage: true }): a clock stays on the context`) } })
    }
    await use({ context, documents: new Map() })
    await context.close()
  }, { scope: 'worker' }],
  page: async ({ ownPage, galleryDocument, galleryPool, browser, baseURL, viewport, deviceScaleFactor, colorScheme, reducedMotion }, use) => {
    if (ownPage) {
      const context = await browser.newContext(contextOptions({ baseURL, viewport, deviceScaleFactor, colorScheme, reducedMotion }))
      await use(await context.newPage())
      await context.close()
      return
    }
    const { context, documents } = galleryPool
    let shared = documents.get(galleryDocument)
    if (shared === undefined) {
      const page = await context.newPage()
      for (const name of needOwnPage) {
        Object.assign(page, { [name]: () => { throw new Error(`page.${name} needs test.use({ ownPage: true }): the gallery page is shared by the worker's tests`) } })
      }
      shared = await loadShared(page, galleryDocument)
      documents.set(galleryDocument, shared)
    }
    const { page } = shared
    if (viewport && (page.viewportSize()?.width !== viewport.width || page.viewportSize()?.height !== viewport.height)) await page.setViewportSize(viewport)
    await page.emulateMedia({ colorScheme, reducedMotion, media: null, forcedColors: null, contrast: null })
    await use(page)
    const url = page.isClosed() ? undefined : new URL(page.url())
    const same = url !== undefined && `${url.pathname}${url.search}` === galleryDocument
      // setContent keeps the window, so the gallery's root must be there too.
      && await page.evaluate(() => '__gallerySharedDocument' in window && document.querySelector('#root > *') !== null)
    if (!same) {
      // The test left the document, or closed or reloaded it: the next test gets a new one.
      documents.delete(galleryDocument)
      if (!page.isClosed()) await page.close({ runBeforeUnload: false })
      return
    }
    const leaks = await resetShared(shared)
    if (leaks.length > 0) {
      documents.delete(galleryDocument)
      await page.close({ runBeforeUnload: false })
      throw new Error(`The test left state in the shared gallery page:\n${leaks.join('\n')}`)
    }
  },
})

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
    // Set for every run in playwright.config.ts; a full run names itself.
    source: process.env.GALLERY_RECORD_SOURCE,
    // A full run reuses unchanged states and checks this seed's sample of them again.
    sample: process.env.GALLERY_SAMPLE,
  }
}

export function stateCache(kind: 'shift' | 'computed', browser: Browser) {
  const options = cacheOptions(browser)
  if (kind === 'computed') return walkCache({ ...options, kind })
  const all = process.env.GALLERY_REAL_WALK === '1' || test.info().project.repeatEach > 1 || test.info().retry > 0
  return walkCache({ ...options, kind, all, sample: undefined })
}

/**
 * What a walk part or a cached rendering test did with its records, for the full-run record
 * (walk-reporter.mjs): `walked` had no pass to reuse, `reused` maps each source to how many
 * it skipped, `sampled` had a pass and was checked again, `missed` are sampled ones that failed.
 */
export interface WalkCounts {
  readonly kind: 'states' | 'tests'
  readonly walked: number
  readonly reused: Readonly<Record<string, number>>
  readonly sampled: number
  readonly missed: ReadonlyArray<string>
}
export const noteWalk = (counts: WalkCounts) => test.info().annotations.push({ type: 'gallery-walk', description: JSON.stringify(counts) })

/** The failure a sampled record adds: the same key, a different result. */
export const keyMissed = (from: string) => `It passed before with the same walk-cache key (${from}), so the key missed an input; see apps/gallery/walk-cache.mjs`

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
 * a full run's sample (`GALLERY_SAMPLE`) runs it again, and `GALLERY_SHIFT_ALL=1`
 * (a full run's weekly uncached walk, or `--no-cache`), repeats and retries run it.
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
      const reuse = cache.reuse(file, title)
      if (reuse && !reuse.sampled) {
        noteWalk({ kind: 'tests', walked: 0, reused: { [reuse.from]: 1 }, sampled: 0, missed: [] })
        info.skip(true, 'Unchanged since it passed')
      }
      cache.forget(file, title)
      const opened = new Set<string>()
      await use(opened)
      if (info.status === 'passed' && opened.size > 0) cache.pass(file, title, opened)
      const missed = reuse !== undefined && !['passed', 'skipped'].includes(info.status ?? 'passed')
      noteWalk({ kind: 'tests', walked: reuse ? 0 : 1, reused: {}, sampled: reuse ? 1 : 0, missed: missed ? [`${file}: ${title}`] : [] })
      if (missed) throw new Error(keyMissed(reuse.from))
    }, { auto: true }],
    page: async ({ page, renderedComponents }, use) => {
      const opened = (frame: Frame) => {
        const component = frame === page.mainFrame() ? openedComponent(frame.url()) : undefined
        if (component !== undefined) renderedComponents.add(component)
      }
      page.on('framenavigated', opened)
      await use(page)
      page.off('framenavigated', opened)
      // Every state is opened by a navigation; a missed one would leave a component out of the record.
      const last = openedComponent(page.url())
      if (last !== undefined && !renderedComponents.has(last)) throw new Error(`The cache missed ${last}`)
    },
  })
}
export const layoutTest = renderingTest('layout')
export const paintTest = renderingTest('paint')

/** For a test that needs a context and page of its own (see `test`). */
export const ownPageTest = test.extend({ ownPage: true })
