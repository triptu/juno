/**
 * The motion of `ReorderMotion`, loaded once the browser is idle after the
 * first rows have painted, so the start bundle does not carry it.
 *
 * FLIP: each row takes its new place in the DOM at once, and a transform
 * starts it from where it was drawn and eases it to zero. A row new in view
 * comes in from the top of its slot as the rows below move aside. Only
 * `transform` and `opacity` animate, as Web Animations on the compositor,
 * so no frame lays anything out, and a row is clickable where it is drawn
 * throughout.
 */
import { colors } from '@juno/tokens/tokens.stylex'
import { rootDuration } from './motion'
import type { ReorderMotionProps } from './ReorderMotion'

interface Drawn {
  readonly top: number
  readonly opacity: number
  /** Whether any part of it was in view. */
  readonly seen: boolean
  /** Still coming in as new: a change now keeps it on the row below rather than sliding it on its own. */
  readonly arriving: boolean
}

/** Where each row near the view was drawn, or undefined when this change takes effect at once. */
export type Snapshot = { readonly drawn: ReadonlyMap<string, Drawn> | undefined }

/** How far below the view rows are read, so a row that slides up into view starts from below the edge. */
const BELOW = 320
/** How far (in its own heights) a row from outside the view may slide; from further it comes in as new. */
const SLIDE_LIMIT = 2
/** How far the rows below a new row have moved aside (in eased progress) when it starts to show in its place. */
const SHOW_FROM = 0.8

/** One list's rows in motion. */
export class Player {
  private readonly running = new Map<HTMLElement, Animation>()
  /** When each animation was made, on the document timeline. */
  private readonly made = new WeakMap<Animation, number>()
  private readonly raised = new Set<HTMLElement>()
  private readonly arriving = new Set<HTMLElement>()

  /**
   * Before the DOM changes: null when the order is the same or only grew at
   * its end, else where the rows near the view are drawn. Rows move only
   * for a change marked `animate` while the scroller is at its top;
   * scrolled down, scroll anchoring keeps the rows in view still, and a
   * transform there would fight it (performance.md 3.1). Reduced motion
   * makes the duration zero.
   */
  capture(before: ReorderMotionProps, { groups, animate, scroller: { current: scroller }, row, rowKey }: ReorderMotionProps): Snapshot | null {
    if (appendedOnly(before.groups, groups)) return null
    if (!animate || scroller === null || scroller.scrollTop > 0.5 || rootDuration('--duration-reorder') < 1) return { drawn: undefined }
    // The compositor runs an animation from the frame after it was made, while this
    // thread holds it at its start until it hears back. Put such an animation at the
    // time the compositor drew, so the rows are read where they are on screen.
    const now = Number(document.timeline.currentTime ?? 0)
    for (const animation of this.running.values()) {
      if (animation.startTime === null) animation.currentTime = Math.max(0, now - (this.made.get(animation) ?? now))
    }
    const view = scroller.getBoundingClientRect()
    const drawn = new Map<string, Drawn>()
    for (const el of scroller.querySelectorAll<HTMLElement>(row)) {
      const rect = el.getBoundingClientRect()
      if (rect.top > view.bottom + BELOW) break
      const id = el.getAttribute(rowKey)
      if (id === null || rect.height === 0) continue
      const opacity = this.running.has(el) ? Number(getComputedStyle(el).opacity) : 1
      drawn.set(id, { top: rect.top, opacity, seen: rect.bottom > view.top && rect.top < view.bottom, arriving: this.arriving.has(el) })
    }
    return { drawn }
  }

