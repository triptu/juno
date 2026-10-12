import * as stylex from '@stylexjs/stylex'
import type { LucideIcon } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { accent, colors, radii, shadows, sizes, spacing, weights } from '@juno/tokens/tokens.stylex'
import { Icon, type IconSize } from './Icon'
import { Kbd } from './Kbd'
import { interactive } from './internal/interactive'
import { roles } from './internal/type'

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'raised'
/** Height: xs 22, sm 28, md 30, lg 32, xl 34, 2xl 36. */
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl'
export type ButtonRadius = 'md' | 'md-plus' | 'lg' | 'full'
export type ButtonTone = 'default' | 'subtle' | 'muted'

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style' | 'className'> {
  readonly variant?: ButtonVariant
  readonly size?: ButtonSize
  /** Corner radius; derived from the size unless set. */
  readonly radius?: ButtonRadius
  /** Text colour for ghost and outline buttons. */
  readonly tone?: ButtonTone
  /** Text setting; derived from the size unless set. */
  readonly text?: 'tagSmall' | 'buttonSmall' | 'ui'
  readonly iconStart?: LucideIcon
  readonly iconEnd?: LucideIcon
  readonly iconSize?: IconSize
  /** Trailing keyboard hint, for example "↵". */
  readonly kbd?: string
  /** Trailing content such as a count Chip. Pushed to the end when `align` is start. */
  readonly trailing?: ReactNode
  /** Selected state for toggles. Sets aria-pressed. */
  readonly pressed?: boolean
  /** Looks disabled but stays focusable. Sets aria-disabled. */
  readonly dimmed?: boolean
  readonly fullWidth?: boolean
  readonly align?: 'start' | 'center'
  /** Semibold label, for a selected filter. */
  readonly strong?: boolean
  readonly children?: ReactNode
}

// Hover styles only apply on devices with a real pointer. Local because
// StyleX cannot read constants from other modules.
const HOVER = '@media (hover: hover)'

const radiusBySize: Record<ButtonSize, ButtonRadius> = {
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
 */
export function Button({
  variant = 'secondary',
  size = 'lg',
  radius,
  tone = 'default',
  text,
  iconStart,
  iconEnd,
  iconSize,
  kbd,
  trailing,
  pressed,
  dimmed = false,
  fullWidth = false,
  align = 'center',
  strong = false,
  type = 'button',
  disabled,
  children,
  ...rest
}: ButtonProps) {
  const iconPx = iconSize ?? iconBySize[size]
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
        roles[text ?? textBySize[size]],
        styles.weightMedium,
        sizeStyles[size],
        radiusStyles[radius ?? radiusBySize[size]],
        variants[variant],
        (variant === 'ghost' || variant === 'outline') && tones[tone],
        pressed && pressedStyles[variant],
        strong && styles.strong,
        dimmed && interactive.dimmed,
        disabled && interactive.disabled,
        fullWidth && styles.fullWidth,
        align === 'start' && styles.alignStart,
      )}
    >
      {iconStart ? <Icon icon={iconStart} size={iconPx} /> : null}
      {children !== undefined && children !== null ? (
        <span {...stylex.props(styles.label, align === 'start' && styles.labelGrow)}>{children}</span>
      ) : null}
      {iconEnd ? <Icon icon={iconEnd} size={iconPx} /> : null}
      {trailing}
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
  strong: {
    fontWeight: weights['--weight-semibold'],
  },
  label: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    minWidth: 0,
  },
  labelGrow: {
    flexGrow: 1,
  },
  fullWidth: {
    display: 'flex',
    width: '100%',
  },
  alignStart: {
    justifyContent: 'flex-start',
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
  full: { borderRadius: radii['--radius-full'] },
})

const variants = stylex.create({
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
  raised: {
    color: colors['--foreground-default'],
    backgroundColor: {
      default: colors['--surface-default'],
      ':hover': { default: null, [HOVER]: colors['--background'] },
    },
    boxShadow: shadows['--shadow-sm'],
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
})
