import * as stylex from '@stylexjs/stylex'
import type { LucideIcon } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { accent, colors, radii, shadows, sizes, spacing, weights } from '@juno/tokens/tokens.stylex'
import { Icon, type IconSize } from './Icon'
import { Kbd } from './Kbd'
import { interactive } from './internal/interactive'
import { variants as typeVariants } from './internal/type'

/**
 * `filter` is the quick-filter chip (All, Channels, DMs, Unread): ghost on
 * the sidebar, muted until hovered, and semibold on a secondary fill when
 * `pressed`. It has one size, 28px, with the 7px radius.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'raised' | 'filter'
/** Height: xs 22, sm 28, md 30, lg 32, xl 34, 2xl 36. */
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl'
export type ButtonTone = 'default' | 'subtle' | 'muted'

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style' | 'className'> {
  readonly variant?: ButtonVariant
  /** Ignored by `filter`, which is always 28px. */
  readonly size?: ButtonSize
  /** Text colour for ghost and outline buttons. */
  readonly tone?: ButtonTone
  readonly iconStart?: LucideIcon
  readonly iconEnd?: LucideIcon
  /** Trailing keyboard hint, for example "↵". */
  readonly kbd?: string
  /** Selected state for toggles (Pin, filters). Sets aria-pressed. */
  readonly pressed?: boolean
  /** Looks disabled but stays focusable. Sets aria-disabled. */
  readonly dimmed?: boolean
  readonly children?: ReactNode
}

// Hover styles only apply on devices with a real pointer. Local because
// StyleX cannot read constants from other modules.
const HOVER = '@media (hover: hover)'

type Radius = 'md' | 'md-plus' | 'lg'

const radiusBySize: Record<ButtonSize, Radius> = {
  xs: 'md',
  sm: 'md',
  md: 'md-plus',
  lg: 'lg',
  xl: 'lg',
  '2xl': 'lg',
}

const textBySize: Record<ButtonSize, 'tagSmall' | 'buttonSmall' | 'ui'> = {
  xs: 'tagSmall',
  sm: 'buttonSmall',
  md: 'ui',
  lg: 'ui',
  xl: 'ui',
  '2xl': 'ui',
}

const iconBySize: Record<ButtonSize, IconSize> = {
  xs: 12,
  sm: 13,
  md: 14,
  lg: 14,
  xl: 14,
  '2xl': 14,
}

/**
 * Every clickable control with a label. Arrow cursor, press scale unless
 * disabled, hover colours only with a pointer, focus ring on keyboard focus.
 * Radius, text size and icon size follow from the size; sidebar nav items
 * are `NavItem`.
 */
export function Button({
  variant = 'secondary',
  size = 'lg',
  tone = 'default',
  iconStart,
  iconEnd,
  kbd,
  pressed,
  dimmed = false,
  type = 'button',
  disabled,
  children,
  ...rest
}: ButtonProps) {
  const filter = variant === 'filter'
  const effectiveSize: ButtonSize = filter ? 'sm' : size
  const iconPx = iconBySize[effectiveSize]
  return (
    <button
      type={type}
      disabled={disabled}
      aria-pressed={pressed}
      aria-disabled={dimmed || undefined}
      {...rest}
      {...stylex.props(
        interactive.reset,
        interactive.feedback,
        interactive.press,
        interactive.focusRing,
        styles.base,
        typeVariants[filter ? 'ui' : textBySize[effectiveSize]],
        styles.weightMedium,
        sizeStyles[effectiveSize],
        radiusStyles[filter ? 'md-plus' : radiusBySize[effectiveSize]],
        variantStyles[variant],
        (variant === 'ghost' || variant === 'outline') && tones[tone],
        pressed && pressedStyles[variant],
        dimmed && interactive.dimmed,
        disabled && interactive.dimmed,
      )}
    >
      {iconStart ? <Icon icon={iconStart} size={iconPx} /> : null}
      {children !== undefined && children !== null ? <span {...stylex.props(styles.label)}>{children}</span> : null}
      {iconEnd ? <Icon icon={iconEnd} size={iconPx} /> : null}
      {kbd ? <Kbd>{kbd}</Kbd> : null}
    </button>
  )
}

