/**
 * A right-click opens a message's menu when it completes, as the button
 * comes up, not as it goes down, which is when macOS sends the context menu
 * event. The context-menu key opens it at once.
 */
import type { MouseEvent } from 'react'

/** Where a menu opens, in window pixels. */
export interface MenuAt {
  readonly clientX: number
  readonly clientY: number
}

/**
 * Opens a menu for the context menu `event`: at once when no button is down
 * (the context-menu key, or a platform that sends the event on release),
 * else when that button comes up over something `over` accepts. A release
 * elsewhere, outside the window, a cancelled press or the window losing
 * focus opens nothing.
 */
export function openOnRelease(event: MouseEvent, over: (element: Element) => boolean, open: (at: MenuAt) => void): void {
  // Not `=== 0`: an event a script sends has no buttons at all.
  if (!(event.buttons > 0)) return open(event)
  const button = event.button
  const done = () => {
    window.removeEventListener('pointerup', up, true)
    window.removeEventListener('pointercancel', done, true)
    window.removeEventListener('blur', done)
  }
  const up = (release: globalThis.PointerEvent) => {
    if (release.button !== button) return
    done()
    const under = document.elementFromPoint(release.clientX, release.clientY)
    if (under !== null && over(under)) open(release)
  }
  window.addEventListener('pointerup', up, true)
  window.addEventListener('pointercancel', done, true)
  window.addEventListener('blur', done)
}
