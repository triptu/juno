import * as stylex from '@stylexjs/stylex'
import { Check } from '@phosphor-icons/react/dist/icons/Check'
import { flushSync } from 'react-dom'
import { createContext, useCallback, useContext, useState, type HTMLAttributes, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { accent, colors, radii, sizes, spacing, text, weights } from '@juno/tokens/tokens.stylex'
import { Divider } from './Divider'
import { activateHandlers, type ActivateEvent } from './internal/activate'
import { focusRing } from './focusRing'
import { Icon } from './Icon'
import { variants as typeVariants } from './internal/type'
import { Text } from './Text'

export interface OptionListProps extends Omit<HTMLAttributes<HTMLDivElement>, 'style' | 'className' | 'role' | 'onKeyDown'> {
  /** `listbox` for pickers and suggestions, `menu` for action lists. */
  readonly role?: 'listbox' | 'menu'
  readonly label?: string
  /** The active (highlighted) row, as `OptionRow` ids. Sets aria-activedescendant. */
  readonly activeId?: string
  /**
   * Make the list itself focusable and handle arrow keys on it. Lists that
   * sit over an input leave this off and use `useOptionListKeys` on the input.
   */
  readonly focusable?: boolean
  readonly onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void
  readonly children?: ReactNode
}

// Rows read the list's role so a menu gets menuitems and a listbox options.
const ListRole = createContext<'listbox' | 'menu'>('listbox')

/**
 * The vertical list used by menus, pickers, suggestions and the palette.
 * Dumb: the owner tracks the active id and handles selection. The pointer
 * and the keyboard share that one active row, as in a native menu: rows
 * have no hover style of their own, and moving the pointer over a row
 * makes it active (`onActivate`). The list opts out of the window's drag
 * region, so a menu that hangs off the title bar still gets the pointer.
 */
export function OptionList({ role = 'listbox', label, activeId, focusable = false, onKeyDown, children, ...rest }: OptionListProps) {
  return (
    <ListRole.Provider value={role}>
      <div
        role={role}
        aria-label={label}
        aria-activedescendant={activeId}
        tabIndex={focusable ? 0 : undefined}
        onKeyDown={onKeyDown}
        {...rest}
        {...stylex.props(styles.list, focusable && focusRing.outside)}
      >
        {children}
      </div>
    </ListRole.Provider>
  )
}

/** 44 and 55 are two-line rows: the label over `sub`. */
export type OptionRowSize = 30 | 32 | 34 | 36 | 40 | 44 | 55

export interface OptionRowProps {
  readonly id: string
  readonly leading?: ReactNode
  readonly label: ReactNode
  /** Secondary text, inline after the label or on a second line (55px rows). */
  readonly sub?: ReactNode
  readonly subPlacement?: 'inline' | 'below' | 'end'
  readonly trailing?: ReactNode
  /** Highlighted by the keyboard or the pointer: the list's one active row. */
  readonly active?: boolean
  /** The current value: accent text and a check at the end, as a Mac pop-up menu marks its item. Only `active` fills a row. */
  readonly selected?: boolean
  readonly disabled?: boolean
  readonly size?: OptionRowSize
  /**
   * For a 32px row whose label wraps to a second line under its first (the account menu's hint under a label): the
   * leading icon stays centred on the first line, in the 32px a one-line row gives it, instead of between the lines.
   */
  readonly leadingOnFirstLine?: boolean
  /** Fires on mouse down (see internal/activate.ts); `metaKey` for ⌘-click. */
  readonly onSelect?: (event: ActivateEvent) => void
  /** Called when the pointer moves over the row, so the owner can move `active`. Rows without it show no pointer highlight. */
  readonly onActivate?: () => void
  readonly onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void
}

/**
 * One row. Selects on mouse down and keeps focus where it is, so an input
 * that owns the list keeps typing focus.
 */
export function OptionRow({
  id,
  leading,
  label,
  sub,
  subPlacement = 'end',
  trailing,
  active = false,
  selected = false,
  disabled = false,
  size = 32,
  leadingOnFirstLine = false,
  onSelect,
  onActivate,
  onContextMenu,
}: OptionRowProps) {
  const twoLine = size === 44 || size === 55
  const listRole = useContext(ListRole)
  // The keyboard highlight is announced through aria-activedescendant on the
  // list; aria-selected is only the real selection, and only in a listbox.
  return (
    <div
      id={id}
      role={listRole === 'menu' ? 'menuitem' : 'option'}
      aria-selected={listRole === 'menu' ? undefined : selected}
      // A menu has no selection state; the checked row is the current one (the Juno switcher's page).
      aria-current={listRole === 'menu' && selected ? 'true' : undefined}
      aria-disabled={disabled || undefined}
      {...activateHandlers<HTMLDivElement>(onSelect, { keepFocus: true, disabled })}
      // Synchronous, so the highlight follows the pointer in the next frame as a hover style would;
      // React would otherwise render a pointer-move update later. Nothing runs while the row is already active.
      onPointerMove={onActivate === undefined || active ? undefined : () => flushSync(onActivate)}
      onContextMenu={onContextMenu}
      {...stylex.props(
        styles.row,
        rowSizes[size],
        twoLine && styles.rowTwoLine,
        size === 44 && styles.rowTwoLineCompact,
        leadingOnFirstLine && styles.rowStart,
        active && styles.rowActive,
        selected && styles.rowSelected,
        disabled && styles.rowDisabled,
      )}
    >
      {leading ? <span {...stylex.props(styles.leading, leadingOnFirstLine && styles.leadingFirstLine)}>{leading}</span> : null}
      <span {...stylex.props(styles.body, twoLine && styles.bodyColumn, size === 44 && styles.bodyColumnCompact)}>
        <span data-option-label="" {...stylex.props(styles.label, twoLine ? typeVariants.body : typeVariants.ui, size === 44 && styles.labelCompact)}>{label}</span>
        {sub !== undefined && subPlacement !== 'end' ? (
          <span {...stylex.props(styles.sub, subPlacement === 'below' ? typeVariants.meta : typeVariants.tag, size === 44 && styles.subCompact)}>{sub}</span>
        ) : null}
      </span>
      {sub !== undefined && subPlacement === 'end' ? <span {...stylex.props(styles.subEnd, typeVariants.tag)}>{sub}</span> : null}
      {trailing || selected ? (
        <span {...stylex.props(styles.trailing)}>
          {trailing}
          {selected ? <Icon icon={Check} size={14} weight="bold" /> : null}
        </span>
      ) : null}
    </div>
  )
}

export interface OptionGroupLabelProps {
  readonly children: ReactNode
}

/** Section heading inside a list: PEOPLE, CHANNELS, RECENT. */
export function OptionGroupLabel({ children }: OptionGroupLabelProps) {
  return (
    <Text variant="sectionLabel" tone="muted" as="div" sx={styles.groupLabel}>
      {children}
    </Text>
  )
}

/** Separator between groups of rows. */
export function OptionSeparator() {
  return (
    <div {...stylex.props(styles.separator)}>
      <Divider />
    </div>
  )
}

export interface OptionHeaderProps {
  readonly leading?: ReactNode
  readonly title: ReactNode
  readonly sub?: ReactNode
}

/** Header above a list: avatar plus name and workspace. */
export function OptionHeader({ leading, title, sub }: OptionHeaderProps) {
  return (
    <div {...stylex.props(styles.header)}>
      {leading}
      <span {...stylex.props(styles.headerText)}>
        <Text variant="ui" weight="semibold" truncate>
          {title}
        </Text>
        {sub !== undefined ? (
          <Text variant="meta" tone="muted" truncate>
            {sub}
          </Text>
        ) : null}
      </span>
    </div>
  )
}

/**
 * The active row of a menu that owns its list (the avatar menu, the Juno
 * menu): the arrow keys and the pointer move the same row, and the pointer
 * leaving the list clears it, as a native menu does. Spread `list` on the
 * OptionList and `row(id)` on each OptionRow.
 */
export function useMenuActive(ids: ReadonlyArray<string>, onSelect: (id: string) => void) {
  const [active, setActive] = useState<string | undefined>(undefined)
  const onKeyDown = useOptionListKeys({ ids, activeId: active, onActiveChange: setActive, onSelect })
  return {
    list: { activeId: active, focusable: true, onKeyDown, onPointerLeave: () => setActive(undefined) },
    row: (id: string) => ({ id, active: active === id, onActivate: () => setActive(id) }),
  }
}

export interface OptionListKeysOptions {
  readonly ids: ReadonlyArray<string>
  readonly activeId: string | undefined
  readonly onActiveChange: (id: string) => void
  readonly onSelect: (id: string) => void
  readonly onClose?: () => void
  /** Keys that also select, besides Enter. Tab for @ suggestions. */
  readonly selectKeys?: ReadonlyArray<string>
}

/**
 * Keyboard handling for an OptionList: ArrowUp/Down move (wrapping), Home/End
 * jump, Enter selects, Escape closes. Attach the result to the input or the
 * list.
 */
export function useOptionListKeys({ ids, activeId, onActiveChange, onSelect, onClose, selectKeys = [] }: OptionListKeysOptions) {
  return useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (ids.length === 0) {
        if (event.key === 'Escape' && onClose) {
          event.preventDefault()
          onClose()
        }
        return
      }
      const index = activeId === undefined ? -1 : ids.indexOf(activeId)
      const at = (position: number) => ids[(position + ids.length) % ids.length] as string
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault()
          onActiveChange(at(index + 1))
          return
        case 'ArrowUp':
          event.preventDefault()
          onActiveChange(at(index <= 0 ? ids.length - 1 : index - 1))
          return
        case 'Home':
          event.preventDefault()
          onActiveChange(at(0))
          return
        case 'End':
          event.preventDefault()
          onActiveChange(at(ids.length - 1))
          return
        case 'Escape':
          if (onClose) {
            event.preventDefault()
            onClose()
          }
          return
        default:
          if (event.key === 'Enter' || selectKeys.includes(event.key)) {
            const id = activeId ?? ids[0]
            if (id !== undefined) {
              event.preventDefault()
              onSelect(id)
            }
          }
      }
    },
    [ids, activeId, onActiveChange, onSelect, onClose, selectKeys],
  )
}

