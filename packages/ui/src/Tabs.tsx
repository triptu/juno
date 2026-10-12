import * as stylex from '@stylexjs/stylex'
import { X, type LucideIcon } from 'lucide-react'
import type { MouseEvent, ReactNode } from 'react'
import { colors, layout, radii, spacing, weights } from '@juno/tokens/tokens.stylex'
import { Icon } from './Icon'
import { IconButton } from './IconButton'
import { activateHandlers, type ActivateEvent } from './internal/activate'
import { interactive } from './internal/interactive'
import { variants as typeVariants } from './internal/type'

const HOVER = '@media (hover: hover)'

export interface TabStripProps {
  readonly label?: string
  /** The new-tab button, rendered after the last tab. */
  readonly trailing?: ReactNode
  readonly children?: ReactNode
}

/** The 44px strip above the workspace. A window drag region. */
export function TabStrip({ label = 'Tabs', trailing, children }: TabStripProps) {
  return (
    <div role="tablist" aria-label={label} {...stylex.props(styles.strip)}>
      {children}
      {trailing ? <span {...stylex.props(styles.trailing)}>{trailing}</span> : null}
    </div>
  )
}

export interface TabProps {
  readonly icon: LucideIcon
  readonly label: string
  readonly active?: boolean
  /** Fires on mouse down (see internal/activate.ts); `metaKey` for ⌘-click. */
  readonly onSelect?: (event: ActivateEvent) => void
  readonly onClose?: () => void
  readonly onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void
  /** Accessible name for the close button. Default "Close tab". */
  readonly closeLabel?: string
}

/** One tab. The active one merges into the page below it. */
export function Tab({ icon, label, active = false, onSelect, onClose, onContextMenu, closeLabel = 'Close tab' }: TabProps) {
  return (
    <div
      role="tab"
      tabIndex={0}
      aria-selected={active}
      title={label}
      onContextMenu={onContextMenu}
      {...activateHandlers<HTMLDivElement>(onSelect)}
      {...stylex.props(interactive.focusRingInset, styles.tab, typeVariants.ui, active ? styles.tabActive : styles.tabInactive)}
    >
      <Icon icon={icon} size={14} dim />
      <span {...stylex.props(styles.label)}>{label}</span>
      {onClose ? (
        <span {...stylex.props(styles.close)}>
          <IconButton
            icon={X}
            label={closeLabel}
            size={20}
            iconSize={12}
            tone="muted"
            noTooltip
            onClick={(event) => {
              event.stopPropagation()
              onClose()
            }}
          />
        </span>
      ) : null}
    </div>
  )
}

const styles = stylex.create({
  strip: {
    display: 'flex',
    alignItems: 'flex-end',
    // Fills the window so the strip and its bottom border run edge to edge.
    width: '100%',
    boxSizing: 'border-box',
    height: layout['--titlebar-height'],
    paddingInline: spacing['--space-2-5'],
    gap: spacing['--space-0-5'],
    overflow: 'hidden',
    backgroundColor: colors['--background-subtle'],
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: colors['--border-default'],
    userSelect: 'none',
    WebkitAppRegion: 'drag',
  },
  trailing: {
    display: 'inline-flex',
    flexShrink: 0,
    marginBottom: spacing['--space-1'],
    marginInlineStart: spacing['--space-1'],
    WebkitAppRegion: 'no-drag',
  },
  tab: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2'],
    flexBasis: layout['--tab-width'],
    flexGrow: 0,
    flexShrink: 1,
    minWidth: layout['--tab-min-width'],
    height: layout['--tab-height'],
    marginBottom: '-1px',
    paddingInlineStart: spacing['--space-3'],
    paddingInlineEnd: spacing['--space-1-5'],
    borderTopLeftRadius: radii['--radius-lg'],
    borderTopRightRadius: radii['--radius-lg'],
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'transparent',
    WebkitAppRegion: 'no-drag',
    minHeight: 0,
  },
  tabActive: {
    backgroundColor: colors['--background'],
    borderTopColor: colors['--border-default'],
    borderLeftColor: colors['--border-default'],
    borderRightColor: colors['--border-default'],
    borderBottomColor: colors['--background'],
    color: colors['--foreground-default'],
    fontWeight: weights['--weight-medium'],
  },
  tabInactive: {
    color: {
      default: colors['--foreground-subtle'],
      ':hover': { default: null, [HOVER]: colors['--foreground-default'] },
    },
    fontWeight: weights['--weight-regular'],
  },
  label: {
    flexGrow: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  close: {
    display: 'inline-flex',
    flexShrink: 0,
  },
})
