import type { FocusEvent } from 'react'

/**
 * A scroller's `onFocus`: when keyboard focus lands on something inside it
 * that the scroller cuts off, scroll it into view whole, ring included.
 * Chromium's own focus scroll leaves an element alone while any part of it
 * shows, so a pill or tab half under the scroller's edge would stay cut off.
 * The ring's reach is the element's scroll margin (an outset ring sets it to
 * `--focus-ring-room`). Something already in view never moves: in a strip
 * with scroll snapping, `scrollIntoView` would snap even then. On a snapping
 * axis the item comes to the start, its snap position (the tabs snap to
 * their start); a `nearest` scroll of a few pixels would be snapped straight
 * back. Pointer focus never scrolls.
 */
export function revealFocus(event: FocusEvent<HTMLElement>): void {
  const scroller = event.currentTarget
  const target = event.target
  if (target === scroller || !target.matches(':focus-visible')) return
  const style = getComputedStyle(target)
  const box = target.getBoundingClientRect()
  const outer = scroller.getBoundingClientRect()
  // Half a pixel for rounding at fractional device pixels.
  const left = outer.left + scroller.clientLeft - 0.5
  const top = outer.top + scroller.clientTop - 0.5
  const inView =
    box.left - parseFloat(style.scrollMarginLeft) >= left &&
    box.right + parseFloat(style.scrollMarginRight) <= left + scroller.clientWidth + 1 &&
    box.top - parseFloat(style.scrollMarginTop) >= top &&
    box.bottom + parseFloat(style.scrollMarginBottom) <= top + scroller.clientHeight + 1
  if (inView) return
  const snap = getComputedStyle(scroller).scrollSnapType
  target.scrollIntoView({ block: /^(y|block|both)/.test(snap) ? 'start' : 'nearest', inline: /^(x|inline|both)/.test(snap) ? 'start' : 'nearest' })
}