const styles = stylex.create({
  list: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    outlineOffset: `calc(-1 * ${sizes['--focus-ring-width']})`,
    WebkitAppRegion: 'no-drag',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2-5'],
    paddingInline: spacing['--space-2'],
    borderRadius: radii['--radius-md'],
    color: colors['--foreground-default'],
    userSelect: 'none',
    minWidth: 0,
    flexShrink: 0,
    contain: 'content',
    backgroundColor: 'transparent',
  },
  rowTwoLine: {
    gap: spacing['--space-3'],
    paddingBlock: spacing['--space-2'],
    paddingInline: spacing['--space-2-5'],
    borderRadius: radii['--radius-lg'],
  },
  rowTwoLineCompact: {
    gap: spacing['--space-2-5'],
    paddingBlock: spacing['--space-1'],
  },
  rowActive: {
    backgroundColor: colors['--surface-hover'],
  },
  // No fill of its own, so the pointer's or the keyboard's row is the only filled one. A label drawn by a `Text` reads the variable.
  rowSelected: {
    color: accent['--hl-text'],
    '--foreground-default': accent['--hl-text'],
  },
  rowDisabled: {
    color: colors['--foreground-muted'],
  },
  leading: {
    display: 'inline-flex',
    flexShrink: 0,
    color: colors['--foreground-subtle'],
  },
  rowStart: {
    alignItems: 'flex-start',
  },
  // The first line's 32px, the height a one-line row centres its icon in.
  leadingFirstLine: {
    alignItems: 'center',
    height: sizes['--control-32'],
  },
  body: {
    display: 'flex',
    alignItems: 'baseline',
    gap: spacing['--space-1-5'],
    flexGrow: 1,
    minWidth: 0,
  },
  bodyColumn: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: spacing['--space-0-5'],
  },
  // A 44px row: the two lines on fixed leadings with no gap, 4 + 20 + 16 + 4.
  // A label given as a Text takes it with `lineHeight: 'inherit'`.
  bodyColumnCompact: {
    gap: 0,
  },
  labelCompact: {
    lineHeight: text['--text-option-title-leading'],
  },
  subCompact: {
    lineHeight: text['--text-option-meta-leading'],
  },
  label: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    minWidth: 0,
  },
  sub: {
    color: colors['--foreground-muted'],
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    minWidth: 0,
    fontWeight: weights['--weight-regular'],
  },
  subEnd: {
    color: colors['--foreground-muted'],
    flexShrink: 0,
    fontWeight: weights['--weight-regular'],
  },
  trailing: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-1-5'],
    flexShrink: 0,
    marginInlineStart: 'auto',
  },
  groupLabel: {
    paddingBlock: `${spacing['--space-2']} ${spacing['--space-1']}`,
    paddingInline: spacing['--space-2-5'],
  },
  separator: {
    paddingBlock: spacing['--space-1'],
    paddingInline: spacing['--space-1-5'],
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2-5'],
    paddingBlock: `${spacing['--space-2']} ${spacing['--space-2-5']}`,
    paddingInline: spacing['--space-2'],
    minWidth: 0,
  },
  headerText: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
  },
})

const rowSizes = stylex.create({
  30: { minHeight: sizes['--control-30'] },
  32: { minHeight: sizes['--control-32'] },
  34: { minHeight: sizes['--control-34'] },
  36: { minHeight: sizes['--control-36'] },
  40: { minHeight: sizes['--control-40'] },
  44: { minHeight: sizes['--control-44'] },
  55: { minHeight: 'auto' },
})
