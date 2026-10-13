import * as stylex from '@stylexjs/stylex'
import type { MouseEvent, ReactNode } from 'react'
import { colors, radii, sizes, spacing, weights } from '@juno/tokens/tokens.stylex'
import { Icon, type IconWeight, type PhosphorIcon } from './Icon'
import { Kbd } from './Kbd'
import { activateHandlers, type ActivateEvent } from './internal/activate'
import { interactive } from './internal/interactive'
import { variants as typeVariants } from './internal/type'

const HOVER = '@media (hover: hover)'

export interface NavItemProps {
  readonly icon: PhosphorIcon
  /**
   * Icon weight. Default: regular, and fill when `active`. The Juno item
   * passes `duotone` so it stays marked as the one AI surface.
   */
  readonly iconWeight?: IconWeight
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
}

/**
 * A sidebar navigation item (All topics, For you, Juno): 32px, full width,
 * icon then label, ghost until hovered, a secondary fill and a filled icon
 * when it is the open page. Navigates on mouse down like rows and tabs, and
 * never animates.
 */
export function NavItem({ icon, iconWeight, children, active = false, trailing, kbd, onSelect, onContextMenu }: NavItemProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-current={active ? 'page' : undefined}
      onContextMenu={onContextMenu}
      {...activateHandlers<HTMLDivElement>(onSelect)}
      {...stylex.props(interactive.focusRing, typeVariants.ui, styles.item, active && styles.active)}
    >
      {iconWeight === undefined ? <Icon icon={icon} size={16} active={active} /> : <Icon icon={icon} size={16} weight={iconWeight} />}
      <span {...stylex.props(styles.label)}>{children}</span>
      {trailing}
      {kbd ? <Kbd>{kbd}</Kbd> : null}
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
  active: {
    backgroundColor: {
      default: colors['--secondary-default'],
      ':hover': { default: null, [HOVER]: colors['--secondary-hover'] },
    },
  },
  label: {
    flexGrow: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
})
