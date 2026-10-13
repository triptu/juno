import type { Page } from '@playwright/test'

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
 *    moved or resized is reported. The boxes come from `offsetLeft`,
 *    `offsetTop`, `offsetWidth` and `offsetHeight`, which ignore transforms,
 *    so the press scale (and any other transform or opacity effect) is not a
 *    shift, as it is not for the browser's own score. This catches what the
 *    score misses (small or off-screen elements) and works the same way
 *    whether or not the browser reports `layout-shift` entries.
 *
 * After the action it waits two animation frames, the longest transition or
 * animation declared under the root, and `settleMs`, then reads both.
 */
export interface LayoutShiftOptions {
  /** CSS selector of the region to snapshot. Default: the gallery's `[data-fixture-frame]`, else `body`. */
  readonly root?: string
  /** Extra milliseconds to wait after the frames and transitions. Default 0. */
  readonly settleMs?: number
  /** Smallest geometry change in px that counts. Offsets are whole pixels, so the default 0.5 means any change. */
  readonly tolerance?: number
}

interface Box {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface ShiftEntry {
  readonly value: number
  readonly hadRecentInput: boolean
  /** Milliseconds from the start of the action to the shift. */
  readonly at: number
  readonly sources: ReadonlyArray<{ readonly node: string; readonly previous: Box; readonly current: Box }>
}

export interface MovedElement {
  readonly element: string
  readonly before: Box
  readonly after: Box
}

export interface LayoutShiftReport {
  readonly shifts: ReadonlyArray<ShiftEntry>
  readonly moved: ReadonlyArray<MovedElement>
  /** False when the browser has no `layout-shift` entries; only the geometry check ran. */
  readonly observerSupported: boolean
  /** How long the helper waited after the action, in milliseconds. */
  readonly waitedMs: number
}

interface Snapshot {
  readonly el: HTMLElement
  readonly box: Box
}

interface PageState {
  entries: ShiftEntry[]
  observer: PerformanceObserver | null
  observerSupported: boolean
  startedAt: number
  root: HTMLElement
  before: Snapshot[]
  beforeDeclaredMs: number
  describe: (node: Node | null) => string
  toEntry: (entry: PerformanceEntry) => ShiftEntry
  snapshot: () => Snapshot[]
  declaredMs: () => number
}

const stateKey = '__junoLayoutShiftGuard'

const defaults = { root: '[data-fixture-frame]', settleMs: 0, tolerance: 0.5 }

/** Waits for loaded fonts and their layout to paint before starting an interaction measurement. */
export async function waitForLayoutReady(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  })
}

