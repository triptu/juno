import * as stylex from '@stylexjs/stylex'
import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { accent, menu, spacing, z } from '@juno/tokens/tokens.stylex'
import { Icon, type PhosphorIcon } from './Icon'
import { tooltip } from './Tooltip'
import { MorphLayers } from './internal/MorphLayers'
import { useMenuState } from './internal/menuMorph'
import { highlight, menuKey, ownsFocus, SHORTCUT_KEYS } from './internal/menuKeys'
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
  /**
   * A second action on the row, drawn as an icon at its end in place of a
   * key equivalent: Copy Slack link on Open in Slack. It is its own menu
   * item: → from the row reaches it, ← goes back, and choosing it calls
   * `onSelect` with its id. Not shown on a disabled row.
   */
  readonly trailing?: ContextMenuTrailing
}

/** A row's trailing action: `label` is its accessible name and tooltip. */
export interface ContextMenuTrailing {
  readonly id: string
  readonly label: string
  readonly icon: PhosphorIcon
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
  /** The panel shows in its place at once, with no motion: a menu opened as the panel (R on a message). */
  readonly morphAtOnce?: boolean
  /**
   * Drawn inside its parent, which stands in for the window, with no focus
   * move and nothing outside closing it: the gallery's fixtures. The parent
   * is positioned and sized.
   */
  readonly inline?: boolean
}

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
export function ContextMenu({ anchor, items, header, label, onSelect, onClose, panelWidth, morph, morphAtOnce = false, inline = false }: ContextMenuProps) {
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
        <MorphLayers root={ref} menu={state} view={view} from={content} material={styles.material} body={styles.body} atOnce={morphAtOnce}>
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

/**
 * One row: a click, or Enter while it has focus, chooses it. A row with a
 * trailing action is two items side by side in one highlight, which shows
 * while either has focus; the trailing one has its own fill when it does.
 */
function Row({ item, onSelect }: { readonly item: ContextMenuItem; readonly onSelect: ContextMenuProps['onSelect'] }) {
  const trailing = item.disabled === true ? undefined : item.trailing
  if (trailing === undefined) return <RowItem item={item} onSelect={onSelect} />
  return (
    <div role="none" data-menu-pair="" {...stylex.props(styles.row, styles.pair)}>
      <RowItem item={item} onSelect={onSelect} lead />
      <div
        role="menuitem"
        tabIndex={-1}
        data-menu-trailing={trailing.id}
        aria-label={trailing.label}
        {...tooltip(trailing.label)}
        onClick={(event) => onSelect(trailing.id, { metaKey: event.metaKey })}
        {...stylex.props(styles.trailing)}
      >
        <Icon icon={trailing.icon} size={14} />
      </div>
    </div>
  )
}

function RowItem({ item, onSelect, lead = false }: { readonly item: ContextMenuItem; readonly onSelect: ContextMenuProps['onSelect']; readonly lead?: boolean }) {
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
      {...stylex.props(lead ? styles.lead : styles.row, item.disabled === true && styles.disabled)}
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
  // The highlight is focus, set by the pointer and the arrows alike, so plain :focus (not a focus ring); :focus-within
  // so a row with a trailing action stays highlighted while the action has focus.
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: menu['--menu-icon-gap'],
    height: menu['--menu-row-height'],
    paddingInline: menu['--menu-row-inset'],
    borderRadius: menu['--menu-row-radius'],
    whiteSpace: 'nowrap',
    outline: 'none',
    backgroundColor: { default: 'transparent', ':focus-within': accent['--hl'] },
    color: { default: 'inherit', ':focus-within': accent['--hl-fg'] },
    '--menu-row-icon': { default: menu['--menu-icon'], ':focus-within': accent['--hl-fg'] },
  },
  // Its two items take the row's room: the row's item from the start edge, the trailing action at the end.
  pair: {
    gap: 0,
    paddingInline: 0,
  },
  lead: {
    display: 'flex',
    alignItems: 'center',
    alignSelf: 'stretch',
    flexGrow: 1,
    gap: menu['--menu-icon-gap'],
    paddingInlineStart: menu['--menu-row-inset'],
    outline: 'none',
  },
  // Its icon ends where a key equivalent would, the row inset from the highlight's edge.
  trailing: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: menu['--menu-trailing-size'],
    height: menu['--menu-trailing-size'],
    marginInlineStart: `calc(${menu['--menu-shortcut-gap']} - (${menu['--menu-trailing-size']} - ${menu['--menu-icon-size']}) / 2)`,
    marginInlineEnd: `calc(${menu['--menu-row-inset']} - (${menu['--menu-trailing-size']} - ${menu['--menu-icon-size']}) / 2)`,
    borderRadius: menu['--menu-trailing-radius'],
    outline: 'none',
    color: 'var(--menu-row-icon)',
    backgroundColor: { default: 'transparent', ':focus': menu['--menu-trailing-hover'] },
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