const styles = stylex.create({
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing['--space-1-5'],
    flexShrink: 0,
    whiteSpace: 'nowrap',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'transparent',
    verticalAlign: 'middle',
  },
  weightMedium: {
    fontWeight: weights['--weight-medium'],
  },
  label: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    minWidth: 0,
  },
})

const sizeStyles = stylex.create({
  xs: { height: sizes['--control-22'], paddingInline: spacing['--space-2'], gap: spacing['--space-1'] },
  sm: { height: sizes['--control-28'], paddingInline: spacing['--space-2-5'] },
  md: { height: sizes['--control-30'], paddingInline: spacing['--space-3'] },
  lg: { height: sizes['--control-32'], paddingInline: spacing['--space-3'], gap: spacing['--space-2'] },
  xl: { height: sizes['--control-34'], paddingInline: spacing['--space-3'], gap: spacing['--space-2'] },
  '2xl': { height: sizes['--control-36'], paddingInline: spacing['--space-3-5'], gap: spacing['--space-2'] },
})

const radiusStyles = stylex.create({
  md: { borderRadius: radii['--radius-md'] },
  'md-plus': { borderRadius: radii['--radius-md-plus'] },
  lg: { borderRadius: radii['--radius-lg'] },
})

const variantStyles = stylex.create({
  primary: {
    color: accent['--hl-fg'],
    backgroundColor: accent['--hl'],
  },
  secondary: {
    color: colors['--foreground-default'],
    backgroundColor: {
      default: colors['--secondary-default'],
      ':hover': { default: null, [HOVER]: colors['--secondary-hover'] },
    },
  },
  outline: {
    color: colors['--foreground-default'],
    backgroundColor: {
      default: 'transparent',
      ':hover': { default: null, [HOVER]: colors['--surface-hover'] },
    },
    borderColor: {
      default: colors['--border-strong'],
      ':hover': { default: null, [HOVER]: colors['--border-strongest'] },
    },
  },
  ghost: {
    color: colors['--foreground-default'],
    backgroundColor: {
      default: 'transparent',
      ':hover': { default: null, [HOVER]: colors['--surface-hover'] },
    },
  },
  // The ring gives the raised button an edge on light paper, where the soft
  // shadow alone reads like a ghost button.
  raised: {
    color: colors['--foreground-default'],
    backgroundColor: {
      default: colors['--surface-default'],
      ':hover': { default: null, [HOVER]: colors['--background'] },
    },
    boxShadow: `${shadows['--card-ring']}, ${shadows['--shadow-sm']}`,
  },
  filter: {
    color: {
      default: colors['--foreground-muted'],
      ':hover': { default: null, [HOVER]: colors['--foreground-default'] },
    },
    backgroundColor: {
      default: 'transparent',
      ':hover': { default: null, [HOVER]: colors['--surface-hover'] },
    },
  },
})

const tones = stylex.create({
  default: {},
  subtle: {
    color: {
      default: colors['--foreground-subtle'],
      ':hover': { default: null, [HOVER]: colors['--foreground-default'] },
    },
  },
  muted: {
    color: {
      default: colors['--foreground-muted'],
      ':hover': { default: null, [HOVER]: colors['--foreground-default'] },
    },
  },
})

const pressedStyles = stylex.create({
  primary: {},
  secondary: {
    backgroundColor: colors['--secondary-active'],
  },
  outline: {
    backgroundColor: colors['--secondary-default'],
  },
  ghost: {
    color: colors['--foreground-default'],
    backgroundColor: {
      default: colors['--secondary-default'],
      ':hover': { default: null, [HOVER]: colors['--secondary-hover'] },
    },
  },
  raised: {},
  filter: {
    color: colors['--foreground-default'],
    fontWeight: weights['--weight-semibold'],
    backgroundColor: {
      default: colors['--secondary-default'],
      ':hover': { default: null, [HOVER]: colors['--secondary-hover'] },
    },
  },
})
