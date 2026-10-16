import { rootDuration } from '../motion'

/**
 * Dragging a tab along the strip to reorder it, as in Safari and Chrome.
 *
 * The tab's own `pointerdown` still selects it. Only once the pointer has
 * moved `THRESHOLD` px does the drag start: the tab follows the pointer and
 * the tabs it passes slide aside. Everything moves by `transform` written
 * straight to the DOM once per animation frame, so no tab re-renders while
 * the pointer moves. On release the tab settles into its slot and `onMove`
 * reports the new index; the strip clears the transforms in the commit that
 * shows the new order (`settled`), so nothing jumps. Esc puts every tab back.
 * Near the scroller's ends the strip scrolls when the tabs overflow.
 *
 * A tab moves within its group: pinned tabs among the pinned ones, the
 * others after them (`moveTab` in `@juno/state` keeps the same rule).
 */

/** How far the pointer moves before a press becomes a drag. A click selects on mouse down either way. */
const THRESHOLD = 4
/** How close to the scroller's ends the pointer must be to scroll it, and the fastest scroll per frame. */
const EDGE = 32
const MAX_SCROLL = 14
/** How long the strip waits for the reorder to commit before clearing the transforms anyway. */
const COMMIT_WAIT = 300

const SLIDE = 'transform var(--duration-fast) var(--ease-out)'

/** The settle's timing for a Web Animation, which cannot read CSS variables: `--duration-fast` and `--ease-out`. */
function settleTiming(): KeyframeAnimationOptions {
  const easing = getComputedStyle(document.documentElement).getPropertyValue('--ease-out').trim()
  return { duration: rootDuration('--duration-fast'), easing: easing === '' ? 'ease-out' : easing }
}

interface Press {
  readonly pointerId: number
  readonly startX: number
  readonly box: HTMLElement
}

interface Drag {
  readonly boxes: ReadonlyArray<HTMLElement>
  /** The dragged tab's index, and the first and last index of its group. */
  readonly from: number
  readonly first: number
  readonly last: number
  /** Each tab's left edge and width in the scroller's content, read once when the drag starts. */
  readonly lefts: ReadonlyArray<number>
  readonly widths: ReadonlyArray<number>
  /** The scroller's left edge on screen, and how far it can scroll. */
  readonly viewLeft: number
  readonly viewWidth: number
  readonly maxScroll: number
  readonly startScroll: number
  /** The pointer's x in the scroller's content where it was pressed. */
  readonly grabX: number
  /** The other tabs' current shift, so a frame writes only what changed. */
  readonly shifts: Array<number>
  scroll: number
  x: number
  to: number
}

export interface TabDragOptions {
  /** The tab at `from` was dropped at `to`. Not called when it lands where it started. */
  readonly onMove: (from: number, to: number) => void
}

const isBox = (node: Element): node is HTMLElement => node instanceof HTMLElement && node.hasAttribute('data-tab')
const isPinned = (box: HTMLElement) => box.hasAttribute('data-tab-pinned')

export class TabDrag {
  private press: Press | undefined
  private drag: Drag | undefined
  private frame = 0
  /** A drop waiting for the strip to commit the new order before its transforms clear. */
  private waiting: ReturnType<typeof setTimeout> | undefined
  private settling: Animation | undefined

  constructor(
    private readonly scroller: HTMLElement,
    private readonly options: TabDragOptions,
  ) {}

  /** Whether a drag is running or settling: the strip's own scrolling waits for it. */
  get active(): boolean {
    return this.drag !== undefined || this.waiting !== undefined || this.settling !== undefined
  }

  /** A press on the strip. Only the primary button on a tab, not on its close button and not with ⌃ (the context menu). */
  pointerDown(event: PointerEvent): void {
    if (event.button !== 0 || event.ctrlKey || this.press !== undefined || this.active) return
    const target = event.target
    if (!(target instanceof Element) || target.closest('button') !== null) return
    const box = target.closest('[data-tab]')
    if (!(box instanceof HTMLElement) || box.parentElement !== this.scroller) return
    this.press = { pointerId: event.pointerId, startX: event.clientX, box }
    window.addEventListener('pointermove', this.onPointerMove, true)
    window.addEventListener('pointerup', this.onPointerUp, true)
    window.addEventListener('pointercancel', this.onPointerCancel, true)
  }

