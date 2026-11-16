/**
 * The Search tab's filter row (SPEC 10a, inventory 9a): From, In, Date and
 * Has, then the sort after a 10px space, then the Apps and Automated
 * toggles at the end. A filter that is set takes the
 * secondary fill. Each menu opens on mouse down under its button; the
 * toggles act on click and say what they do now ("Apps hidden", "Apps
 * shown"). At the smallest widths the toggles wrap to a line of their own.
 */
import { CaretDown } from '@phosphor-icons/react/dist/icons/CaretDown'
import { Eye } from '@phosphor-icons/react/dist/icons/Eye'
import { EyeSlash } from '@phosphor-icons/react/dist/icons/EyeSlash'
import * as stylex from '@stylexjs/stylex'
import type { KeyboardEvent, PointerEvent } from 'react'
import { colors, radii, sizes, spacing, text, weights } from '@juno/tokens/tokens.stylex'
import { contextClick, focusRing, Icon, type PhosphorIcon } from '@juno/ui'

export type SearchFilterMenu = 'from' | 'in' | 'date' | 'has' | 'sort'
export type SearchToggle = 'apps' | 'automated'

export interface SearchFiltersProps {
  /** Which filters the query sets. */
  readonly set: { readonly from: boolean; readonly in: boolean; readonly date: boolean; readonly has: boolean }
  readonly sort: 'newest' | 'oldest'
  readonly hideApps: boolean
  readonly hideAutomated: boolean
  /** Opens a filter's menu at the point under its button. */
  readonly onMenu: (menu: SearchFilterMenu, at: { readonly x: number; readonly y: number }) => void
  readonly onToggle: (toggle: SearchToggle) => void
}

const menus: ReadonlyArray<{ readonly menu: Exclude<SearchFilterMenu, 'sort'>; readonly label: string }> = [
  { menu: 'from', label: 'From' },
  { menu: 'in', label: 'In' },
  { menu: 'date', label: 'Date' },
  { menu: 'has', label: 'Has' },
]

export function SearchFilters({ set, sort, hideApps, hideAutomated, onMenu, onToggle }: SearchFiltersProps) {
  return (
    <div role="toolbar" aria-label="Filters" {...stylex.props(styles.row)}>
      {menus.map(({ menu, label }) => (
        <MenuButton key={menu} label={label} set={set[menu]} onOpen={(at) => onMenu(menu, at)} />
      ))}
      <span {...stylex.props(styles.sort)}>
        <MenuButton label={sort === 'newest' ? 'Newest' : 'Oldest'} accessibleName={`Sort: ${sort === 'newest' ? 'Newest first' : 'Oldest first'}`} set={false} onOpen={(at) => onMenu('sort', at)} />
      </span>
      <span data-search-toggles="" {...stylex.props(styles.toggles)}>
        <ToggleButton icon={hideApps ? EyeSlash : Eye} label={hideApps ? 'Apps hidden' : 'Apps shown'} onToggle={() => onToggle('apps')} />
        <ToggleButton icon={hideAutomated ? EyeSlash : Eye} label={hideAutomated ? 'Automated hidden' : 'Automated shown'} onToggle={() => onToggle('automated')} />
      </span>
    </div>
  )
}

/** The point under a button's start, for a menu that hangs from it. */
const anchorOf = (element: HTMLElement) => {
  const box = element.getBoundingClientRect()
  return { x: Math.round(box.left), y: Math.round(box.bottom + 4) }
}

function MenuButton({ label, accessibleName, set, onOpen }: { readonly label: string; readonly accessibleName?: string; readonly set: boolean; readonly onOpen: (at: { readonly x: number; readonly y: number }) => void }) {
  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || contextClick(event)) return
    event.preventDefault()
    onOpen(anchorOf(event.currentTarget))
  }
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'ArrowDown') return
    event.preventDefault()
    onOpen(anchorOf(event.currentTarget))
  }
  return (
    <button type="button" aria-haspopup="menu" aria-label={accessibleName ?? (set ? `${label}, set` : undefined)} onPointerDown={onPointerDown} onKeyDown={onKeyDown} {...stylex.props(styles.button, styles.menu, set && styles.set, focusRing.outside)}>
      {label}
      <span {...stylex.props(styles.caret)}>
        <Icon icon={CaretDown} size={12} weight="bold" />
      </span>
    </button>
  )
}

/** A toggle whose label says its state ("Apps hidden"), so it is a plain button named by its label. */
function ToggleButton({ icon, label, onToggle }: { readonly icon: PhosphorIcon; readonly label: string; readonly onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} {...stylex.props(styles.button, styles.toggle, focusRing.outside)}>
      <span {...stylex.props(styles.toggleIcon)}>
        <Icon icon={icon} size={13} />
      </span>
      {label}
    </button>
  )
}

const styles = stylex.create({
  row: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing['--space-0-5'],
    rowGap: spacing['--space-1'],
  },
  sort: {
    display: 'flex',
    gap: spacing['--space-0-5'],
    marginInlineStart: spacing['--space-2-5'],
  },
  // At the row's end with at least 12px before them; when the row is too narrow they take a line of their own, from its start.
  toggles: {
    display: 'flex',
    gap: spacing['--space-0-5'],
    marginInlineStart: 'auto',
    paddingInlineStart: spacing['--space-3'],
    '@container search-band (width < 760px)': {
      flexBasis: '100%',
      marginInlineStart: 0,
      paddingInlineStart: 0,
    },
  },
  button: {
    display: 'inline-flex',
    alignItems: 'center',
    height: sizes['--control-26'],
    margin: 0,
    borderWidth: 0,
    borderRadius: radii['--radius-md-plus'],
    backgroundColor: {
      default: 'transparent',
      ':hover': { default: null, '@media (hover: hover)': colors['--surface-hover'] },
      ':active': { default: colors['--secondary-active'], '@media (hover: hover)': colors['--secondary-active'] },
    },
    color: colors['--foreground-subtle'],
    fontFamily: 'inherit',
    fontSize: text['--text-meta-size'],
    fontWeight: weights['--weight-medium'],
    whiteSpace: 'nowrap',
    cursor: 'default',
  },
  menu: {
    gap: spacing['--space-1'],
    paddingInlineStart: spacing['--space-2'],
    paddingInlineEnd: spacing['--space-1'],
  },
  toggle: {
    gap: spacing['--space-1-5'],
    paddingInlineStart: spacing['--space-1-5'],
    paddingInlineEnd: spacing['--space-2'],
  },
  set: {
    backgroundColor: {
      default: colors['--secondary-default'],
      ':hover': { default: null, '@media (hover: hover)': colors['--secondary-hover'] },
      ':active': { default: colors['--secondary-active'], '@media (hover: hover)': colors['--secondary-active'] },
    },
    color: colors['--foreground-default'],
  },
  caret: {
    display: 'flex',
    color: colors['--foreground-muted'],
  },
  toggleIcon: {
    display: 'flex',
    color: colors['--foreground-muted'],
  },
})
