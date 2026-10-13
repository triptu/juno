import * as stylex from '@stylexjs/stylex'
import { X } from '@phosphor-icons/react/dist/icons/X'
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'
import { accent, colors, hues, motion, radii, sizes, spacing, tints, weights } from '@juno/tokens/tokens.stylex'
import { Icon, type IconSize, type PhosphorIcon } from './Icon'
import { IconButton } from './IconButton'
import type { HueName } from './internal/hue'
import { interactive } from './internal/interactive'
import { variants as typeVariants } from './internal/type'

const HOVER = '@media (hover: hover)'

/**
 * `person` is the inline @mention chip: the person's hue mixed lightly into
 * the surface and the text, weight 600, so a name reads as that person
 * wherever it appears. `@you` stays `accent`; `#channel` stays `filled`.
 */
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
  | 'person'
/**
 * Height in px. 18 tag, 20 badge, 22 status, 24 summary and reaction, 26
 * scope, 28 removable. `inline` follows the surrounding line (mention chips
 * in message text).
 */
export type ChipSize = 18 | 20 | 22 | 24 | 26 | 28 | 'inline'

interface ChipBaseProps {
  readonly variant?: ChipVariant
  readonly size?: ChipSize
  /** The person's hue for the `person` variant. */
  readonly hue?: HueName
  readonly icon?: PhosphorIcon
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
  readonly pop?: undefined
}

export interface ChipButtonProps extends ChipBaseProps, Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style' | 'className' | 'title' | 'children'> {
  /** Renders a button; `pressed` is the toggled state. */
  readonly interactive: true
  readonly pressed?: boolean
  /**
   * Play the pop once: the content springs to --pop-scale and back. Set it
   * when the toggle was the user's own action (my reaction landing), never
   * for a change that arrived from someone else.
   */
  readonly pop?: boolean
}

export type ChipProps = ChipLabelProps | ChipButtonProps

// Bold at every chip size; one step up from the Lucide sizes.
const iconBySize: Record<ChipSize, IconSize> = { 18: 12, 20: 12, 22: 13, 24: 13, 26: 13, 28: 13, inline: 12 }

// The inline mention chip is padded 0 5; there is no 5px step in the scale
// and nothing else uses it.
const MENTION_PADDING = '5px'

/**
 * Small inline label: tags, counts, status, decisions, reactions, mentions.
 * Always a pill. Static by default; `interactive` makes it a toggle button
 * (reaction chips).
 */
export function Chip(props: ChipProps) {
  const {
    variant = 'filled',
    size = 18,
    hue = 'rose',
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
      {children !== undefined && children !== null ? <span {...stylex.props(styles.label, rest.interactive === true && rest.pop && styles.pop)}>{children}</span> : null}
      {onRemove ? (
        <IconButton icon={X} label={removeLabel} size={20} iconSize={12} tone="muted" onClick={onRemove} noTooltip />
      ) : null}
    </>
  )
  const shared = [
    styles.base,
    // The inline chip keeps the surrounding text's setting.
    size !== 'inline' && typeVariants[size <= 20 ? 'tag' : size === 22 || size === 24 ? 'meta' : size === 26 ? 'pill' : 'ui'],
    styles.weightMedium,
    sizeStyles[size],
    variants[variant],
    variant === 'person' && personHues[hue],
    numeric && styles.numeric,
    onRemove !== undefined && styles.removable,
  ]
  if (rest.interactive === true) {
    const { interactive: _interactive, pressed, pop: _pop, type = 'button', ...buttonProps } = rest
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
  const { interactive: _interactive, pressed: _pressed, pop: _pop, ...spanProps } = rest
  return (
    <span title={title} {...spanProps} {...stylex.props(...shared)}>
      {content}
    </span>
  )
}

const popKeyframes = stylex.keyframes({
  '0%': { transform: 'scale(1)' },
  '50%': { transform: `scale(${motion['--pop-scale']})` },
  '100%': { transform: 'scale(1)' },
})

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
    borderRadius: radii['--radius-tag'],
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
  pop: {
    animationName: popKeyframes,
    animationDuration: motion['--duration-pop'],
    animationTimingFunction: motion['--ease-spring'],
    animationFillMode: 'both',
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
  // Mine: the soft accent fill with its ring, and the count in the default
  // text colour so the pill reads as pressed.
  pressed: {
    color: colors['--foreground-default'],
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
  28: { height: sizes['--control-28'], paddingInline: spacing['--space-2-5'], gap: spacing['--space-1-5'] },
  inline: { display: 'inline', paddingInline: MENTION_PADDING, lineHeight: 'inherit', verticalAlign: 'baseline' },
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
  person: {
    fontWeight: weights['--weight-semibold'],
  },
})

// 16% of the hue over the surface, 40% over the text: 4.5:1 or better for
// every hue in both themes (lowest 5.7:1, midnight in dark).
const personHues = stylex.create({
  cyan: {
    backgroundColor: `color-mix(in oklch, ${hues['--hue-cyan']} ${hues['--person-chip-bg-mix']}, ${colors['--surface-default']})`,
    color: `color-mix(in oklch, ${hues['--hue-cyan']} ${hues['--person-chip-fg-mix']}, ${colors['--foreground-default']})`,
  },
  claret: {
    backgroundColor: `color-mix(in oklch, ${hues['--hue-claret']} ${hues['--person-chip-bg-mix']}, ${colors['--surface-default']})`,
    color: `color-mix(in oklch, ${hues['--hue-claret']} ${hues['--person-chip-fg-mix']}, ${colors['--foreground-default']})`,
  },
  midnight: {
    backgroundColor: `color-mix(in oklch, ${hues['--hue-midnight']} ${hues['--person-chip-bg-mix']}, ${colors['--surface-default']})`,
    color: `color-mix(in oklch, ${hues['--hue-midnight']} ${hues['--person-chip-fg-mix']}, ${colors['--foreground-default']})`,
  },
  emeraldDark: {
    backgroundColor: `color-mix(in oklch, ${hues['--hue-emerald-dark']} ${hues['--person-chip-bg-mix']}, ${colors['--surface-default']})`,
    color: `color-mix(in oklch, ${hues['--hue-emerald-dark']} ${hues['--person-chip-fg-mix']}, ${colors['--foreground-default']})`,
  },
  plum: {
    backgroundColor: `color-mix(in oklch, ${hues['--hue-plum']} ${hues['--person-chip-bg-mix']}, ${colors['--surface-default']})`,
    color: `color-mix(in oklch, ${hues['--hue-plum']} ${hues['--person-chip-fg-mix']}, ${colors['--foreground-default']})`,
  },
  rose: {
    backgroundColor: `color-mix(in oklch, ${hues['--hue-rose']} ${hues['--person-chip-bg-mix']}, ${colors['--surface-default']})`,
    color: `color-mix(in oklch, ${hues['--hue-rose']} ${hues['--person-chip-fg-mix']}, ${colors['--foreground-default']})`,
  },
  emerald: {
    backgroundColor: `color-mix(in oklch, ${hues['--hue-emerald']} ${hues['--person-chip-bg-mix']}, ${colors['--surface-default']})`,
    color: `color-mix(in oklch, ${hues['--hue-emerald']} ${hues['--person-chip-fg-mix']}, ${colors['--foreground-default']})`,
  },
  jordy: {
    backgroundColor: `color-mix(in oklch, ${hues['--hue-jordy']} ${hues['--person-chip-bg-mix']}, ${colors['--surface-default']})`,
    color: `color-mix(in oklch, ${hues['--hue-jordy']} ${hues['--person-chip-fg-mix']}, ${colors['--foreground-default']})`,
  },
})
