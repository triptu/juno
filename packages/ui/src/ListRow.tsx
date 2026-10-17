import * as stylex from '@stylexjs/stylex'
import type { HTMLAttributes, ReactNode } from 'react'
import { accent, colors, layout, radii, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { activateHandlers, type ActivateEvent } from './internal/activate'
import { focusRing } from './focusRing'

const HOVER = '@media (hover: hover)'

export type ListRowHeight = 32 | 44 | 48 | 52

export interface ListRowProps extends Omit<HTMLAttributes<HTMLDivElement>, 'style' | 'className' | 'onSelect' | 'onClick' | 'onPointerDown' | 'onKeyDown'> {
  readonly minHeight?: ListRowHeight
  readonly leading?: ReactNode
  readonly trailing?: ReactNode
  /**
   * Makes the row a focusable button with a hover background. Fires on
   * mouse down (see internal/activate.ts); check `metaKey` for ⌘-click.
   */
  readonly onSelect?: (event: ActivateEvent) => void
  /**
   * The row is the current one (selected background). Muted text inside a
   * selected row renders as subtle, because muted fails contrast on the
   * secondary fill.
   */
  readonly selected?: boolean
  /** Draw the 1px rule under the row. Default true. */
  readonly divider?: boolean
  /** Padding preset: `settings` 8 14 (the same inset at both ends), `table` 8 12, `log` 6 4, `navigation` 0 12 with a fixed leading slot and 8px gap. */
  readonly padding?: 'settings' | 'table' | 'log' | 'navigation'
  /**
   * When the text would get narrower than `--list-row-wrap-min`, the
   * trailing controls move to a line of their own under it, at the start,
   * and wrap there too. For rows whose controls are wide (a settings row
   * with days and times).
   */
  readonly wrap?: boolean
  readonly children?: ReactNode
}

/**
 * A generic row for settings groups, logs and tables. Feature components
 * build their rows on it.
 */
export function ListRow({
  minHeight = 48,
  leading,
  trailing,
  onSelect,
  selected = false,
  divider = true,
  padding = 'settings',
  wrap = false,
  children,
  ...rest
}: ListRowProps) {
  const isButton = onSelect !== undefined
  return (
    <div
      {...rest}
      // After `rest`, so an owner cannot undo the row's semantics by accident.
      role={isButton ? 'button' : undefined}
      tabIndex={isButton ? 0 : undefined}
      aria-pressed={isButton && selected ? true : undefined}
      {...activateHandlers<HTMLDivElement>(onSelect)}
      {...stylex.props(
        styles.row,
        heights[minHeight],
        paddings[padding],
        divider && styles.divider,
        isButton && focusRing.inset,
        isButton && styles.button,
        selected && styles.selected,
        padding === 'navigation' && styles.navigation,
        padding === 'navigation' && selected && styles.navigationSelected,
        wrap && styles.wrap,
      )}
    >
      {leading !== undefined ? <span {...stylex.props(styles.leading, padding === 'navigation' && styles.navigationLeading)}>{leading}</span> : null}
      <span {...stylex.props(styles.body, padding === 'navigation' && styles.navigationBody, wrap && styles.wrapBody)}>{children}</span>
      {trailing !== undefined ? <span {...stylex.props(styles.trailing, wrap && styles.wrapTrailing)}>{trailing}</span> : null}
    </div>
  )
}

const styles = stylex.create({
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-3'],
    minWidth: 0,
    // Rows are independent layout and paint units (docs/performance.md).
    contain: 'content',
    userSelect: 'none',
    color: colors['--foreground-default'],
  },
  navigation: {
    gap: spacing['--space-2'],
    borderRadius: radii['--radius-xl'],
  },
  // The sidebar's current-row fill (NavItem), so a picked row reads apart
  // from a hovered one beside it.
  navigationSelected: {
    backgroundColor: {
      default: accent['--hl-nav'],
      ':hover': { default: null, [HOVER]: accent['--hl-nav'] },
    },
  },
  navigationLeading: {
    width: sizes['--control-20'],
  },
  navigationBody: {
    gap: spacing['--space-1'],
  },
  divider: {
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: colors['--border-subtle'],
  },
  button: {
    borderRadius: radii['--radius-3xl'],
    backgroundColor: {
      default: 'transparent',
      ':hover': { default: null, [HOVER]: colors['--surface-hover'] },
    },
  },
  // Muted text fails contrast on a secondary fill (tokens.md 1.7), so the
  // selected row points --foreground-muted at the subtle value for its
  // subtree. It is a plain variable override on this element, not a theme:
  // a createTheme would re-emit every colour and undo dark mode here.
  selected: {
    backgroundColor: colors['--secondary-default'],
    '--foreground-muted': colors['--foreground-subtle'],
  },
  leading: {
    display: 'inline-flex',
    alignItems: 'center',
    flexShrink: 0,
    color: colors['--foreground-muted'],
  },
  body: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-3'],
    flexGrow: 1,
    minWidth: 0,
  },
  trailing: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-2'],
    flexShrink: 0,
    marginInlineStart: 'auto',
  },
  wrap: {
    flexWrap: 'wrap',
    rowGap: spacing['--space-2'],
  },
  // A zero basis: the text takes the room the controls leave, and the row wraps only below the minimum.
  wrapBody: {
    flexBasis: 0,
    minWidth: layout['--list-row-wrap-min'],
  },
  // Beside the text, the growing text keeps it at the end; on its own line it starts under the text.
  wrapTrailing: {
    flexWrap: 'wrap',
    flexShrink: 1,
    minWidth: 0,
    maxWidth: '100%',
    marginInlineStart: 0,
  },
})

const heights = stylex.create({
  32: { minHeight: sizes['--control-32'] },
  44: { minHeight: sizes['--row-44'] },
  48: { minHeight: sizes['--row-48'] },
  52: { minHeight: sizes['--row-52'] },
})

const paddings = stylex.create({
  navigation: {
    paddingBlock: 0,
    paddingInline: spacing['--space-3'],
  },
  // The same 14px at both ends: a row's text starts where its last control ends from the other edge.
  settings: {
    paddingBlock: spacing['--space-2'],
    paddingInline: spacing['--space-3-5'],
  },
  table: {
    paddingBlock: spacing['--space-2'],
    paddingInline: spacing['--space-3'],
  },
  log: {
    paddingBlock: spacing['--space-1-5'],
    paddingInline: spacing['--space-1'],
  },
})
