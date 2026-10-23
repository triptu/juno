/**
 * Where the context menu (`../ContextMenu.tsx`) sits, and what closes it
 * from outside. Every rule here works in one box, the view: the window, or
 * in the gallery the frame the menu is drawn in.
 */
import { useEffect, type RefObject } from 'react'

/** A point in the view's CSS pixels. */
export interface MenuPoint {
  readonly x: number
  readonly y: number
  /**
   * Set when the menu opens from a button rather than the pointer: its size,
   * with `x` the button's left edge and `y` its bottom. Opening to the right,
   * the menu lines up with the button's left edge; to the left, with its
   * right edge. Where there is no room under the button, it opens above it,
   * so it never covers the button that closes it.
   */
  readonly trigger?: { readonly width: number; readonly height: number }
}

export interface Size {
  readonly width: number
  readonly height: number
}

export interface Box extends MenuPoint, Size {}

/** Which side of the pointer the menu opened on, so a panel it turns into grows the same way. */
export type MenuSide = 'right' | 'left'

/** The corner of the menu that stays where it is while it turns into a larger panel. */
export interface Pin {
  readonly x: 'left' | 'right'
  readonly y: 'top' | 'bottom'
}

/**
 * Where the menu opens. Always downward from the pointer, its top a pixel
 * under it; near the bottom it moves up only as far as it must, never above
 * the pointer. To the right of the pointer when `room` fits there (the menu,
 * or the larger panel it may turn into), else to the left of it, its right
 * edge at the pointer. From a button (`at.trigger`), under it, lined up with
 * its left edge or, opening to the left, its right edge, and above it when
 * only that fits. Then held `edge` inside the view.
 */
export function placeMenu(at: MenuPoint, size: Size, room: Size, view: Size, edge: number): MenuPoint & { readonly side: MenuSide } {
  const { trigger } = at
  const nudge = trigger === undefined ? 1 : 0
  const side: MenuSide = at.x + nudge + Math.max(size.width, room.width) + edge <= view.width ? 'right' : 'left'
  const x = side === 'right' ? at.x + nudge : at.x + (trigger?.width ?? 0) - size.width
  const above = trigger === undefined ? undefined : at.y - trigger.height - 1 - size.height
  const y = above !== undefined && at.y + 1 + size.height + edge > view.height && above >= edge ? above : at.y + 1
  return {
    side,
    x: Math.round(clamp(x, edge, view.width - edge - size.width)),
    y: Math.round(clamp(y, edge, view.height - edge - size.height)),
  }
}

/**
 * Where a panel of `size` goes when the menu at `menu` turns into it, so
 * that one corner of the menu stays put and the surface only grows.
 * Sideways it grows the way the menu opened (`side`), from the menu's
 * pointer-side edge. Downward from the menu's top when it fits, else upward
 * from its bottom. Only when neither fits, in a view too small for it, is
 * it held `edge` inside, and that corner moves.
 */
export function placeMorph(menu: Box, size: Size, side: MenuSide, view: Size, edge: number): MenuPoint & { readonly pin: Pin } {
  const pinX = side === 'right' ? 'left' : 'right'
  const x = pinX === 'left' ? menu.x : menu.x + menu.width - size.width
  const down = menu.y + size.height + edge <= view.height
  const up = !down && menu.y + menu.height - size.height >= edge
  const pinY = up ? 'bottom' : 'top'
  const y = up ? menu.y + menu.height - size.height : menu.y
  return {
    pin: { x: pinX, y: pinY },
    x: Math.round(clamp(x, edge, view.width - edge - size.width)),
    y: Math.round(clamp(y, edge, view.height - edge - size.height)),
  }
}

/** `value` inside `[low, high]`; `low` wins when the view is too small for both. */
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(value, high))

/**
 * A press or a wheel turn outside the menu, the window losing focus or
 * resizing close it. Esc is the menu's own key. A list scrolling by itself
 * (a message arriving, or deleted under the menu) does not.
 */
export function useDismiss(ref: RefObject<HTMLDivElement | null>, closeRef: RefObject<() => void>, inline: boolean): void {
  useEffect(() => {
    if (inline) return
    const close = () => closeRef.current()
    // A wheel inside the menu (its emoji picker) is the menu's own.
    // A press on a button that toggles a menu (`data-menu-toggle`) is left to the button: it closes its own menu
    // or opens another in its place, so a second press on it does not close and reopen the menu.
    const outside = (event: Event) => {
      if (event.type === 'pointerdown' && event.target instanceof Element && event.target.closest('[data-menu-toggle]') !== null) return
      if (!(event.target instanceof Node) || ref.current?.contains(event.target) !== true) close()
    }
    window.addEventListener('pointerdown', outside, true)
    window.addEventListener('wheel', outside, { capture: true, passive: true })
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('wheel', outside, true)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  }, [ref, closeRef, inline])
}