  /**
   * After the DOM changed: every row from where it was drawn to its place.
   * A change that comes before the last has finished starts each row again
   * from where it is drawn now.
   */
  play({ scroller: { current: scroller }, row, rowKey }: ReorderMotionProps, { drawn }: Snapshot): void {
    this.stop()
    if (scroller === null || drawn === undefined) return
    const timing: KeyframeAnimationOptions = { duration: rootDuration('--duration-reorder'), easing: rootEasing() }
    const view = scroller.getBoundingClientRect()
    // Read every place first, then start every animation, so the reads lay out once.
    const rows: Array<{ readonly el: HTMLElement; readonly top: number; readonly height: number; readonly from: Drawn | undefined }> = []
    for (const el of scroller.querySelectorAll<HTMLElement>(row)) {
      const rect = el.getBoundingClientRect()
      if (rect.top > view.bottom + BELOW) break
      const id = el.getAttribute(rowKey)
      if (id === null || rect.height === 0) continue
      const from = drawn.get(id)
      const inView = rect.bottom > view.top && rect.top < view.bottom
      if (from === undefined ? inView : from.seen || inView) rows.push({ el, top: rect.top, height: rect.height, from })
    }
    for (const [i, entry] of rows.entries()) {
      const { el, top, height, from } = entry
      if (from !== undefined && !from.arriving && (from.seen || Math.abs(from.top - top) <= SLIDE_LIMIT * height)) {
        const dy = from.top - top
        if (Math.abs(dy) < 0.5 && from.opacity >= 1) continue
        // A row that rises past others is drawn over them, on the list's own colour, so two rows' text never shows through each other.
        const rises = dy > 0 && rows.some((other) => other !== entry && other.from !== undefined && other.from.top < from.top && other.top > top)
        const fade = from.opacity < 1 ? [{ opacity: from.opacity }, { opacity: 1 }] : [{}, {}]
        this.start(el, [{ transform: `translateY(${dy}px)`, ...fade[0] }, { transform: 'none', ...fade[1] }], timing, rises)
        continue
      }
      const opacity = from?.arriving === true ? from.opacity : 0
      // New in view under a row that stays: it shows in its place once the rows below have moved aside, so it never passes over the row above.
      const above = rows[i - 1]
      if (above !== undefined && above.from !== undefined && !above.from.arriving) {
        this.start(el, [{ opacity }, { opacity, offset: SHOW_FROM }, { opacity: 1 }], timing, false, true)
        continue
      }
      // New at the top, or under another new row: it rides down on top of the row below as that moves aside, so the two never overlap.
      const below = rows.slice(i + 1).find((other) => other.from !== undefined)
      const dy = below?.from === undefined ? -height : Math.min(0, below.from.top - below.top)
      this.start(el, [{ transform: `translateY(${dy}px)`, opacity }, { transform: 'none', opacity: 1 }], timing, false, true)
    }
  }

  /** Puts every row in its place now. */
  stop(): void {
    for (const animation of this.running.values()) animation.cancel()
    this.running.clear()
    for (const el of this.raised) lower(el)
    this.raised.clear()
    this.arriving.clear()
  }

  private start(el: HTMLElement, keyframes: Keyframe[], timing: KeyframeAnimationOptions, raised: boolean, arriving = false): void {
    if (arriving) this.arriving.add(el)
    if (raised) {
      el.style.zIndex = '1'
      if (el.getAttribute('aria-current') !== 'true') el.style.backgroundColor = colors['--background-subtle']
      this.raised.add(el)
    }
    const animation = el.animate(keyframes, timing)
    this.made.set(animation, Number(document.timeline.currentTime ?? 0))
    this.running.set(el, animation)
    // A cancelled animation was stopped by `stop`, which lowers its row there and then.
    animation.addEventListener('finish', () => {
      if (this.running.get(el) !== animation) return
      this.running.delete(el)
      this.arriving.delete(el)
      if (this.raised.delete(el)) lower(el)
    })
  }
}

/** The same groups, or each only grew at its end: nothing drawn above the new rows moves. */
function appendedOnly(before: ReadonlyArray<ReadonlyArray<string>>, after: ReadonlyArray<ReadonlyArray<string>>): boolean {
  return before.length === after.length && before.every((ids, i) => ids === after[i] || after[i]!.length >= ids.length && ids.every((id, j) => after[i]![j] === id))
}

function lower(el: HTMLElement): void {
  el.style.removeProperty('z-index')
  el.style.removeProperty('background-color')
}

/** `--ease-out`, for a Web Animation, which cannot read CSS variables. */
function rootEasing(): string {
  const easing = getComputedStyle(document.documentElement).getPropertyValue('--ease-out').trim()
  return easing === '' ? 'ease-out' : easing
}
