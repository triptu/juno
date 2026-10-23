import * as stylex from '@stylexjs/stylex'
import { useLayoutEffect, useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { accent, menu, spacing, z } from '@juno/tokens/tokens.stylex'
import { Icon, type PhosphorIcon } from './Icon'
import { MorphLayers } from './internal/MorphLayers'
import { useMenuState } from './internal/menuMorph'
import { placeMenu, useDismiss, type MenuPoint } from './internal/menuPlacement'

export type { MenuPoint } from './internal/menuPlacement'

export interface ContextMenuItem {
  readonly id: string
  /** Sentence case, verb first (SPEC 17). */
  readonly label: string
  readonly icon?: PhosphorIcon
  readonly disabled?: boolean
  /**
   * Its key equivalent, shown at the row's end as a macOS menu shows one: a
   * letter ("E"), or ⌫ for Delete and Backspace. Pressing it while the menu
   * is open chooses the row. Only for a key that does the same outside the menu.
   */
  readonly shortcut?: string
}

export type ContextMenuEntry = ContextMenuItem | { readonly separator: true }

export interface ContextMenuProps {
  /** The pointer, or a point under the focused row's first line: the menu's top left, or top right when it opens to the left. */
  readonly anchor: MenuPoint
  readonly items: ReadonlyArray<ContextMenuEntry>
  /** Above the rows: the emoji grid. Its cells are buttons with `data-menu-cell`, in rows of `data-menu-columns`. */
  readonly header?: ReactNode
  /** The menu's accessible name. */
  readonly label: string
  /** A row was chosen; `metaKey` with ⌘ held, which some rows read as "in a new tab". */
  readonly onSelect: (id: string, how: { readonly metaKey: boolean }) => void
  readonly onClose: () => void
  /**
   * The width of the panel the menu may turn into (`morph`), a CSS length
   * (a token). The menu opens on the side of the pointer that has room for
   * it, so the panel can grow from the menu without sliding.
   */
  readonly panelWidth?: string
  /**
   * The menu has become this panel (the emoji picker, sized by itself): it
   * grows from the menu's box into its own while the menu's content fades
   * out and its own fades in, one corner of the menu staying put
   * (`internal/menuMorph.ts`). Its keys are its own (`data-menu-own-keys`), Esc aside.
   */
  readonly morph?: ReactNode
  /**
   * Drawn inside its parent, which stands in for the window, with no focus
   * move and nothing outside closing it: the gallery's fixtures. The parent
   * is positioned and sized.
   */
  readonly inline?: boolean
}

const ITEM = '[role="menuitem"]:not([aria-disabled="true"])'
const CELL = '[data-menu-cell]'
/** A part that takes its own keys and focus: the emoji picker the menu turned into. */
const OWN_KEYS = '[data-menu-own-keys]'
/** How long typed letters add up before they start a new search, as in a macOS menu. */
const TYPE_AHEAD_MS = 1000
/** The keys a shown key equivalent stands for, beyond its own letter. */
const SHORTCUT_KEYS: Readonly<Record<string, ReadonlyArray<string>>> = { '⌫': ['Backspace', 'Delete'] }
const pressed = (shortcut: string, key: string) => (SHORTCUT_KEYS[shortcut] ?? [shortcut.toLowerCase()]).includes(key.length === 1 ? key.toLowerCase() : key)

const isItem = (entry: ContextMenuEntry): entry is ContextMenuItem => !('separator' in entry)

/**
 * A context menu drawn like the macOS one (primitives.md, ContextMenu): it
 * shows in the frame it is asked for, with no fade or scale, in the menu
 * material, opening downward from the pointer. It may turn into a larger
 * panel in motion (`morph`). The highlight is focus: the pointer focuses
 * the row it moves over, and the arrows move it, so the two never disagree.
 * A click or Enter chooses; typed letters jump to a row. Esc, a press or
 * a wheel turn outside, the window losing focus or resizing close it. One
 * instance for the window, rendered on demand in a portal on `body`.
 */
export function ContextMenu({ anchor, items, header, label, onSelect, onClose, panelWidth, morph, inline = false }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  const typed = useRef({ text: '', at: 0 })
  useLayoutEffect(() => {
    closeRef.current = onClose
  })
  const morphing = morph !== undefined && morph !== null
  const view = () => viewOf(ref.current, inline)

  // Placed before the first paint, so it shows where it stays. One read of its size.
  useLayoutEffect(() => {
    const node = ref.current
    if (node === null) return
    const style = getComputedStyle(node)
    const edge = Number.parseFloat(style.getPropertyValue('--menu-edge')) || 0
    const room = { width: Number.parseFloat(style.getPropertyValue('--menu-grows-width')) || 0, height: 0 }
    const { x, y, side } = placeMenu(anchor, { width: node.offsetWidth, height: node.offsetHeight }, room, viewOf(node, inline), edge)
    node.dataset['menuSide'] = side
    node.style.left = `${x}px`
    node.style.top = `${y}px`
    node.style.visibility = 'visible'
  }, [anchor, inline])
  const state = useMenuState(ref, morphing)

  // Keys go to the menu while it is open. Focus goes back where it was if nothing else took it: to a field, or to
  // what had keyboard focus (a menu opened from the keyboard). A row a right-click focused gets no ring after.
  useLayoutEffect(() => {
    const node = ref.current
    const before = document.activeElement
    if (inline) return
    const restore = before instanceof HTMLElement && before.matches(':focus-visible, input, textarea, [contenteditable="true"]')
    node?.focus({ preventScroll: true })
    return () => {
      const now = document.activeElement
      if (now !== null && now !== document.body && node?.contains(now) !== true) return
      if (restore && before.isConnected) before.focus({ preventScroll: true })
      else node?.blur()
    }
  }, [inline])

  useDismiss(ref, closeRef, inline)

  const content = <MenuContent header={header} items={items} onSelect={onSelect} />
  const element = (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      data-context-menu=""
      data-morphed={morphing ? '' : undefined}
      onKeyDown={(event) => menuKey(event, onClose, typed.current)}
      onContextMenu={(event) => event.preventDefault()}
      // The pointer's row is the highlighted one; leaving every row clears it, as in a macOS menu.
      onPointerMove={(event) => highlight(event, ref.current)}
      onPointerLeave={() => {
        if (!ownsFocus(ref.current)) ref.current?.focus({ preventScroll: true })
      }}
      {...stylex.props(
        styles.menu,
        inline && styles.inline,
        !morphing && styles.material,
        !morphing && styles.body,
        morphing && styles.morphed,
        panelWidth !== undefined && styles.grows(panelWidth),
      )}
    >
      {morphing ? (
        <MorphLayers root={ref} menu={state} view={view} from={content} material={styles.material} body={styles.body}>
          {morph}
        </MorphLayers>
      ) : (
        content
      )}
    </div>
  )
  return inline ? element : createPortal(element, document.body)
}

/** The box the menu lives in: the window, or the positioned parent that stands in for it in the gallery. */
function viewOf(node: HTMLElement | null, inline: boolean): { readonly width: number; readonly height: number } {
  const parent = inline ? node?.offsetParent : null
  return parent instanceof HTMLElement ? { width: parent.clientWidth, height: parent.clientHeight } : { width: window.innerWidth, height: window.innerHeight }
}

/** The header, then the rows. Two separators in a row, or one at an end, never show. */
function MenuContent({ header, items, onSelect }: Pick<ContextMenuProps, 'header' | 'items' | 'onSelect'>) {
  return (
    <>
      {header}
      {items.map((entry, i) =>
        isItem(entry) ? (
          <Row key={entry.id} item={entry} onSelect={onSelect} />
        ) : i === 0 || i === items.length - 1 || !isItem(items[i - 1]!) ? null : (
          <div key={`separator-${i}`} role="separator" {...stylex.props(styles.separator)} />
        ),
      )}
    </>
  )
}

/** One row: a click, or Enter while it has focus, chooses it. */
function Row({ item, onSelect }: { readonly item: ContextMenuItem; readonly onSelect: ContextMenuProps['onSelect'] }) {
  return (
    <div
      role="menuitem"
      tabIndex={-1}
      aria-disabled={item.disabled === true ? true : undefined}
      data-menu-item={item.id}
      data-menu-shortcut={item.shortcut}
      aria-keyshortcuts={item.shortcut === undefined ? undefined : (SHORTCUT_KEYS[item.shortcut] ?? [item.shortcut]).join(' ')}
      onClick={(event) => {
        if (item.disabled !== true) onSelect(item.id, { metaKey: event.metaKey })
      }}
      {...stylex.props(styles.row, item.disabled === true && styles.disabled)}
    >
      <span {...stylex.props(styles.icon)}>{item.icon === undefined ? null : <Icon icon={item.icon} size={14} />}</span>
      <span {...stylex.props(styles.label)}>{item.label}</span>
      {item.shortcut === undefined ? null : (
        <span aria-hidden {...stylex.props(styles.shortcut)}>
          {item.shortcut}
        </span>
      )}
    </div>
  )
}

/**
 * The menu's keys. ↓ from the menu goes to the grid's first cell, ↑ to the
 * last row; ↑ ↓ then move through the grid's rows and the menu's rows, and
 * ← → along the grid. Enter or Space chooses, Esc closes, Tab stays, a
 * row's key equivalent chooses it, and letters typed within a second of each
 * other jump to the first row whose label starts with them.
 */
function menuKey(event: KeyboardEvent<HTMLDivElement>, onClose: () => void, typed: { text: string; at: number }): void {
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
  const row = at === null ? -1 : rows.indexOf(at)
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
      return cell >= 0 ? focus(cells[Math.min(cell + 1, cells.length - 1)]) : undefined
    case 'ArrowLeft':
      return cell >= 0 ? focus(cells[Math.max(cell - 1, 0)]) : undefined
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
  // ⌫ always; a letter only as the first key, so typing on into a label still works.
  const equivalent = fresh || event.key.length !== 1 ? rows.find((node) => node.dataset['menuShortcut'] !== undefined && pressed(node.dataset['menuShortcut'], event.key)) : undefined
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
const ownsFocus = (root: HTMLElement | null) => document.activeElement?.closest(OWN_KEYS) != null && root?.contains(document.activeElement) === true

/**
 * Focuses the enabled row or cell under the pointer, or the menu itself over
 * a gap or a disabled row. Over the panel the menu turned into, focus stays
 * where it is, so typing keeps going to its search field.
 */
function highlight(event: PointerEvent<HTMLDivElement>, root: HTMLDivElement | null): void {
  if (root === null || !(event.target instanceof Element) || ownsFocus(root) || event.target.closest(OWN_KEYS) !== null) return
  const next = event.target.closest<HTMLElement>(`${ITEM}, ${CELL}`) ?? root
  if (document.activeElement !== next) next.focus({ preventScroll: true })
}

const styles = stylex.create({
  menu: {
    position: 'fixed',
    left: 0,
    top: 0,
    // Placed and shown in a layout effect before the first paint.
    visibility: 'hidden',
    zIndex: z['--z-context'],
    boxSizing: 'border-box',
    color: menu['--menu-text'],
    fontFamily: menu['--menu-font'],
    fontSize: menu['--menu-font-size'],
    lineHeight: menu['--menu-line-height'],
    userSelect: 'none',
    cursor: 'default',
    outline: 'none',
    overscrollBehavior: 'contain',
    // Over a title bar's drag strip, which would otherwise take the press.
    WebkitAppRegion: 'no-drag',
  },
  // The room the panel it may turn into needs beside the pointer, read when it is placed.
  grows: (width: string) => ({
    '--menu-grows-width': width,
  }),
  inline: {
    position: 'absolute',
    zIndex: 'auto',
  },
  material: {
    borderRadius: menu['--menu-radius'],
    backgroundColor: menu['--menu-fill'],
    backdropFilter: menu['--menu-backdrop'],
    boxShadow: menu['--menu-shadow'],
  },
  body: {
    display: 'flex',
    flexDirection: 'column',
    boxSizing: 'border-box',
    minWidth: menu['--menu-min-width'],
    maxWidth: 'max-content',
    padding: menu['--menu-padding'],
  },
  // Turned into a panel: its size is the panel's (`MorphLayers`).
  morphed: {
    width: 'max-content',
  },
  // The highlight is focus, set by the pointer and the arrows alike, so plain :focus (not a focus ring).
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: menu['--menu-icon-gap'],
    height: menu['--menu-row-height'],
    paddingInline: menu['--menu-row-inset'],
    borderRadius: menu['--menu-row-radius'],
    whiteSpace: 'nowrap',
    outline: 'none',
    backgroundColor: { default: 'transparent', ':focus': accent['--hl'] },
    color: { default: 'inherit', ':focus': accent['--hl-fg'] },
    '--menu-row-icon': { default: menu['--menu-icon'], ':focus': accent['--hl-fg'] },
  },
  disabled: {
    color: menu['--menu-text-disabled'],
    '--menu-row-icon': menu['--menu-text-disabled'],
  },
  icon: {
    display: 'inline-flex',
    flexShrink: 0,
    width: menu['--menu-icon-size'],
    color: 'var(--menu-row-icon)',
  },
  label: {
    flexGrow: 1,
  },
  // A key equivalent: the icons' colour, at the row's end, as far from the highlight's edge as the icon is on the other side.
  shortcut: {
    flexShrink: 0,
    marginInlineStart: `calc(${menu['--menu-shortcut-gap']} - ${menu['--menu-icon-gap']})`,
    color: 'var(--menu-row-icon)',
  },
  separator: {
    flexShrink: 0,
    height: spacing['--space-pixel'],
    marginBlock: menu['--menu-separator-gap'],
    marginInline: menu['--menu-row-inset'],
    backgroundColor: menu['--menu-separator'],
  },
})
