/**
 * Tells a pointer enter caused by the pointer moving from one caused by the
 * content moving under a still pointer, as when a list scrolls. Chromium
 * sends the enter for a real move before that move's `pointermove`, at the
 * new position; an enter from scrolling comes at the position of the last
 * move. Hover work (prefetch, size reads) can skip the second kind, so a
 * scroll does not run it for every row that passes under the pointer
 * (docs/performance.md 3.2).
 */
import type { PointerEvent } from 'react'

let lastX = Number.NaN
let lastY = Number.NaN
let listening = false

function remember(event: globalThis.PointerEvent): void {
  lastX = event.clientX
  lastY = event.clientY
}

/** True when the pointer moved onto the element; false when the element moved under the pointer. */
export function pointerMoved(event: PointerEvent): boolean {
  if (!listening) {
    listening = true
    window.addEventListener('pointermove', remember, { capture: true, passive: true })
  }
  return event.clientX !== lastX || event.clientY !== lastY
}
