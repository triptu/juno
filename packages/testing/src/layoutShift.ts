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
  /** False when the element has no layout box (`display: none`, or inside such an element). */
  readonly rendered: boolean
}

interface PageState {
  entries: ShiftEntry[]
  observer: PerformanceObserver | null
  observerSupported: boolean
  startedAt: number
  root: HTMLElement
  before: Snapshot[]
  describe: (node: Node | null) => string
  toEntry: (entry: PerformanceEntry) => ShiftEntry
  snapshot: () => Snapshot[]
  runningMs: (endless: boolean, layoutOnly: boolean) => number
}

const stateKey = '__junoLayoutShiftGuard'

const defaults = { root: '[data-fixture-frame]', settleMs: 0, tolerance: 0.5, motion: 'all' }

// The in-page helpers below are shared by the guard and `checkForcedInteractions`, so both judge a shift the same way.
// They reach the page through `toString()`, so each must use nothing outside its own body.

/** A readable name for an element: tag, id, role, label, text and place among its siblings. */
function describeNode(node: Node | null): string {
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

/** The layout box of every HTML element under the root, relative to the root. */
function layoutBoxes(rootEl: HTMLElement): Snapshot[] {
  // Many elements share an offset parent. Read each ancestor once per snapshot;
  // the page cannot change during this synchronous walk.
  const origins = new Map<HTMLElement, { x: number; y: number }>()
  const layoutOrigin = (el: HTMLElement): { x: number; y: number } => {
    const saved = origins.get(el)
    if (saved) return saved
    const parent = el.offsetParent
    const at = parent instanceof HTMLElement ? layoutOrigin(parent) : { x: 0, y: 0 }
    const origin = { x: at.x + el.offsetLeft, y: at.y + el.offsetTop }
    origins.set(el, origin)
    return origin
  }
  const origin = layoutOrigin(rootEl)
  const html = [rootEl, ...Array.from(rootEl.querySelectorAll('*'))].filter((el): el is HTMLElement => el instanceof HTMLElement)
  return html.map((el) => {
    const at = layoutOrigin(el)
    return { el, box: { x: at.x - origin.x, y: at.y - origin.y, width: el.offsetWidth, height: el.offsetHeight }, rendered: el.getClientRects().length > 0 }
  })
}

/** Elements rendered in both snapshots whose box moved or resized by more than `epsilon`; `grows` elements may change width. */
function changedBoxes(before: ReadonlyArray<Snapshot>, after: ReadonlyArray<Snapshot>, epsilon: number, grows: string | null, describe: (node: Node | null) => string): MovedElement[] {
  const nowByElement = new Map(after.map((item) => [item.el, item]))
  const moved: MovedElement[] = []
  for (const was of before) {
    const now = nowByElement.get(was.el)
    if (!now || !was.rendered || !now.rendered) continue
    const resized = Math.abs(was.box.width - now.box.width) > epsilon && (grows === null || !was.el.matches(grows))
    const differs =
      Math.abs(was.box.x - now.box.x) > epsilon ||
      Math.abs(was.box.y - now.box.y) > epsilon ||
      resized ||
      Math.abs(was.box.height - now.box.height) > epsilon
    if (differs) moved.push({ element: describe(was.el), before: was.box, after: now.box })
  }
  return moved
}

interface Helpers {
  readonly describeNode: typeof describeNode
  readonly layoutBoxes: typeof layoutBoxes
  readonly changedBoxes: typeof changedBoxes
}

const helperSource = `{ describeNode: ${describeNode.toString()}, layoutBoxes: ${layoutBoxes.toString()}, changedBoxes: ${changedBoxes.toString()} }`

/** Runs `fn(arg, helpers)` in the page. `arg` must be JSON. */
const withHelpers = <A, R>(page: Page, fn: (arg: A, helpers: Helpers) => R, arg: A): Promise<Awaited<R>> =>
  page.evaluate(`(${fn.toString()})(${JSON.stringify(arg)}, ${helperSource})`) as Promise<Awaited<R>>

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
  const layoutOnly = (options.motion ?? defaults.motion) === 'layout'
  const grows = options.grows ?? null

  await withHelpers(
    page,
    ({ root: rootSelector, key }: { root: string; key: string }, helpers) => {
      const w = window as unknown as Record<string, PageState | undefined>
      w[key]?.observer?.disconnect()

      const found = document.querySelector(rootSelector)
      const rootEl = found instanceof HTMLElement ? found : document.body

      const describe = helpers.describeNode
      const snapshot = () => helpers.layoutBoxes(rootEl)

      const earlier = new Set(rootEl.getAnimations({ subtree: true }))
      // Properties whose motion repaints but moves no layout box (offsets ignore transforms).
      const paintOnly = new Set([
        'color',
        'background-color',
        'background-position',
        'border-color',
        'border-top-color',
        'border-right-color',
        'border-bottom-color',
        'border-left-color',
        'outline-color',
        'outline-width',
        'outline-offset',
        'text-decoration-color',
        'caret-color',
        'fill',
        'stroke',
        'opacity',
        'visibility',
        'box-shadow',
        'text-shadow',
        'filter',
        'backdrop-filter',
        'transform',
        'translate',
        'scale',
        'rotate',
      ])
      const kebab = (name: string) => (name.startsWith('--') ? name : name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`))
      // True when the motion animates a property that can move a box, or its properties cannot be read.
      const movesBoxes = (animation: Animation): boolean => {
        const transition = (animation as Animation & { transitionProperty?: string }).transitionProperty
        if (typeof transition === 'string') return !paintOnly.has(transition)
        if (!(animation.effect instanceof KeyframeEffect)) return true
        const keys = animation.effect.getKeyframes().flatMap((frame) => Object.keys(frame))
        return keys.some((property) => !['offset', 'computedOffset', 'easing', 'composite'].includes(property) && !paintOnly.has(kebab(property)))
      }
      // How long until the motion running under the root ends: what is left of
      // each finite transition or animation, and, when `endless` is set, one
      // iteration of an endless one the action started. With `boxesOnly`,
      // only motion that can move a box counts.
      const runningMs = (endless: boolean, boxesOnly: boolean): number => {
        let longest = 0
        for (const animation of rootEl.getAnimations({ subtree: true })) {
          if (animation.playState !== 'running') continue
          if (boxesOnly && !movesBoxes(animation)) continue
          const timing = animation.effect?.getComputedTiming()
          if (!timing) continue
          const end = Number(timing.endTime)
          if (!Number.isFinite(end) && (!endless || earlier.has(animation))) continue
          const left = Number.isFinite(end) ? end - Number(timing.localTime ?? 0) : Number(timing.delay ?? 0) + Number(timing.duration ?? 0)
          longest = Math.max(longest, left / Math.abs(animation.playbackRate || 1))
        }
        return longest
      }

      // Noted now: the action may remove the video before its entry is read.
      const hadVideo = rootEl.querySelector('video[controls]') !== null
      const rectBox = (rect: DOMRectReadOnly): Box => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
      const startedAt = performance.now()
      const toEntry = (entry: PerformanceEntry): ShiftEntry => {
        const shift = entry as PerformanceEntry & {
          value: number
          hadRecentInput: boolean
          sources?: ReadonlyArray<{ node: Node | null; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }>
        }
        // A video's own controls live in its shadow root, so their sources have no node; they move inside the video's box
        // as the controls show and hide, which moves nothing of the page. Only those sources are dropped.
        const videos = Array.from(document.querySelectorAll('video'), (video) => video.getBoundingClientRect())
        const inside = (outer: DOMRect, inner: DOMRectReadOnly) =>
          inner.left >= outer.left - 0.5 && inner.right <= outer.right + 0.5 && inner.top >= outer.top - 0.5 && inner.bottom <= outer.bottom + 0.5
        const inControls = (source: { node: Node | null; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }) =>
          source.node === null && videos.some((box) => inside(box, source.previousRect) && inside(box, source.currentRect))
        const all = shift.sources ?? []
        const kept = all.filter((source) => !inControls(source))
        const unattributed = all.length === 0 && (hadVideo || rootEl.querySelector('video[controls]') !== null)
        return {
          value: (all.length > 0 && kept.length === 0) || unattributed ? 0 : shift.value,
          hadRecentInput: shift.hadRecentInput,
          at: Math.round(shift.startTime - startedAt),
          sources: kept.map((source) => ({
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
        describe,
        toEntry,
        snapshot,
        runningMs,
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

  return await withHelpers(
    page,
    async (
      { key, settle, tolerance: epsilon, layoutOnly: onlyLayout, grows: growsSelector }: { key: string; settle: number; tolerance: number; layoutOnly: boolean; grows: string | null },
      helpers,
    ) => {
      const w = window as unknown as Record<string, PageState | undefined>
      const state = w[key]
      if (!state) throw new Error('Layout-shift guard was not started')

      const frames = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      const started = performance.now()
      await frames()
      // A transition can start another when it ends, so look again after each wait.
      for (let round = 0; round < 4; round++) {
        const wait = state.runningMs(round === 0, onlyLayout)
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
      state.observer?.disconnect()

      const moved = helpers.changedBoxes(state.before, state.snapshot(), epsilon, growsSelector, state.describe)

      delete w[key]
      return {
        shifts: state.entries,
        moved,
        observerSupported: state.observerSupported,
        waitedMs: Math.round(performance.now() - started),
      } satisfies LayoutShiftReport
    },
    { key: stateKey, settle: settleMs, tolerance, layoutOnly, grows },
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

export interface ForcedInteractionOptions {
  /** CSS selector of the region to check. Default: the gallery's `[data-fixture-frame]`, else `body`. */
  readonly root?: string
  /** CSS selector of the elements to touch. */
  readonly targets: string
  /** Elements inside a match of this selector are not touched (growth the user asks for). */
  readonly skipWithin?: string
  /** Elements touched at most; a longer list is sampled from both ends. Default 16. */
  readonly max?: number
  /** Index in that list to start at, after `next` asked for a fresh document. */
  readonly from?: number
  /** Marks code still loading after a touch; the check waits until none is left. */
  readonly pending?: string
  readonly tolerance?: number
  readonly grows?: string
}

export interface ForcedShift {
  /** Index of the touched element in the sampled list. */
  readonly element: number
  readonly target: string
  readonly step: string
  readonly moved: ReadonlyArray<MovedElement>
}

export interface ForcedInteractionReport {
  readonly shifts: ReadonlyArray<ForcedShift>
  /** Elements touched in this call. */
  readonly touched: number
  /** Set when a touch changed the markup and elements are left: open the state again and call with `from: next`. */
  readonly next?: number
  /** Pseudo-class rules that could not be rewritten, for the log. */
  readonly unforced: number
}

/**
 * The cheap tier of the guard: every touch of `measureLayoutShift`, without
 * real input or animation frames, in one `page.evaluate`.
 *
 * It rewrites `:hover`, `:active`, `:focus`, `:focus-visible` and
 * `:focus-within` in every loaded style sheet into attribute selectors of the
 * same specificity, turns transitions off and finishes any animation a touch
 * starts. For each target it then hovers, focuses from the keyboard, blurs,
 * presses, releases and leaves: it sets the attributes where the browser would
 * match the pseudo-class (the element under the target's centre and its
 * ancestors for hover and press, the active element and its ancestors for
 * focus) and dispatches the pointer, mouse, key and focus events React
 * listens to, then waits two tasks so React renders. After each step it compares
 * every box with `changedBoxes`, the guard's own comparison.
 *
 * What it cannot see: a shift that exists only while a transition runs, one
 * that waits for an animation frame or a ResizeObserver, and browser defaults
 * of real input other than focus on press (text selection, `:active` from a
 * keyboard press). The real-input walk covers those.
 */
export async function checkForcedInteractions(page: Page, options: ForcedInteractionOptions): Promise<ForcedInteractionReport> {
  return await withHelpers(
    page,
    async (
      arg: { root: string; targets: string; skipWithin: string | null; max: number; from: number; pending: string | null; tolerance: number; grows: string | null },
      helpers,
    ) => {
      const found = document.querySelector(arg.root)
      const rootEl = found instanceof HTMLElement ? found : document.body
      const names = { hover: 'data-juno-hover', active: 'data-juno-active', focus: 'data-juno-focus', 'focus-visible': 'data-juno-focus-visible', 'focus-within': 'data-juno-focus-within' }
      const pseudo = /:(hover|active|focus-visible|focus-within|focus)(?![\w-])/g
      let unforced = 0
      const rewrite = (rules: CSSRuleList) => {
        for (const rule of Array.from(rules)) {
          if (rule instanceof CSSStyleRule && rule.selectorText.search(pseudo) !== -1) {
            rule.selectorText = rule.selectorText.replace(pseudo, (_, name: keyof typeof names) => `[${names[name]}]`)
            // A pseudo-element before the pseudo-class (a scrollbar thumb's :hover) cannot take an attribute.
            if (rule.selectorText.search(pseudo) !== -1) unforced++
          }
          if ('cssRules' in rule) rewrite((rule as CSSGroupingRule).cssRules)
        }
      }
      const rewriteSheets = () => {
        for (const sheet of [...Array.from(document.styleSheets), ...document.adoptedStyleSheets]) {
          try {
            rewrite(sheet.cssRules)
          } catch {
            // A cross-origin sheet cannot be read; the gallery has none.
          }
        }
      }
      if (!document.getElementById('juno-forced-still')) {
        rewriteSheets()
        const still = document.createElement('style')
        still.id = 'juno-forced-still'
        still.textContent = '*, *::before, *::after { transition: none !important; }'
        document.head.append(still)
        // Like a real click, a synthetic one follows a link or submits a form. Neither belongs to this document's check.
        window.addEventListener('click', (event) => {
          const target = event.target instanceof Element ? event.target : null
          if (target?.closest('a[href], form button:not([type="button"]), form input[type="submit"]')) event.preventDefault()
        })
      }

      const chain = (el: Element): Element[] => {
        const out: Element[] = []
        for (let node: Element | null = el; node; node = node.parentElement) out.push(node)
        return out
      }
      const clear = (name: string) => {
        for (const el of Array.from(document.querySelectorAll(`[${name}]`))) el.removeAttribute(name)
      }
      let keyboard = false
      const syncFocus = () => {
        for (const name of [names.focus, names['focus-visible'], names['focus-within']]) clear(name)
        const active = document.activeElement
        if (!active || active === document.body) return
        active.setAttribute(names.focus, '')
        const field = active.matches('input:not([type="checkbox"], [type="radio"], [type="button"], [type="submit"], [type="reset"], [type="range"], [type="color"]), textarea, [contenteditable]:not([contenteditable="false"])')
        if (keyboard || field) active.setAttribute(names['focus-visible'], '')
        for (const el of chain(active)) el.setAttribute(names['focus-within'], '')
      }

      const task = () => new Promise<void>((resolve) => {
        const channel = new MessageChannel()
        channel.port1.onmessage = () => resolve()
        channel.port2.postMessage(0)
      })
      const earlier = new Set(document.getAnimations())
      const settle = async () => {
        // React renders a continuous event's update in a scheduler task, and an effect's update in the next.
        await task()
        await task()
        if (arg.pending !== null && document.querySelector(arg.pending) !== null) {
          const selector = arg.pending
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
              observer.disconnect()
              reject(new Error('Code a touch started loading did not arrive within 15 s'))
            }, 15_000)
            const observer = new MutationObserver(() => {
              if (document.querySelector(selector) !== null) return
              clearTimeout(timer)
              observer.disconnect()
              resolve()
            })
            observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true })
          })
          rewriteSheets()
          await task()
          await task()
        }
        for (const animation of document.getAnimations()) {
          if (earlier.has(animation) || !Number.isFinite(Number(animation.effect?.getComputedTiming().endTime))) continue
          try {
            animation.finish()
          } catch {
            // An animation that cannot finish (playback rate 0) moves nothing either.
          }
        }
        syncFocus()
      }

      const at = (x: number, y: number) => ({ bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true, relatedTarget: null })
      const fire = (type: string, target: Element, init: ReturnType<typeof at> & { buttons?: number; bubbles?: boolean }) => {
        const event = type.startsWith('pointer') ? new PointerEvent(type, init) : new MouseEvent(type, init)
        return target.dispatchEvent(event)
      }
      const focusable = 'button, a[href], input, select, textarea, [tabindex], [contenteditable]:not([contenteditable="false"])'

      const sample = Array.from(rootEl.querySelectorAll(arg.targets)).filter(
        (el): el is HTMLElement => el instanceof HTMLElement && (arg.skipWithin === null || el.parentElement?.closest(arg.skipWithin) == null),
      )
      const tail = Math.floor(arg.max / 3)
      const picked = sample.length <= arg.max ? sample : [...sample.slice(0, arg.max - tail), ...sample.slice(-tail)]
      const markup = () => rootEl.innerHTML.replace(/ data-juno-[a-z-]+=""/g, '')
      const initial = markup()
      const shifts: Array<{ element: number; target: string; step: string; moved: unknown[] }> = []
      let touched = 0
      let boxes = helpers.layoutBoxes(rootEl)

      for (let index = arg.from; index < picked.length; index++) {
        const element = picked[index]!
        if (!element.isConnected || element.getClientRects().length === 0 || getComputedStyle(element).visibility === 'hidden') continue
        const was = element.getBoundingClientRect()
        element.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        const box = element.getBoundingClientRect()
        if (box.x !== was.x || box.y !== was.y) {
          // Scrolling can lay out content-visibility rows; that is not the touch's doing.
          await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
          boxes = helpers.layoutBoxes(rootEl)
        }
        touched++
        const x = box.x + box.width / 2
        const y = box.y + box.height / 2
        const hit = document.elementFromPoint(x, y) ?? element
        const hovered = chain(hit)
        const target = helpers.describeNode(element)
        const step = async (name: string, action: () => void) => {
          action()
          await settle()
          const now = helpers.layoutBoxes(rootEl)
          const moved = helpers.changedBoxes(boxes, now, arg.tolerance, arg.grows, helpers.describeNode)
          if (moved.length > 0) shifts.push({ element: index, target, step: name, moved })
          boxes = now
        }

        await step('hover', () => {
          fire('pointerover', hit, at(x, y))
          for (const el of [...hovered].reverse()) fire('pointerenter', el, { ...at(x, y), bubbles: false })
          fire('mouseover', hit, at(x, y))
          for (const el of [...hovered].reverse()) fire('mouseenter', el, { ...at(x, y), bubbles: false })
          fire('pointermove', hit, at(x, y))
          fire('mousemove', hit, at(x, y))
          for (const el of hovered) el.setAttribute(names.hover, '')
        })
        await step('focus from the keyboard', () => {
          const keyTarget = document.activeElement ?? document.body
          keyTarget.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', code: 'ShiftLeft', shiftKey: true, bubbles: true, cancelable: true, composed: true }))
          keyTarget.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', code: 'ShiftLeft', bubbles: true, cancelable: true, composed: true }))
          keyboard = true
          element.focus({ preventScroll: true })
        })
        await step('blur', () => element.blur())
        await step('press', () => {
          fire('pointerdown', hit, { ...at(x, y), buttons: 1 })
          const unprevented = fire('mousedown', hit, { ...at(x, y), buttons: 1 })
          for (const el of hovered) el.setAttribute(names.active, '')
          // A press moves focus to what it lands on, or away when that cannot take it.
          keyboard = false
          if (unprevented) {
            const into = hit.closest(focusable)
            if (into instanceof HTMLElement && !into.matches(':disabled')) into.focus({ preventScroll: true })
            else if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
          }
        })
        await step('release', () => {
          fire('pointerup', hit, at(x, y))
          fire('mouseup', hit, at(x, y))
          clear(names.active)
          if (hit.isConnected) fire('click', hit, at(x, y))
        })
        await step('leave', () => {
          fire('pointerout', hit, at(x, y))
          for (const el of hovered) fire('pointerleave', el, { ...at(x, y), bubbles: false })
          fire('mouseout', hit, at(x, y))
          for (const el of hovered) fire('mouseleave', el, { ...at(x, y), bubbles: false })
          clear(names.hover)
        })
        // A touch that changed what the state draws (Undo puts back other buttons) needs a fresh document for the rest.
        if (index + 1 < picked.length && markup() !== initial) return { shifts, touched, next: index + 1, unforced }
      }
      return { shifts, touched, unforced }
    },
    {
      root: options.root ?? defaults.root,
      targets: options.targets,
      skipWithin: options.skipWithin ?? null,
      max: options.max ?? 16,
      from: options.from ?? 0,
      pending: options.pending ?? null,
      tolerance: options.tolerance ?? defaults.tolerance,
      grows: options.grows ?? null,
    },
  ) as ForcedInteractionReport
}

/** One line per forced shift, in the guard's report format. */
export function formatForcedShift(shift: ForcedShift): string {
  return `${shift.step}: Layout shifted during the action.\n${formatLayoutShiftReport({ shifts: [], moved: shift.moved, observerSupported: true, waitedMs: 0 })}`
}