/** Runs `action` and returns what shifted. Use `expectNoLayoutShift` in tests. */
export async function measureLayoutShift(page: Page, action: () => Promise<unknown>, options: LayoutShiftOptions = {}): Promise<LayoutShiftReport> {
  const root = options.root ?? defaults.root
  const settleMs = options.settleMs ?? defaults.settleMs
  const tolerance = options.tolerance ?? defaults.tolerance

  await page.evaluate(
    ({ root: rootSelector, key }) => {
      const w = window as unknown as Record<string, PageState | undefined>
      w[key]?.observer?.disconnect()

      const found = document.querySelector(rootSelector)
      const rootEl = found instanceof HTMLElement ? found : document.body

      const describe = (node: Node | null): string => {
        if (!node) return '(removed element)'
        const el = node instanceof Element ? node : node.parentElement
        if (!el) return '(detached node)'
        const parts: string[] = [el.tagName.toLowerCase()]
        if (el.id) parts.push(`#${el.id}`)
        const role = el.getAttribute('role')
        if (role) parts.push(`[role=${role}]`)
        const label = el.getAttribute('aria-label') ?? el.getAttribute('title')
        if (label) parts.push(`[label="${label}"]`)
        const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
        if (text) parts.push(` "${text.length > 32 ? `${text.slice(0, 31)}…` : text}"`)
        const parent = el.parentElement
        if (parent) parts.push(` (child ${Array.prototype.indexOf.call(parent.children, el) + 1} of <${parent.tagName.toLowerCase()}>)`)
        return parts.join('')
      }

      // Layout position from the top of the page, summed up the offset parents.
      // Unlike getBoundingClientRect it ignores transforms and scrolling.
      const layoutOrigin = (el: HTMLElement): { x: number; y: number } => {
        let x = 0
        let y = 0
        for (let node: HTMLElement | null = el; node; node = node.offsetParent instanceof HTMLElement ? node.offsetParent : null) {
          x += node.offsetLeft
          y += node.offsetTop
        }
        return { x, y }
      }

      const snapshot = (): Snapshot[] => {
        const origin = layoutOrigin(rootEl)
        const html = [rootEl, ...Array.from(rootEl.querySelectorAll('*'))].filter((el): el is HTMLElement => el instanceof HTMLElement)
        return html.map((el) => {
          const at = layoutOrigin(el)
          return { el, box: { x: at.x - origin.x, y: at.y - origin.y, width: el.offsetWidth, height: el.offsetHeight } }
        })
      }

      // "0.15s, 0s" or "150ms" to a list of milliseconds.
      const milliseconds = (list: string): number[] =>
        list.split(',').map((part) => {
          const value = parseFloat(part)
          if (Number.isNaN(value)) return 0
          return part.trim().endsWith('ms') ? value : value * 1000
        })
      const declaredMs = (): number => {
        let longest = 0
        for (const el of [rootEl, ...Array.from(rootEl.querySelectorAll('*'))]) {
          const style = getComputedStyle(el)
          for (const [durations, delays] of [
            [style.transitionDuration, style.transitionDelay],
            [style.animationDuration, style.animationDelay],
          ] as const) {
            const delay = milliseconds(delays)
            milliseconds(durations).forEach((duration, index) => {
              longest = Math.max(longest, duration + (delay[index % delay.length] ?? 0))
            })
          }
        }
        return longest
      }

      const rectBox = (rect: DOMRectReadOnly): Box => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
      const startedAt = performance.now()
      const toEntry = (entry: PerformanceEntry): ShiftEntry => {
        const shift = entry as PerformanceEntry & {
          value: number
          hadRecentInput: boolean
          sources?: ReadonlyArray<{ node: Node | null; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }>
        }
        return {
          value: shift.value,
          hadRecentInput: shift.hadRecentInput,
          at: Math.round(shift.startTime - startedAt),
          sources: (shift.sources ?? []).map((source) => ({
            node: describe(source.node),
            previous: rectBox(source.previousRect),
            current: rectBox(source.currentRect),
          })),
        }
      }

      const state: PageState = {
        entries: [],
        observer: null,
        observerSupported: PerformanceObserver.supportedEntryTypes?.includes('layout-shift') ?? false,
        startedAt,
        root: rootEl,
        before: snapshot(),
        beforeDeclaredMs: declaredMs(),
        describe,
        toEntry,
        snapshot,
        declaredMs,
      }

      if (state.observerSupported) {
        state.observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) state.entries.push(state.toEntry(entry))
        })
        // No `buffered`: only shifts from here on count.
        state.observer.observe({ type: 'layout-shift' })
      }
      w[key] = state
    },
    { root, key: stateKey },
  )

  await action()

  return await page.evaluate(
    async ({ key, settle, tolerance: epsilon }) => {
      const w = window as unknown as Record<string, PageState | undefined>
      const state = w[key]
      if (!state) throw new Error('Layout-shift guard was not started')

      const frames = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      const started = performance.now()
      await frames()
      const wait = Math.max(state.beforeDeclaredMs, state.declaredMs()) + settle
      if (wait > 0) {
        await new Promise((resolve) => setTimeout(resolve, wait))
        await frames()
      }

      // Entries the browser queued but has not delivered to the callback yet.
      for (const entry of state.observer?.takeRecords() ?? []) state.entries.push(state.toEntry(entry))
      state.observer?.disconnect()

      const nowByElement = new Map(state.snapshot().map((item) => [item.el, item]))
      const moved: MovedElement[] = []
      for (const before of state.before) {
        const now = nowByElement.get(before.el)
        if (!now) continue
        const differs =
          Math.abs(before.box.x - now.box.x) > epsilon ||
          Math.abs(before.box.y - now.box.y) > epsilon ||
          Math.abs(before.box.width - now.box.width) > epsilon ||
          Math.abs(before.box.height - now.box.height) > epsilon
        if (differs) moved.push({ element: state.describe(before.el), before: before.box, after: now.box })
      }

      delete w[key]
      return {
        shifts: state.entries,
        moved,
        observerSupported: state.observerSupported,
        waitedMs: Math.round(performance.now() - started),
      } satisfies LayoutShiftReport
    },
    { key: stateKey, settle: settleMs, tolerance },
  )
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

/**
 * Runs `action` and throws if the layout shifted: any `layout-shift` entry
 * with a value above 0 (recent input or not), or any element under the root
 * whose layout box moved or resized.
 */
export async function expectNoLayoutShift(page: Page, action: () => Promise<unknown>, options: LayoutShiftOptions = {}): Promise<void> {
  const report = await measureLayoutShift(page, action, options)
  const shifted = report.shifts.some((shift) => shift.value > 0)
  if (shifted || report.moved.length > 0) {
    throw new Error(`Layout shifted during the action.\n${formatLayoutShiftReport(report)}`)
  }
}
