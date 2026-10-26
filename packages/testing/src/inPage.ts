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

/**
 * Every HTML element under the root and its layout box, as `boxReader` read them: element `i` has
 * `boxes[4i..4i+3]` (x, y, width, height, relative to the root) and `rendered[i]`, 0 when it has no
 * layout box (`display: none`, or inside such an element).
 */
export interface Snapshot {
  readonly elements: ReadonlyArray<HTMLElement>
  readonly boxes: Float64Array
  readonly rendered: Uint8Array
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

/**
 * Reads the layout box of every HTML element under the root, as often as asked. The element list is
 * kept until an element is added, removed or moved under the root, and the boxes go into two buffers
 * used in turn, so a read allocates nothing but its list when that changed. Only the last two reads
 * stay valid: a third reuses the first one's buffers.
 */
function boxReader(rootEl: HTMLElement) {
  const membership = new MutationObserver(() => {})
  membership.observe(rootEl, { childList: true, subtree: true })
  let elements: HTMLElement[] = []
  let indexOf = new Map<Element, number>()
  let stale = true
  const frames = [
    { elements, boxes: new Float64Array(0), rendered: new Uint8Array(0) },
    { elements, boxes: new Float64Array(0), rendered: new Uint8Array(0) },
  ]
  let turn = 0
  // Offsets are relative to the offset parent. One inside the root comes earlier in tree order, so its
  // origin is already in this read's buffer; one outside it (an ancestor of the root) is read once per read.
  const outside = new Map<Element, { x: number; y: number }>()
  const outsideOrigin = (el: HTMLElement): { x: number; y: number } => {
    const saved = outside.get(el)
    if (saved) return saved
    const parent = el.offsetParent
    const at = parent instanceof HTMLElement ? outsideOrigin(parent) : { x: 0, y: 0 }
    const origin = { x: at.x + el.offsetLeft, y: at.y + el.offsetTop }
    outside.set(el, origin)
    return origin
  }
  const read = (): Snapshot => {
    if (stale || membership.takeRecords().length > 0) {
      elements = [rootEl, ...Array.from(rootEl.querySelectorAll('*'))].filter((el): el is HTMLElement => el instanceof HTMLElement)
      indexOf = new Map(elements.map((el, index) => [el, index]))
      stale = false
    }
    const frame = frames[turn]!
    turn = 1 - turn
    const count = elements.length
    if (frame.rendered.length < count) {
      frame.boxes = new Float64Array(count * 4)
      frame.rendered = new Uint8Array(count)
    }
    frame.elements = elements
    const { boxes, rendered } = frame
    outside.clear()
    // Absolute origins first, in tree order, then made relative to the root.
    for (let index = 0; index < count; index++) {
      const el = elements[index]!
      const parent = el.offsetParent
      const at = parent === null ? undefined : indexOf.get(parent)
      let x = el.offsetLeft
      let y = el.offsetTop
      if (at !== undefined && at < index) {
        x += boxes[at * 4]!
        y += boxes[at * 4 + 1]!
      } else if (parent instanceof HTMLElement) {
        const origin = outsideOrigin(parent)
        x += origin.x
        y += origin.y
      }
      boxes[index * 4] = x
      boxes[index * 4 + 1] = y
      boxes[index * 4 + 2] = el.offsetWidth
      boxes[index * 4 + 3] = el.offsetHeight
      rendered[index] = el.getClientRects().length > 0 ? 1 : 0
    }
    const rootX = boxes[0]!
    const rootY = boxes[1]!
    for (let index = 0; index < count; index++) {
      boxes[index * 4] = boxes[index * 4]! - rootX
      boxes[index * 4 + 1] = boxes[index * 4 + 1]! - rootY
    }
    return { elements, boxes: boxes.subarray(0, count * 4), rendered: rendered.subarray(0, count) }
  }
  return { read, close: () => membership.disconnect() }
}

/** Elements rendered in both snapshots whose box moved or resized by more than `epsilon`; `grows` elements may change width. */
function changedBoxes(before: Snapshot, after: Snapshot, epsilon: number, grows: string | null, describe: (node: Node | null) => string): MovedElement[] {
  const same = before.elements === after.elements
  const now = same ? undefined : new Map(after.elements.map((el, index) => [el, index]))
  const moved: MovedElement[] = []
  const box = (boxes: Float64Array, at: number): Box => ({ x: boxes[at * 4]!, y: boxes[at * 4 + 1]!, width: boxes[at * 4 + 2]!, height: boxes[at * 4 + 3]! })
  for (let was = 0; was < before.elements.length; was++) {
    const is = same ? was : now!.get(before.elements[was]!)
    if (is === undefined || !before.rendered[was] || !after.rendered[is]) continue
    const a = before.boxes, b = after.boxes
    const resized = Math.abs(a[was * 4 + 2]! - b[is * 4 + 2]!) > epsilon && (grows === null || !before.elements[was]!.matches(grows))
    const differs =
      Math.abs(a[was * 4]! - b[is * 4]!) > epsilon ||
      Math.abs(a[was * 4 + 1]! - b[is * 4 + 1]!) > epsilon ||
      resized ||
      Math.abs(a[was * 4 + 3]! - b[is * 4 + 3]!) > epsilon
    if (differs) moved.push({ element: describe(before.elements[was]!), before: box(a, was), after: box(b, is) })
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
    // A shift outside the watched region is another region's (a sidebar sorting while Home is checked); only sources
    // under the root count. A source without a node cannot be placed and stays.
    const outside = (source: { node: Node | null }) => rootEl !== document.body && source.node !== null && !rootEl.contains(source.node)
    const all = (shift.sources ?? []).filter((source) => !outside(source))
    const kept = all.filter((source) => !inControls(source))
    const unattributed = all.length === 0 && (hadVideo || rootEl.querySelector('video[controls]') !== null)
    return {
      value: ((shift.sources ?? []).length > 0 && kept.length === 0) || unattributed ? 0 : shift.value,
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

const helpers = { describeNode, boxReader, changedBoxes, motionClock, shiftEntries }

export type Helpers = typeof helpers

const missing = '__juno-helpers-missing__'

/** A short name for a source text, so a document can hold several installed functions. */
const nameOf = (source: string): string => {
  let hash = 0x811c9dc5
  for (let index = 0; index < source.length; index++) hash = Math.imul(hash ^ source.charCodeAt(index), 0x01000193)
  return `${source.length}-${(hash >>> 0).toString(36)}`
}

const callInstalled = (page: Page, name: string, arg: unknown) =>
  page.evaluate(([name, arg, missing]) => {
    const run = (globalThis as { __junoHelpers?: Record<string, (arg: unknown) => unknown> }).__junoHelpers?.[name]
    return run ? run(arg) : missing
  }, [name, arg, missing] as const)

/**
 * Runs `fn(arg, helpers)` in the page, with `helpers` and `more` passed as their source. `arg` must be JSON.
 * Each function passed must be self-contained: it reaches the page through `toString()`. The page compiles
 * them once per document and keeps them, so later calls send only `arg`.
 */
export const withHelpers = async <A, R, M extends Record<string, (...args: never[]) => unknown> = Record<never, never>>(page: Page, fn: (arg: A, helpers: Helpers & M) => R, arg: A, more?: M): Promise<Awaited<R>> => {
  const source = `(arg) => (${fn.toString()})(arg, { ${Object.entries({ ...helpers, ...more }).map(([name, value]) => `${name}: ${value.toString()}`).join(', ')} })`
  const name = nameOf(source)
  const result = await callInstalled(page, name, arg)
  if (result !== missing) return result as Awaited<R>
  await page.evaluate(`(globalThis.__junoHelpers ??= {})[${JSON.stringify(name)}] = ${source}`)
  return await callInstalled(page, name, arg) as Awaited<R>
}
