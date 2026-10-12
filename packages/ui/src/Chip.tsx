import * as stylex from '@stylexjs/stylex'
import { X, type LucideIcon } from 'lucide-react'
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'
import { accent, colors, radii, sizes, spacing, tints, weights } from '@juno/tokens/tokens.stylex'
import { Icon, type IconSize } from './Icon'
import { IconButton } from './IconButton'
import { interactive } from './internal/interactive'
import { roles } from './internal/type'

const HOVER = '@media (hover: hover)'

export type ChipVariant =
  | 'outline'
  | 'filled'
  | 'strong'
  | 'soft'
  | 'accent'
  | 'success'
  | 'quiet'
  | 'surface'
  | 'dashed'
/** Height in px. 18 tag, 20 badge, 22 status, 24 summary and reaction, 26 scope, 28 removable. */
export type ChipSize = 18 | 20 | 22 | 24 | 26 | 28

interface ChipBaseProps {
  readonly variant?: ChipVariant
  readonly size?: ChipSize
  readonly icon?: LucideIcon
  readonly iconSize?: IconSize
  /** Tabular figures. */
  readonly numeric?: boolean
  /** Adds a small close button after the label. */
  readonly onRemove?: () => void
  /** Accessible name of the close button. Default "Remove". */
  readonly removeLabel?: string
  /** Tooltip. */
  readonly title?: string
  readonly children?: ReactNode
}

export interface ChipLabelProps extends ChipBaseProps, Omit<HTMLAttributes<HTMLSpanElement>, 'style' | 'className' | 'title' | 'children'> {
  readonly interactive?: false
  readonly pressed?: undefined
}

export interface ChipButtonProps extends ChipBaseProps, Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style' | 'className' | 'title' | 'children'> {
  /** Renders a button; `pressed` is the toggled state. */
  readonly interactive: true
  readonly pressed?: boolean
}

export type ChipProps = ChipLabelProps | ChipButtonProps

const iconBySize: Record<ChipSize, IconSize> = { 18: 11, 20: 11, 22: 12, 24: 13, 26: 12, 28: 12 }

/**
 * Small inline label: tags, counts, status, decisions, reactions. Static by
 * default; `interactive` makes it a toggle button (reaction chips).
 */
export function Chip(props: ChipProps) {
  const {
    variant = 'filled',
    size = 18,
    icon,
    iconSize,
    numeric = false,
    onRemove,
    removeLabel = 'Remove',
    title,
    children,
    ...rest
  } = props
  const content = (
    <>
      {icon ? <Icon icon={icon} size={iconSize ?? iconBySize[size]} /> : null}
      {children !== undefined && children !== null ? <span {...stylex.props(styles.label)}>{children}</span> : null}
      {onRemove ? (
        <IconButton icon={X} label={removeLabel} size={20} iconSize={11} tone="muted" onClick={onRemove} noTooltip />
      ) : null}
    </>
  )
  const shared = [
    styles.base,
    roles[size <= 20 ? 'tag' : size === 22 || size === 24 ? 'meta' : size === 26 ? 'pill' : 'ui'],
    styles.weightMedium,
    sizeStyles[size],
    variants[variant],
    numeric && styles.numeric,
    onRemove !== undefined && styles.removable,
  ]
  if (rest.interactive === true) {
    const { interactive: _interactive, pressed, type = 'button', ...buttonProps } = rest
    return (
      <button
        type={type}
        title={title}
        aria-pressed={pressed}
        {...buttonProps}
        {...stylex.props(
          interactive.reset,
          interactive.feedback,
          interactive.press,
          interactive.focusRing,
          ...shared,
          styles.button,
          pressed && styles.pressed,
        )}
      >
        {content}
      </button>
    )
  }
  const { interactive: _interactive, pressed: _pressed, ...spanProps } = rest
  return (
    <span title={title} {...spanProps} {...stylex.props(...shared)}>
      {content}
    </span>
  )
}

const styles = stylex.create({
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    gap: spacing['--space-1'],
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'transparent',
    borderRadius: radii['--radius-md'],
    whiteSpace: 'nowrap',
    verticalAlign: 'middle',
    userSelect: 'none',
    boxSizing: 'border-box',
  },
  weightMedium: {
    fontWeight: weights['--weight-medium'],
  },
  label: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    minWidth: 0,
  },
  numeric: {
    fontVariantNumeric: 'tabular-nums',
  },
  removable: {
    paddingInlineEnd: spacing['--space-1'],
    gap: spacing['--space-1-5'],
  },
  button: {
    borderColor: {
      default: colors['--border-default'],
      ':hover': { default: null, [HOVER]: colors['--border-strongest'] },
    },
  },
  pressed: {
    backgroundColor: accent['--hl-soft'],
    borderColor: {
      default: accent['--hl-ring'],
      ':hover': { default: null, [HOVER]: accent['--hl-ring'] },
    },
  },
})

const sizeStyles = stylex.create({
  18: { height: sizes['--control-18'], minWidth: sizes['--control-18'], paddingInline: spacing['--space-1-5'], lineHeight: 1 },
  20: { height: sizes['--control-20'], minWidth: sizes['--control-20'], paddingInline: spacing['--space-1-5'], lineHeight: 1 },
  22: { height: sizes['--control-22'], paddingInline: spacing['--space-2'], fontWeight: weights['--weight-medium'] },
  24: { height: sizes['--control-24'], paddingInline: spacing['--space-2'], gap: spacing['--space-1-5'] },
  26: { height: sizes['--control-26'], paddingInline: spacing['--space-2-5'], gap: spacing['--space-1-5'], fontWeight: weights['--weight-medium'] },
  28: { height: sizes['--control-28'], paddingInline: spacing['--space-2-5'], gap: spacing['--space-1-5'], borderRadius: radii['--radius-md-plus'] },
})

const variants = stylex.create({
  outline: {
    color: colors['--foreground-subtle'],
    backgroundColor: colors['--surface-default'],
    borderColor: colors['--border-strong'],
  },
  filled: {
    color: colors['--foreground-subtle'],
    backgroundColor: colors['--secondary-default'],
  },
  strong: {
    color: colors['--foreground-subtle'],
    backgroundColor: colors['--secondary-active'],
  },
  soft: {
    color: colors['--foreground-subtle'],
    backgroundColor: accent['--hl-soft'],
    boxShadow: `inset 0 0 0 1px ${colors['--border-strong']}`,
  },
  accent: {
    color: accent['--hl-fg'],
    backgroundColor: accent['--hl'],
  },
  success: {
    color: tints['--tint-resolved-fg'],
    backgroundColor: tints['--tint-resolved-bg'],
  },
  quiet: {
    color: colors['--foreground-muted'],
    backgroundColor: 'transparent',
  },
  surface: {
    color: colors['--foreground-muted'],
    backgroundColor: colors['--surface-hover'],
  },
  dashed: {
    color: colors['--foreground-subtle'],
    backgroundColor: 'transparent',
    borderStyle: 'dashed',
    borderColor: colors['--border-strongest'],
  },
})
