/**
 * The context menu's keys and pointer highlight (`ContextMenu`): which
 * element has focus is the highlight, so both move focus.
 */
import type { KeyboardEvent, PointerEvent } from 'react'
const ITEM = '[role="menuitem"]:not([aria-disabled="true"]):not([data-menu-trailing])'
const CELL = '[data-menu-cell]'
/** A row's trailing action, the row's next sibling. */
const TRAILING = '[data-menu-trailing]'
/** A part that takes its own keys and focus: the emoji picker the menu turned into. */
const OWN_KEYS = '[data-menu-own-keys]'
/** How long typed letters add up before they start a new search, as in a macOS menu. */
const TYPE_AHEAD_MS = 1000
/** The keys a shown key equivalent stands for, beyond its own letter. */
export const SHORTCUT_KEYS: Readonly<Record<string, ReadonlyArray<string>>> = { '⌫': ['Backspace', 'Delete'] }
const pressed = (shortcut: string, key: string) => (SHORTCUT_KEYS[shortcut] ?? [shortcut.toLowerCase()]).includes(key.length === 1 ? key.toLowerCase() : key)

/**
 * The menu's keys. ↓ from the menu goes to the grid's first cell, ↑ to the
 * last row; ↑ ↓ then move through the grid's rows and the menu's rows, and
 * ← → along the grid, and to a row's trailing action and back. Enter or Space chooses, Esc closes, Tab stays, a
 * row's key equivalent chooses it, and letters typed within a second of each
 * other jump to the first row whose label starts with them.
 */
export function menuKey(event: KeyboardEvent<HTMLDivElement>, onClose: () => void, typed: { text: string; at: number }): void {
  const root = event.currentTarget
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    return onClose()
  }
  if (event.key === 'Tab') return event.preventDefault()
  // The panel the menu turned into takes its own keys.
  if (event.target instanceof Element && event.target.closest(OWN_KEYS) !== null) return
  const live = (node: HTMLElement) => node.closest('[inert]') === null
  const rows = Array.from(root.querySelectorAll<HTMLElement>(ITEM)).filter(live)
  const cells = Array.from(root.querySelectorAll<HTMLElement>(CELL)).filter(live)
  const at = document.activeElement instanceof HTMLElement ? document.activeElement : null
  // A trailing action moves up and down as its row does.
  const onTrailing = at?.matches(TRAILING) === true
  const own = onTrailing && at?.previousElementSibling instanceof HTMLElement ? at.previousElementSibling : at
  const row = own === null ? -1 : rows.indexOf(own)
  const next = own?.nextElementSibling
  const trailing = !onTrailing && next instanceof HTMLElement && next.matches(TRAILING) ? next : undefined
  const cell = at === null ? -1 : cells.indexOf(at)
  const columns = Number(root.querySelector<HTMLElement>('[data-menu-columns]')?.dataset['menuColumns'] ?? cells.length) || 1
  const focus = (node: HTMLElement | undefined) => {
    if (node === undefined) return
    event.preventDefault()
    node.focus({ preventScroll: true })
  }
  switch (event.key) {
    case 'ArrowDown':
      if (cell >= 0) return focus(cell + columns < cells.length ? cells[cell + columns] : (rows[0] ?? cells[cell]))
      if (row >= 0) return focus(rows[Math.min(row + 1, rows.length - 1)])
      return focus(cells[0] ?? rows[0])
    case 'ArrowUp':
      if (cell >= 0) return focus(cells[cell - columns] ?? cells[cell])
      if (row > 0) return focus(rows[row - 1])
      if (row === 0) return focus(cells[Math.floor((cells.length - 1) / columns) * columns] ?? rows[0])
      return focus(rows[rows.length - 1] ?? cells[cells.length - 1])
    case 'ArrowRight':
      return cell >= 0 ? focus(cells[Math.min(cell + 1, cells.length - 1)]) : focus(trailing)
    case 'ArrowLeft':
      return cell >= 0 ? focus(cells[Math.max(cell - 1, 0)]) : focus(onTrailing ? (own ?? undefined) : undefined)
    case 'Home':
      return focus(cells[0] ?? rows[0])
    case 'End':
      return focus(rows[rows.length - 1] ?? cells[cells.length - 1])
    case 'Enter':
    case ' ':
      event.preventDefault()
      // ⌘Enter reads as ⌘-click.
      return void at?.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: event.metaKey }))
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return
  const now = performance.now()
  const fresh = now - typed.at > TYPE_AHEAD_MS || typed.text === ''
  // ⌫ always; a letter only as the first key, so typing on into a label still works. A cell can have a key too.
  const equivalent = fresh || event.key.length !== 1 ? [...rows, ...cells].find((node) => node.dataset['menuShortcut'] !== undefined && pressed(node.dataset['menuShortcut'], event.key)) : undefined
  if (equivalent !== undefined) {
    event.preventDefault()
    event.stopPropagation()
    typed.text = ''
    return void equivalent.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  }
  if (event.key.length !== 1) return
  typed.text = (fresh ? '' : typed.text) + event.key.toLowerCase()
  typed.at = now
  focus(rows.find((node) => (node.textContent ?? '').trim().toLowerCase().startsWith(typed.text)))
}

/** Focus is in the panel the menu turned into. */
export const ownsFocus = (root: HTMLElement | null) => document.activeElement?.closest(OWN_KEYS) != null && root?.contains(document.activeElement) === true

/**
 * Focuses the enabled row, trailing action or cell under the pointer (the
 * row in the room around a trailing action), or the menu itself over a gap
 * or a disabled row. Over the panel the menu turned into, focus stays
 * where it is, so typing keeps going to its search field.
 */
export function highlight(event: PointerEvent<HTMLDivElement>, root: HTMLDivElement | null): void {
  if (root === null || !(event.target instanceof Element) || ownsFocus(root) || event.target.closest(OWN_KEYS) !== null) return
  const next = event.target.closest<HTMLElement>(`${ITEM}, ${CELL}, ${TRAILING}`) ?? event.target.closest('[data-menu-pair]')?.querySelector<HTMLElement>(ITEM) ?? root
  if (document.activeElement !== next) next.focus({ preventScroll: true })
}

