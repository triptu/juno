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
      event.currentTarget.focus({ preventScroll: true })
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
