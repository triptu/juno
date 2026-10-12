import * as stylex from '@stylexjs/stylex'
import type { ElementType, HTMLAttributes, ReactNode } from 'react'
import { accent, colors } from '@juno/tokens/tokens.stylex'
import { numeric as numericStyles, roles, weight as weightStyles, type TextRole, type Weight } from './internal/type'

export type { TextRole, Weight }

export type TextTone = 'inherit' | 'default' | 'subtle' | 'muted' | 'accent' | 'danger'

export interface TextProps extends Omit<HTMLAttributes<HTMLElement>, 'style' | 'className'> {
  readonly role?: TextRole
  readonly tone?: TextTone
  /** Overrides the role's weight, for example 600 on an unread title. */
  readonly weight?: Weight
  /** One line with an ellipsis. */
  readonly truncate?: boolean
  /** Clamp to this many lines with an ellipsis. */
  readonly clamp?: 1 | 2 | 3
  /** Tabular figures; use for times, counts and table numbers. */
  readonly numeric?: boolean
  /** Chrome text is not selectable; message text and similar opt in. */
  readonly selectable?: boolean
  /** Element to render. Default span; block roles default to a block tag. */
  readonly as?: ElementType
  /** Extra StyleX styles from the owner (layout only). */
  readonly sx?: stylex.StyleXStyles
  readonly children?: ReactNode
}

const blockTags: Partial<Record<TextRole, ElementType>> = {
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
 * Typography. Maps a role name to the family, size, weight, line height and
 * letter spacing of that role, and a tone to a foreground colour.
 */
export function Text({
  role = 'ui',
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
  const Tag = as ?? blockTags[role] ?? 'span'
  return (
    <Tag
      {...rest}
      {...stylex.props(
        styles.base,
        roles[role],
        tones[tone],
        weight && weightStyles[weight],
        truncate && styles.truncate,
        clamp !== undefined && styles.clamp(clamp),
        numeric && numericStyles.tabular,
        selectable ? styles.selectable : styles.unselectable,
        (role === 'body' || role === 'bodySmall' || role === 'preview') && styles.prose,
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
  accent: { color: accent['--hl'] },
  danger: { color: colors['--danger'] },
})
