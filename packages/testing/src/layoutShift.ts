import type { Page } from '@playwright/test'
import { withHelpers, type Box, type Helpers, type MovedElement, type ShiftEntry, type Snapshot } from './inPage'

export type { MovedElement, ShiftEntry } from './inPage'

/**
 * A layout-shift guard for Playwright tests.
 *
 *   await expectNoLayoutShift(page, () => button.hover())
 *
 * It watches the page while `action` runs and fails, with a readable report,
 * if anything moved or changed size. Two independent checks run together:
 *
 * 1. A `PerformanceObserver` for `layout-shift` entries, started just before
 *    the action (nothing buffered from earlier). Entries with
 *    `hadRecentInput` are kept: Chromium sets that flag on every shift within
 *    500 ms of a keypress or pointer press. Hovering alone need not set it.
 *    The usual "ignore recent input" filter would hide shifts caused by
 *    pressing a control.
 * 2. A geometry fallback. The layout box of every HTML element under the root
 *    is taken before and after, relative to the root, and any element that
 *    moved or resized is reported. An element added or removed, or one that
 *    starts or stops being rendered (`display: none`), has no box on one
 *    side and is not compared, as the browser's score does not count it;
 *    anything it pushes is still reported. The boxes come from `offsetLeft`,
 *    `offsetTop`, `offsetWidth` and `offsetHeight`, which ignore transforms,
 *    so the press scale (and any other transform or opacity effect) is not a
 *    shift, as it is not for the browser's own score. This catches what the
 *    score misses (small or off-screen elements) and works the same way
 *    whether or not the browser reports `layout-shift` entries.
 *
 * After the action it waits two animation frames, then until every
 * transition or animation running under the root has finished (one iteration
 * of an endless one the action started), then `settleMs`, then reads both.
 * Motion that is declared but not running, or endless and running before the
 * action, was not started by it, so it is not waited for. With
 * `motion: 'layout'` it waits only for motion of a property that can move a
 * box: a colour, opacity, shadow, filter or transform fading cannot, so it is
 * not waited for.
 *
 * A `<video>`'s own controls are not the page's layout: a shift source with
 * no node (it is in the video's shadow root) that stays inside a video's box
 * is dropped, and an entry with only such sources counts as no shift. Chromium
 * may also report the controls' shift with no sources at all (a video whose
 * source failed, as the gallery's do), so while a video with controls is under
 * the root, or was when the action started (the action may remove it), an
 * entry with no sources counts as no shift. The geometry check still compares
 * every page element.
 */
export interface LayoutShiftOptions {
  /** CSS selector of the region to snapshot. Default: the gallery's `[data-fixture-frame]`, else `body`. */
  readonly root?: string
  /** Extra milliseconds to wait after the frames and transitions. Default 0. */
  readonly settleMs?: number
  /** Smallest geometry change in px that counts. Offsets are whole pixels, so the default 0.5 means any change. */
  readonly tolerance?: number
  /**
   * Which running motion to wait out. `all` (default): every transition and animation.
   * `layout`: only those of a property that can move a box, so a hover's colour fade or a
   * press scale is not waited for. Use it where nothing else (data, timers) lands while the
   * motion runs, as in the gallery's fixtures.
   */
  readonly motion?: 'all' | 'layout'
  /**
   * CSS selector of elements that may take room a neighbour left or need: their
   * width may change while their left, top and height stay (a sidebar row's
   * preview running to the line's end once its count goes). Anything else they
   * push is still reported.
   */
  readonly grows?: string
}

export interface LayoutShiftReport {
  readonly shifts: ReadonlyArray<ShiftEntry>
  readonly moved: ReadonlyArray<MovedElement>
  /** False when the browser has no `layout-shift` entries; only the geometry check ran. */
  readonly observerSupported: boolean
  /** How long the helper waited after the action, in milliseconds. */
  readonly waitedMs: number
}

interface PageState {
  entries: ShiftEntry[]
  observer: PerformanceObserver | null
  observerSupported: boolean
  root: HTMLElement
  /** Disconnects the observers. */
  close: () => void
  before: Snapshot
  /** Starts the next window: the boxes, motion and video seen now are what the next action is measured from. */
  baseline: (boxes: Snapshot) => void
  toEntry: (entry: PerformanceEntry) => ShiftEntry
  snapshot: () => Snapshot
  /** Elements whose box moved or resized between two snapshots, by the watch's tolerance and `grows`. */
  compare: (before: Snapshot, after: Snapshot) => MovedElement[]
  runningMs: (endless: boolean, layoutOnly: boolean) => number
}

