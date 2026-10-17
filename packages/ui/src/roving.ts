/**
 * Keys inside a composite widget that is one Tab stop (a toolbar, a radio
 * group): the arrows move focus to the next or previous item, wrapping at
 * the ends, and Home and End go to the first and last. Items hidden by a
 * container query or disabled are skipped. The owner keeps the roving
 * tabindex: the item that has focus, or the chosen radio, is the one with
 * `tabIndex={0}`.
 */
import type { KeyboardEvent } from 'react'

interface RovingOptions {
  /** A toolbar moves on ← and → only; a radio group on all four arrows. Default `horizontal`. */
  readonly orientation?: 'horizontal' | 'both'
  /** Radio groups: the item that takes focus is chosen too, as a click would. */
  readonly select?: boolean
}

/** Handles the key when it is one of the widget's; returns the item that took focus. */
export function moveFocus(event: KeyboardEvent<HTMLElement>, items: string, { orientation = 'horizontal', select = false }: RovingOptions = {}): HTMLElement | undefined {
  const forward = event.key === 'ArrowRight' || (orientation === 'both' && event.key === 'ArrowDown')
  const back = event.key === 'ArrowLeft' || (orientation === 'both' && event.key === 'ArrowUp')
  if (!forward && !back && event.key !== 'Home' && event.key !== 'End') return undefined
  if (event.metaKey || event.ctrlKey || event.altKey) return undefined
  const list = [...event.currentTarget.querySelectorAll<HTMLElement>(items)].filter((item) => item.getClientRects().length > 0 && !item.matches(':disabled'))
  if (list.length === 0) return undefined
  const at = list.findIndex((item) => item === document.activeElement || item.contains(document.activeElement))
  const last = list.length - 1
  const index = event.key === 'Home' ? 0 : event.key === 'End' ? last : forward ? (at + 1) % list.length : at <= 0 ? last : at - 1
  const next = list[index]
  if (next === undefined) return undefined
  event.preventDefault()
  event.stopPropagation()
  next.focus()
  if (select && next.getAttribute('aria-checked') !== 'true') next.click()
  return next
}

/** A radio group's keys, for its `onKeyDown`: every arrow moves to the next or previous choice and chooses it; Home and End go to the ends. */
export function radioKeys(event: KeyboardEvent<HTMLElement>): void {
  moveFocus(event, '[role="radio"]', { orientation: 'both', select: true })
}

/**
 * Turns a toggle control (`Button`, `IconButton`, `Swatch`) into one radio
 * of a `role="radiogroup"`: `aria-checked` in place of `aria-pressed`, and
 * only the chosen one, or the first when none is, in the Tab order. Spread
 * it after the control's own props; keep `pressed` or `selected` for the look.
 */
export function radioItem(checked: boolean, tabbable: boolean) {
  return { role: 'radio', 'aria-checked': checked, 'aria-pressed': undefined, tabIndex: tabbable ? 0 : -1 } as const
}