  /** The strip committed a render: the reorder the drop asked for is on screen, so the transforms go. */
  settled(): void {
    if (this.waiting === undefined) return
    clearTimeout(this.waiting)
    this.waiting = undefined
    this.clearStyles()
  }

  dispose(): void {
    this.stopListening()
    cancelAnimationFrame(this.frame)
    clearTimeout(this.waiting)
    this.settling?.cancel()
    this.clearStyles()
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    const press = this.press
    if (press === undefined || event.pointerId !== press.pointerId) return
    if (this.drag === undefined) {
      if (Math.abs(event.clientX - press.startX) < THRESHOLD) return
      this.start(press, event)
    }
    const drag = this.drag
    if (drag === undefined) return
    drag.x = event.clientX
    this.schedule()
  }

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (this.press === undefined || event.pointerId !== this.press.pointerId) return
    this.press = undefined
    this.stopListening()
    if (this.drag !== undefined) this.drop()
  }

  private readonly onPointerCancel = (event: PointerEvent): void => {
    if (this.press === undefined || event.pointerId !== this.press.pointerId) return
    this.cancel()
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || this.drag === undefined) return
    event.preventDefault()
    event.stopPropagation()
    this.cancel()
  }

  private stopListening(): void {
    window.removeEventListener('pointermove', this.onPointerMove, true)
    window.removeEventListener('pointerup', this.onPointerUp, true)
    window.removeEventListener('pointercancel', this.onPointerCancel, true)
    window.removeEventListener('keydown', this.onKeyDown, true)
  }

  /** Reads every tab's place once, then lifts the pressed tab. */
  private start(press: Press, event: PointerEvent): void {
    const boxes = [...this.scroller.children].filter(isBox)
    const from = boxes.indexOf(press.box)
    if (from < 0) return
    const pinned = isPinned(press.box)
    let first = from
    let last = from
    while (first > 0 && isPinned(boxes[first - 1]!) === pinned) first--
    while (last < boxes.length - 1 && isPinned(boxes[last + 1]!) === pinned) last++
    const view = this.scroller.getBoundingClientRect()
    const scroll = this.scroller.scrollLeft
    this.drag = {
      boxes,
      from,
      first,
      last,
      lefts: boxes.map((box) => box.offsetLeft),
      widths: boxes.map((box) => box.offsetWidth),
      viewLeft: view.left,
      viewWidth: view.width,
      maxScroll: this.scroller.scrollWidth - this.scroller.clientWidth,
      startScroll: scroll,
      grabX: press.startX - view.left + scroll,
      shifts: boxes.map(() => 0),
      scroll,
      x: event.clientX,
      to: from,
    }
    try {
      this.scroller.setPointerCapture(press.pointerId)
    } catch {
      // A synthetic press has no pointer to capture; the window listeners still follow it.
    }
    window.addEventListener('keydown', this.onKeyDown, true)
    // Snapping would pull the scroller back while it scrolls under the drag.
    this.scroller.style.scrollSnapType = 'none'
    this.scroller.setAttribute('data-tab-dragging', '')
    press.box.setAttribute('data-tab-dragged', '')
    press.box.style.zIndex = '2'
    for (let i = first; i <= last; i++) if (i !== from) boxes[i]!.style.transition = SLIDE
  }

  private schedule(): void {
    if (this.frame === 0) this.frame = requestAnimationFrame(this.paint)
  }

  /** One frame: scroll near the ends, move the dragged tab with the pointer, slide the tabs it passed. */
  private readonly paint = (): void => {
    this.frame = 0
    const drag = this.drag
    if (drag === undefined) return
    const step = edgeStep(drag.x - drag.viewLeft, drag.viewWidth)
    const scroll = Math.min(Math.max(drag.scroll + step, 0), drag.maxScroll)
    if (scroll !== drag.scroll) {
      drag.scroll = scroll
      this.scroller.scrollLeft = scroll
    }
    const { from, first, last, lefts, widths } = drag
    const width = widths[from]!
    const left = Math.min(Math.max(lefts[from]! + drag.x - drag.viewLeft + scroll - drag.grabX, lefts[first]!), lefts[last]! + widths[last]! - width)
    const centre = left + width / 2
    let to = from
    for (let i = first; i <= last; i++) {
      if (i === from) continue
      const middle = lefts[i]! + widths[i]! / 2
      const shift = i < from && centre < middle ? width : i > from && centre > middle ? -width : 0
      if (shift > 0) to = Math.min(to, i)
      if (shift < 0) to = Math.max(to, i)
      if (shift !== drag.shifts[i]) {
        drag.shifts[i] = shift
        drag.boxes[i]!.style.transform = shift === 0 ? '' : `translateX(${shift}px)`
      }
    }
    drag.to = to
    drag.boxes[from]!.style.transform = `translateX(${left - lefts[from]!}px)`
    if (step !== 0 && scroll > 0 && scroll < drag.maxScroll) this.schedule()
  }

  /** The tab slides from the pointer into its slot, then the new order is reported. */
  private drop(): void {
    cancelAnimationFrame(this.frame)
    this.frame = 0
    const drag = this.drag
    if (drag === undefined) return
    this.paint()
    this.drag = undefined
    window.removeEventListener('keydown', this.onKeyDown, true)
    const { from, to, lefts, widths } = drag
    const box = drag.boxes[from]!
    const slot = to <= from ? lefts[to]! : lefts[to]! + widths[to]! - widths[from]!
    const end = `translateX(${slot - lefts[from]!}px)`
    const settling = box.animate([{ transform: box.style.transform || 'none' }, { transform: end }], settleTiming())
    this.settling = settling
    box.style.transform = end
    void settling.finished.then(
      () => this.landed(from, to),
      () => undefined,
    )
  }

  private landed(from: number, to: number): void {
    this.settling = undefined
    if (from === to) {
      this.clearStyles()
      return
    }
    // The transforms stay until the strip renders the new order (`settled`), so no frame shows the old order without them.
    this.waiting = setTimeout(() => {
      this.waiting = undefined
      this.clearStyles()
    }, COMMIT_WAIT)
    this.options.onMove(from, to)
  }

  /** Esc or a lost pointer: every tab slides back. */
  private cancel(): void {
    this.press = undefined
    this.stopListening()
    cancelAnimationFrame(this.frame)
    this.frame = 0
    const drag = this.drag
    this.drag = undefined
    if (drag === undefined) return
    const box = drag.boxes[drag.from]!
    const settling = box.animate([{ transform: box.style.transform || 'none' }, { transform: 'none' }], settleTiming())
    this.settling = settling
    box.style.transform = ''
    for (const other of drag.boxes) if (other !== box) other.style.transform = ''
    void settling.finished.then(
      () => {
        this.settling = undefined
        this.clearStyles()
      },
      () => undefined,
    )
  }

  private clearStyles(): void {
    this.scroller.style.scrollSnapType = ''
    this.scroller.removeAttribute('data-tab-dragging')
    for (const box of [...this.scroller.children].filter(isBox)) {
      // No transition while the transform goes, or the tabs would slide out of their new places.
      box.style.transition = ''
      box.style.transform = ''
      box.style.zIndex = ''
      box.removeAttribute('data-tab-dragged')
    }
  }
}

/** How far to scroll this frame: faster the deeper the pointer is past the edge zone's start. */
function edgeStep(x: number, width: number): number {
  if (x < EDGE) return -Math.ceil(MAX_SCROLL * Math.min(1, (EDGE - x) / EDGE))
  if (x > width - EDGE) return Math.ceil(MAX_SCROLL * Math.min(1, (x - (width - EDGE)) / EDGE))
  return 0
}