const stateKey = '__junoLayoutShiftGuard'

const defaults = { root: '[data-fixture-frame]', settleMs: 0, tolerance: 0.5, motion: 'all' }

/** Waits for loaded fonts and their layout to paint before starting an interaction measurement. */
export async function waitForLayoutReady(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  })
}

export interface LayoutShiftCheckOptions {
  /**
   * CSS selector of a marker for code still loading (the gallery's `[data-chunk-pending]`). The check
   * first waits, up to 15 s, until none is left, so what the loaded code draws is measured too.
   */
  readonly pending?: string
}

/**
 * Several actions measured one after another, each as `measureLayoutShift` measures one. The observer
 * stays connected and each check's last box snapshot is the next one's first, so a sequence of N actions
 * takes N + 1 snapshots and N + 1 round trips to the page besides the actions, not 2N and 3N. Anything
 * that moves between two checks is charged to the second.
 */
export interface LayoutShiftWatch {
  /** Runs `action`, waits for it to settle and reports what shifted since the previous check, or since the watch started. */
  readonly check: (action: () => Promise<unknown>, options?: LayoutShiftCheckOptions) => Promise<LayoutShiftReport>
  /** Measures the next check from now: what moved since the last check (a scroll that settled) is not charged to it. */
  readonly rebase: () => Promise<void>
  /** Stops the observer. A new watch, or `measureLayoutShift`, also replaces this one. */
  readonly stop: () => Promise<void>
}

// The two functions below run in the page, through `toString()`: each uses nothing outside its own body.

/** Starts a watch in the page: one observer, and the boxes, motion and video seen now as the first baseline. */
function startWatch({ root: rootSelector, key, tolerance: epsilon, grows: growsSelector }: { root: string; key: string; tolerance: number; grows: string | null }, helpers: Helpers): void {
  const w = window as unknown as Record<string, PageState | undefined>
  w[key]?.close()

  const found = document.querySelector(rootSelector)
  const rootEl = found instanceof HTMLElement ? found : document.body
  const reader = helpers.boxReader(rootEl)
  const snapshot = reader.read

  const state: PageState = {
    entries: [],
    observer: null,
    observerSupported: PerformanceObserver.supportedEntryTypes?.includes('layout-shift') ?? false,
    root: rootEl,
    close: () => {
      state.observer?.disconnect()
      reader.close()
    },
    before: { elements: [], boxes: new Float64Array(0), rendered: new Uint8Array(0) },
    baseline: (boxes) => {
      state.before = boxes
      state.entries = []
      state.runningMs = helpers.motionClock(rootEl)
      state.toEntry = helpers.shiftEntries(rootEl, performance.now(), helpers.describeNode)
    },
    toEntry: () => { throw new Error('Layout-shift guard has no baseline') },
    snapshot,
    compare: (before, after) => helpers.changedBoxes(before, after, epsilon, growsSelector, helpers.describeNode),
    runningMs: () => 0,
  }
  state.baseline(snapshot())

  if (state.observerSupported) {
    state.observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) state.entries.push(state.toEntry(entry))
    })
    // No `buffered`: only shifts from here on count.
    state.observer.observe({ type: 'layout-shift' })
  }
  w[key] = state
}

/**
 * After an action: waits for pending code, two frames and the motion, then reports what shifted since the baseline
 * and makes now the next baseline. The helpers come through the closures the watch made when it started.
 */
async function settleAndCompare({ key, settle, layoutOnly, pending }: { key: string; settle: number; layoutOnly: boolean; pending: string | null }): Promise<LayoutShiftReport> {
  const state = (window as unknown as Record<string, PageState | undefined>)[key]
  if (!state) throw new Error('Layout-shift guard was not started, or another watch replaced it')

  const started = performance.now()
  if (pending !== null && document.querySelector(pending) !== null) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        observer.disconnect()
        reject(new Error('Code a touch started loading did not load within 15 s'))
      }, 15_000)
      const observer = new MutationObserver(() => {
        if (document.querySelector(pending) !== null) return
        clearTimeout(timer)
        observer.disconnect()
        resolve()
      })
      observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true })
    })
  }
  const frames = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  await frames()
  // A transition can start another when it ends, so look again after each wait.
  for (let round = 0; round < 4; round++) {
    const wait = state.runningMs(round === 0, layoutOnly)
    if (wait <= 0) break
    await new Promise((resolve) => setTimeout(resolve, wait))
    await frames()
  }
  if (settle > 0) {
    await new Promise((resolve) => setTimeout(resolve, settle))
    await frames()
  }

  // Entries the browser queued but has not delivered to the callback yet.
  for (const entry of state.observer?.takeRecords() ?? []) state.entries.push(state.toEntry(entry))
  const shifts = state.entries
  const after = state.snapshot()
  const moved = state.compare(state.before, after)
  state.baseline(after)
  return { shifts, moved, observerSupported: state.observerSupported, waitedMs: Math.round(performance.now() - started) }
}

