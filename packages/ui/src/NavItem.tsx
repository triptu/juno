import * as stylex from '@stylexjs/stylex'
import type { MouseEvent, ReactNode } from 'react'
import { accent, colors, radii, sizes, spacing, weights } from '@juno/tokens/tokens.stylex'
import { Icon, type PhosphorIcon } from './Icon'
import { Kbd } from './Kbd'
import { activateHandlers, type ActivateEvent } from './internal/activate'
import { tooltip } from './Tooltip'
import { focusRing } from './focusRing'
import { variants as typeVariants } from './internal/type'

const HOVER = '@media (hover: hover)'

export interface NavItemProps {
  /**
   * Drawn regular, and fill when `active`. The Juno item passes a duotone
   * icon (`duotone.ts`) while a job runs, which stays duotone either way.
   */
  readonly icon: PhosphorIcon
  /** The label. */
  readonly children: ReactNode
  /** This item is the open page. Sets aria-current and fills the icon. */
  readonly active?: boolean
  /** A count Chip, pushed to the end. */
  readonly trailing?: ReactNode
  /** Keyboard hint after the label, for example "⌘J". */
  readonly kbd?: string
  /** Fires on mouse down (see internal/activate.ts); `metaKey` for ⌘-click. */
  readonly onSelect?: (event: ActivateEvent) => void
  readonly onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void
  /** Pointer enter or focus: warm what the item opens (performance.md 4.2). */
  readonly onPrefetch?: () => void
  /**
   * The icon alone in a 32px square, for a list that has narrowed to a
   * rail. A string label becomes the accessible name and the tooltip;
   * `trailing` and `kbd` are left out.
   */
  readonly compact?: boolean
}

/**
 * A sidebar navigation item (All topics, Juno): 32px, full width,
 * icon then label, ghost until hovered. The open page gets the accent's nav
 * tint, accent text, 600 and a filled icon. Navigates on mouse down like
 * rows and tabs, and never animates.
 */
export function NavItem({ icon, children, active = false, trailing, kbd, onSelect, onContextMenu, onPrefetch, compact = false }: NavItemProps) {
  const name = compact && typeof children === 'string' ? children : undefined
  return (
    <div
      role="button"
      tabIndex={0}
      aria-current={active ? 'page' : undefined}
      aria-label={name}
      {...(name === undefined ? {} : tooltip(name))}
      onContextMenu={onContextMenu}
      onPointerEnter={onPrefetch}
      onFocus={onPrefetch}
      {...activateHandlers<HTMLDivElement>(onSelect)}
      {...stylex.props(focusRing.outside, typeVariants.ui, styles.item, compact && styles.compact, active && styles.active)}
    >
      <Icon icon={icon} size={16} active={active} />
      {compact ? null : (
        <>
          <span {...stylex.props(styles.label)}>{children}</span>
          {trailing}
          {kbd ? <Kbd>{kbd}</Kbd> : null}
        </>
      )}
    </div>
  )
}

const styles = stylex.create({
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2'],
    width: '100%',
    height: sizes['--control-32'],
    paddingInline: spacing['--space-3'],
    borderRadius: radii['--radius-xl'],
    fontWeight: weights['--weight-medium'],
    whiteSpace: 'nowrap',
    userSelect: 'none',
    boxSizing: 'border-box',
    WebkitAppRegion: 'no-drag',
    color: colors['--foreground-default'],
    backgroundColor: {
      default: 'transparent',
      ':hover': { default: null, [HOVER]: colors['--surface-hover'] },
    },
  },
  compact: {
    justifyContent: 'center',
    width: sizes['--control-32'],
    paddingInline: 0,
  },
  active: {
    color: accent['--hl-text'],
    fontWeight: weights['--weight-semibold'],
    backgroundColor: {
      default: accent['--hl-nav'],
      ':hover': { default: null, [HOVER]: accent['--hl-nav'] },
    },
  },
  label: {
    flexGrow: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
})
