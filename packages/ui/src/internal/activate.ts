/**
 * Mouse-down activation for things that navigate: rows, tabs, option rows.
 * Native apps react when the button goes down, not when it comes back up, so
 * these elements activate on `pointerdown` for the primary button.
 *
 * - Modifier keys (⌘, shift, alt) are passed through so the owner can open
 *   in a new tab. Ctrl is not: on macOS ctrl-click is the context menu.
 * - The secondary button is ignored; `onContextMenu` handles it.
 * - Enter and Space activate from the keyboard.
 * - A press that starts inside a nested control (a Resolve button, a close
 *   button, a link) does nothing; the control handles itself.
 * - Touch waits for the click, so a scroll gesture is not a navigation.
 * - Clicks with `detail === 0` (assistive technology) still activate.
 */
import type { KeyboardEvent, MouseEvent, PointerEvent } from 'react'

export interface ActivateEvent {
  readonly metaKey: boolean
  readonly shiftKey: boolean
  readonly altKey: boolean
  readonly source: 'pointer' | 'keyboard'
}

export type ActivateHandler = (event: ActivateEvent) => void

export interface ActivateOptions {
  /** Keep focus where it is (lists that sit over an input). */
  readonly keepFocus?: boolean
  readonly disabled?: boolean
}

export interface ActivateHandlers<E extends HTMLElement> {
  readonly onPointerDown: (event: PointerEvent<E>) => void
  readonly onKeyDown: (event: KeyboardEvent<E>) => void
  readonly onClick: (event: MouseEvent<E>) => void
}

const NESTED = 'button, a[href], input, select, textarea, [role="button"], [role="option"], [role="tab"], [role="menuitem"]'

function insideNestedControl(target: EventTarget | null, current: HTMLElement): boolean {
  if (!(target instanceof Element)) return false
  const nested = target.closest(NESTED)
  return nested !== null && nested !== current
}

/** Builds the three handlers. Spread the result onto the element. */
export function activateHandlers<E extends HTMLElement>(
  onActivate: ActivateHandler | undefined,
  { keepFocus = false, disabled = false }: ActivateOptions = {},
): ActivateHandlers<E> {
  let touchPending = false
  return {
    onPointerDown(event) {
      if (!onActivate || disabled) return
      if (event.button !== 0 || event.ctrlKey) return
      if (insideNestedControl(event.target, event.currentTarget)) return
      if (keepFocus) event.preventDefault()
      if (event.pointerType === 'touch') {
        touchPending = true
        return
      }
      onActivate({ metaKey: event.metaKey, shiftKey: event.shiftKey, altKey: event.altKey, source: 'pointer' })
    },
    onKeyDown(event) {
      if (!onActivate || disabled) return
      if (event.key !== 'Enter' && event.key !== ' ') return
      if (event.target !== event.currentTarget) return
      event.preventDefault()
      onActivate({ metaKey: event.metaKey, shiftKey: event.shiftKey, altKey: event.altKey, source: 'keyboard' })
    },
    onClick(event) {
      if (!onActivate || disabled) return
      if (insideNestedControl(event.target, event.currentTarget)) return
      const synthetic = event.detail === 0
      if (!synthetic && !touchPending) return
      touchPending = false
      onActivate({ metaKey: event.metaKey, shiftKey: event.shiftKey, altKey: event.altKey, source: synthetic ? 'keyboard' : 'pointer' })
    },
  }
}