/** Starts watching the page: the next `check` measures from now. */
export async function watchLayoutShift(page: Page, options: LayoutShiftOptions = {}): Promise<LayoutShiftWatch> {
  const settle = options.settleMs ?? defaults.settleMs
  const layoutOnly = (options.motion ?? defaults.motion) === 'layout'
  await withHelpers(page, startWatch, { root: options.root ?? defaults.root, key: stateKey, tolerance: options.tolerance ?? defaults.tolerance, grows: options.grows ?? null })

  const check = async (action: () => Promise<unknown>, { pending }: LayoutShiftCheckOptions = {}): Promise<LayoutShiftReport> => {
    await action()
    return await page.evaluate(settleAndCompare, { key: stateKey, settle, layoutOnly, pending: pending ?? null })
  }

  const rebase = () => page.evaluate((key) => {
    const state = (window as unknown as Record<string, PageState | undefined>)[key]
    if (!state) throw new Error('Layout-shift guard was not started, or another watch replaced it')
    state.observer?.takeRecords()
    state.baseline(state.snapshot())
  }, stateKey)

  const stop = () => page.evaluate((key) => {
    const w = window as unknown as Record<string, PageState | undefined>
    w[key]?.close()
    delete w[key]
  }, stateKey)

  return { check, rebase, stop }
}

/** Runs `action` and returns what shifted. Use `expectNoLayoutShift` in tests. */
export async function measureLayoutShift(page: Page, action: () => Promise<unknown>, options: LayoutShiftOptions = {}): Promise<LayoutShiftReport> {
  const watch = await watchLayoutShift(page, options)
  try {
    return await watch.check(action)
  } finally {
    await watch.stop()
  }
}

const round = (n: number): string => String(Math.round(n * 100) / 100)
const fmt = (box: Box): string => `(${round(box.x)}, ${round(box.y)}) ${round(box.width)}x${round(box.height)}`
const delta = (from: Box, to: Box): string =>
  `dx ${round(to.x - from.x)}, dy ${round(to.y - from.y)}, dw ${round(to.width - from.width)}, dh ${round(to.height - from.height)}`

/** A readable account of every shift: the node, the delta and the browser's score. */
export function formatLayoutShiftReport(report: LayoutShiftReport): string {
  const lines: string[] = []
  for (const shift of report.shifts.filter((entry) => entry.value > 0)) {
    lines.push(`layout-shift value ${round(shift.value)} at +${shift.at}ms${shift.hadRecentInput ? ' (hadRecentInput, counted anyway)' : ''}`)
    for (const source of shift.sources) {
      lines.push(`  ${source.node}`)
      lines.push(`    ${fmt(source.previous)} -> ${fmt(source.current)} (${delta(source.previous, source.current)})`)
    }
  }
  if (report.moved.length > 0) {
    lines.push(`layout box changed on ${report.moved.length} element(s), relative to the frame:`)
    for (const item of report.moved.slice(0, 12)) {
      lines.push(`  ${item.element}`)
      lines.push(`    ${fmt(item.before)} -> ${fmt(item.after)} (${delta(item.before, item.after)})`)
    }
    if (report.moved.length > 12) lines.push(`  ... and ${report.moved.length - 12} more`)
  }
  return lines.join('\n')
}

/** The guard's failure for a report, or undefined when nothing shifted. */
export function layoutShiftError(report: LayoutShiftReport): Error | undefined {
  const shifted = report.shifts.some((shift) => shift.value > 0)
  if (!shifted && report.moved.length === 0) return undefined
  return new Error(`Layout shifted during the action.\n${formatLayoutShiftReport(report)}`)
}

/**
 * Runs `action` and throws if the layout shifted: any `layout-shift` entry
 * with a value above 0 (recent input or not), or any element under the root
 * whose layout box moved or resized.
 */
export async function expectNoLayoutShift(page: Page, action: () => Promise<unknown>, options: LayoutShiftOptions = {}): Promise<void> {
  const error = layoutShiftError(await measureLayoutShift(page, action, options))
  if (error) throw error
}
