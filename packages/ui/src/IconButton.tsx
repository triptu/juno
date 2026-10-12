import * as stylex from '@stylexjs/stylex'
import type { LucideIcon } from 'lucide-react'
import type { ButtonHTMLAttributes } from 'react'
import { accent, colors, radii, shadows, sizes } from '@juno/tokens/tokens.stylex'
import { Icon, type IconSize } from './Icon'
import { interactive } from './internal/interactive'

export type IconButtonSize = 20 | 22 | 26 | 28 | 30 | 32 | 36
export type IconButtonRadius = 'xs' | 'sm' | 'md' | 'lg' | 'full'
export type IconButtonVariant = 'ghost' | 'secondary' | 'primary' | 'raised'
export type IconButtonTone = 'default' | 'subtle' | 'muted'

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style' | 'className' | 'children'> {
  readonly icon: LucideIcon
  /** Required accessible name; also the tooltip. */
  readonly label: string
  readonly size?: IconButtonSize
  readonly iconSize?: IconSize
  readonly radius?: IconButtonRadius
  readonly variant?: IconButtonVariant
  readonly tone?: IconButtonTone
  readonly pressed?: boolean
  readonly dimmed?: boolean
  /** Hides the native tooltip when the label would repeat visible text. */
  readonly noTooltip?: boolean
}

// Hover styles only apply on devices with a real pointer. Local because
// StyleX cannot read constants from other modules.
const HOVER = '@media (hover: hover)'

const radiusBySize: Record<IconButtonSize, IconButtonRadius> = {
  20: 'xs',
  22: 'xs',
  26: 'md',
  28: 'md',
  30: 'lg',
  32: 'lg',
  36: 'lg',
}

const iconBySize: Record<IconButtonSize, IconSize> = {
  20: 12,
  22: 12,
  26: 13,
  28: 16,
  30: 16,
  32: 16,
  36: 18,
}

/** A button that is only an icon. Needs a label. */
export function IconButton({
  icon,
  label,
  size = 30,
  iconSize,
  radius,
  variant = 'ghost',
  tone = 'subtle',
  pressed,
  dimmed = false,
  noTooltip = false,
  type = 'button',
  disabled,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={noTooltip ? undefined : label}
      aria-pressed={pressed}
      aria-disabled={dimmed || undefined}
      disabled={disabled}
      {...rest}
      {...stylex.props(
        interactive.reset,
        interactive.feedback,
        interactive.press,
        interactive.focusRing,
        styles.base,
        sizeStyles[size],
        radiusStyles[radius ?? radiusBySize[size]],
        variants[variant],
        variant === 'ghost' && tones[tone],
        pressed && pressedStyles[variant],
        (dimmed || disabled) && interactive.dimmed,
      )}
    >
      <Icon icon={icon} size={iconSize ?? iconBySize[size]} />
    </button>
  )
}

const styles = stylex.create({
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    verticalAlign: 'middle',
  },
})

const sizeStyles = stylex.create({
  20: { width: sizes['--control-20'], height: sizes['--control-20'] },
  22: { width: sizes['--control-22'], height: sizes['--control-22'] },
  26: { width: sizes['--control-26'], height: sizes['--control-26'] },
  28: { width: sizes['--control-28'], height: sizes['--control-28'] },
  30: { width: sizes['--control-30'], height: sizes['--control-30'] },
  32: { width: sizes['--control-32'], height: sizes['--control-32'] },
  36: { width: sizes['--control-36'], height: sizes['--control-36'] },
})

const radiusStyles = stylex.create({
  xs: { borderRadius: radii['--radius-xs'] },
  sm: { borderRadius: radii['--radius-sm'] },
  md: { borderRadius: radii['--radius-md'] },
  lg: { borderRadius: radii['--radius-lg'] },
  full: { borderRadius: radii['--radius-full'] },
})

const variants = stylex.create({
  ghost: {
    backgroundColor: {
      default: 'transparent',
      ':hover': { default: null, [HOVER]: colors['--surface-hover'] },
    },
  },
  secondary: {
    color: colors['--foreground-default'],
    backgroundColor: {
      default: colors['--secondary-default'],
      ':hover': { default: null, [HOVER]: colors['--secondary-hover'] },
    },
  },
  primary: {
    color: accent['--hl-fg'],
    backgroundColor: accent['--hl'],
  },
  raised: {
    color: colors['--foreground-subtle'],
    backgroundColor: colors['--surface-default'],
    boxShadow: shadows['--shadow-sm'],
  },
})

const tones = stylex.create({
  default: { color: colors['--foreground-default'] },
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
  ghost: {
    color: colors['--foreground-default'],
    backgroundColor: {
      default: colors['--secondary-default'],
      ':hover': { default: null, [HOVER]: colors['--secondary-hover'] },
    },
  },
  secondary: { backgroundColor: colors['--secondary-active'] },
  primary: {},
  raised: {},
})
