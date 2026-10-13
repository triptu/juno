import * as stylex from '@stylexjs/stylex'
import type { ElementType, HTMLAttributes, ReactNode } from 'react'
import { accent, colors } from '@juno/tokens/tokens.stylex'
import type { LayoutStyles } from './internal/sx'
import { numeric as numericStyles, variants as typeVariants, weight as weightStyles, type TextVariant, type Weight } from './internal/type'

export type { TextVariant, Weight }

export type TextTone = 'inherit' | 'default' | 'subtle' | 'muted' | 'accent' | 'danger'

export interface TextProps extends Omit<HTMLAttributes<HTMLElement>, 'style' | 'className'> {
  /** The type role: family, size, weight, line height and tracking. Default `ui`. */
  readonly variant?: TextVariant
  readonly tone?: TextTone
  /** Overrides the variant's weight, for example 600 on an unread title. */
  readonly weight?: Weight
  /** One line with an ellipsis. */
  readonly truncate?: boolean
  /** Clamp to this many lines with an ellipsis. */
  readonly clamp?: 1 | 2 | 3
  /** Tabular figures; use for times, counts and table numbers. */
  readonly numeric?: boolean
  /** Chrome text is not selectable; message text and similar opt in. */
  readonly selectable?: boolean
  /** Element to render. Default span; block variants default to a block tag. */
  readonly as?: ElementType
  /** Extra StyleX styles from the owner (layout only). */
  readonly sx?: LayoutStyles
  readonly children?: ReactNode
}

const blockTags: Partial<Record<TextVariant, ElementType>> = {
  body: 'p',
  bodySmall: 'p',
  preview: 'p',
  heading: 'h2',
  topicTitle: 'h1',
  pageTitle: 'h1',
  pageTitleCompact: 'h1',
  display: 'h1',
  emptyTitle: 'h2',
  code: 'pre',
}

/**
 * Typography. Maps a variant name to the family, size, weight, line height
 * and letter spacing of that type role, and a tone to a foreground colour.
 * ARIA `role` passes through untouched.
 */
export function Text({
  variant = 'ui',
  tone = 'inherit',
  weight,
  truncate = false,
  clamp,
  numeric = false,
  selectable = false,
  as,
  sx,
  children,
  ...rest
}: TextProps) {
  const Tag = as ?? blockTags[variant] ?? 'span'
  return (
    <Tag
      {...rest}
      {...stylex.props(
        styles.base,
        typeVariants[variant],
        tones[tone],
        weight && weightStyles[weight],
        truncate && styles.truncate,
        clamp !== undefined && styles.clamp(clamp),
        numeric && numericStyles.tabular,
        selectable ? styles.selectable : styles.unselectable,
        (variant === 'body' || variant === 'bodySmall' || variant === 'preview') && styles.prose,
        sx,
      )}
    >
      {children}
    </Tag>
  )
}

const styles = stylex.create({
  base: {
    margin: 0,
    minWidth: 0,
  },
  truncate: {
    display: 'block',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  clamp: (lines: number) => ({
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: lines,
    overflow: 'hidden',
    textWrap: 'pretty',
  }),
  prose: {
    overflowWrap: 'anywhere',
    textWrap: 'pretty',
  },
  selectable: {
    userSelect: 'text',
    cursor: 'text',
  },
  unselectable: {
    userSelect: 'none',
  },
})

const tones = stylex.create({
  inherit: { color: 'inherit' },
  default: { color: colors['--foreground-default'] },
  subtle: { color: colors['--foreground-subtle'] },
  muted: { color: colors['--foreground-muted'] },
  accent: { color: accent['--hl-text'] },
  danger: { color: colors['--danger'] },
})
