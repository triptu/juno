import type { Page } from '@playwright/test'

/**
 * The page-side helpers of the layout-shift guard, shared by `expectNoLayoutShift` and
 * `checkForcedInteractions` so both judge a shift the same way. Each function reaches the
 * page through `toString()`, so it must use nothing outside its own body.
 */

export interface Box {
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

export interface Snapshot {
  readonly el: HTMLElement
  readonly box: Box
  /** False when the element has no layout box (`display: none`, or inside such an element). */
  readonly rendered: boolean
}

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

/** How long the motion running under the root has left (see `runningMs` in `PageState`), from the motion running now. */
function motionClock(rootEl: HTMLElement): (endless: boolean, boxesOnly: boolean) => number {
  const earlier = new Set(rootEl.getAnimations({ subtree: true }))
  // Properties whose motion repaints but moves no layout box (offsets ignore transforms).
  const paintOnly = new Set([
    'color', 'background-color', 'background-position', 'border-color', 'border-top-color', 'border-right-color',
    'border-bottom-color', 'border-left-color', 'outline-color', 'outline-width', 'outline-offset',
    'text-decoration-color', 'caret-color', 'fill', 'stroke', 'opacity', 'visibility', 'box-shadow', 'text-shadow',
    'filter', 'backdrop-filter', 'transform', 'translate', 'scale', 'rotate',
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
  return runningMs
}

/** Turns a `layout-shift` entry into a `ShiftEntry`, dropping a video's own controls. */
function shiftEntries(rootEl: HTMLElement, startedAt: number, describe: (node: Node | null) => string): (entry: PerformanceEntry) => ShiftEntry {
  // Noted now: the action may remove the video before its entry is read.
  const hadVideo = rootEl.querySelector('video[controls]') !== null
  const rectBox = (rect: DOMRectReadOnly): Box => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
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
  return toEntry
}

const helpers = { describeNode, layoutBoxes, changedBoxes, motionClock, shiftEntries }

export type Helpers = typeof helpers

/**
 * Runs `fn(arg, helpers)` in the page, with `helpers` and `more` passed as their source. `arg` must be JSON.
 * Each function passed must be self-contained: it reaches the page through `toString()`.
 */
export const withHelpers = <A, R, M extends Record<string, (...args: never[]) => unknown> = Record<never, never>>(page: Page, fn: (arg: A, helpers: Helpers & M) => R, arg: A, more?: M): Promise<Awaited<R>> => {
  const source = Object.entries({ ...helpers, ...more }).map(([name, value]) => `${name}: ${value.toString()}`).join(', ')
  return page.evaluate(`(${fn.toString()})(${JSON.stringify(arg)}, { ${source} })`) as Promise<Awaited<R>>
}

