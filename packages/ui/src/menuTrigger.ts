import type { ButtonHTMLAttributes, MouseEvent } from 'react'

type TriggerProps = Pick<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-haspopup' | 'onClick' | 'onPointerDown' | 'onKeyDown'>

/** Native menu timing, shared by every menu and popover button. */
export function menuTriggerHandlers({ 'aria-haspopup': popup, onClick, onPointerDown, onKeyDown }: TriggerProps): TriggerProps {
  if (popup === undefined || popup === false || popup === 'false' || onClick === undefined) return { onClick, onPointerDown, onKeyDown }
  const isMouseClick = (event: MouseEvent<HTMLButtonElement>) =>
    event.detail !== 0 && (!(event.nativeEvent instanceof PointerEvent) || event.nativeEvent.pointerType === 'mouse')
  return {
    onPointerDown: (event) => {
      onPointerDown?.(event)
      if (event.defaultPrevented || event.pointerType !== 'mouse' || event.button !== 0 || event.ctrlKey) return
      // Keep the browser's later mouse-down focus from taking focus back out of the panel.
      event.preventDefault()
      focusWithoutRing(event.currentTarget)
      onClick(event)
    },
    onClick: (event) => {
      // Keyboard/AT clicks and touch still activate here. A mouse press already activated.
      if (!isMouseClick(event) && !event.ctrlKey) onClick(event)
    },
    onKeyDown: (event) => {
      onKeyDown?.(event)
      if (event.defaultPrevented || event.key !== 'ArrowDown') return
      event.preventDefault()
      event.currentTarget.click()
    },
  }
}

/**
 * Focus for a mouse press, with no focus ring: Chrome's `:focus-visible` matches focus a script moves, so a click
 * would draw the ring, and a button that took focus from Escape keeps its ring until it is focused again. Blurring
 * first makes the new focus count. The ring returns with the next key.
 */
function focusWithoutRing(button: HTMLButtonElement): void {
  if (document.activeElement === button && button.matches(':focus-visible')) button.blur()
  button.focus({ preventScroll: true, focusVisible: false } as FocusOptions)
}
