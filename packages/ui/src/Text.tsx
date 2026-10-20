import * as stylex from '@stylexjs/stylex'
import type { ElementType, HTMLAttributes, PointerEvent, ReactNode } from 'react'
import { accent, colors, text } from '@juno/tokens/tokens.stylex'
import { pointerMoved } from './internal/pointer'
import type { LayoutStyles } from './internal/sx'
import { numeric as numericStyles, variants as typeVariants, weight as weightStyles, type TextVariant, type Weight } from './internal/type'

export type { TextVariant, Weight }

export type TextTone = 'inherit' | 'default' | 'secondary' | 'subtle' | 'muted' | 'accent' | 'danger'

export interface TextProps extends Omit<HTMLAttributes<HTMLElement>, 'style' | 'className'> {
  /** The type role: family, size, weight, line height and tracking. Default `ui`. `inherit` keeps the parent's, for text inside a control that sets its own. */
  readonly variant?: TextVariant | 'inherit'
  readonly tone?: TextTone
  /** Overrides the variant's weight, for example 600 on an unread title. */
  readonly weight?: Weight
  /** One line with an ellipsis. */
  readonly truncate?: boolean
  /** List topic title: follows Appearance’s line limit. */
  readonly topicTitle?: boolean
  /** Clamp to this many lines with an ellipsis. */
  readonly clamp?: 1 | 2 | 3
  /**
   * With `truncate` or `clamp`: while the text is cut off, hovering it shows
   * the full text as the native tooltip; when it fits, there is none. One
   * size read on pointer enter, nothing on render, so a row costs nothing
   * until it is hovered. Inside an element with its own tooltip
   * (`data-tooltip`) there is none, so two never show. Do not combine with `title`.
   */
  readonly tooltipWhenTruncated?: boolean
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

function titleWhenTruncated(event: PointerEvent<HTMLElement>) {
  const node = event.currentTarget
  // Text scrolled under a still pointer is read after the frame, when layout
  // is clean, instead of forcing one in the middle of a scroll.
  if (pointerMoved(event)) setTitle(node)
  else requestAnimationFrame(() => setTimeout(() => setTitle(node)))
}

function setTitle(node: HTMLElement) {
  // Privacy mode: a blurred line's tooltip would show it in full (SPEC section 5).
  if ((node.closest('[data-sensitive]') !== null && document.documentElement.hasAttribute('data-privacy')) || node.closest('[data-tooltip]') !== null) node.removeAttribute('title')
  else if (node.scrollWidth > node.clientWidth || node.scrollHeight > node.clientHeight) node.title = node.textContent ?? ''
  else node.removeAttribute('title')
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
  topicTitle = false,
  clamp,
  tooltipWhenTruncated = false,
  numeric = false,
  selectable = false,
  as,
  sx,
  children,
  ...rest
}: TextProps) {
  const Tag = as ?? (variant === 'inherit' ? undefined : blockTags[variant]) ?? 'span'
  const enter = tooltipWhenTruncated
    ? (event: PointerEvent<HTMLElement>) => {
        titleWhenTruncated(event)
        rest.onPointerEnter?.(event)
      }
    : rest.onPointerEnter
  return (
    <Tag
      {...rest}
      onPointerEnter={enter}
      {...stylex.props(
        styles.base,
        variant !== 'inherit' && typeVariants[variant],
        tones[tone],
        weight && weightStyles[weight],
        truncate && styles.truncate,
        topicTitle && styles.topicTitle,
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
  topicTitle: {
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: text['--topic-title-lines'],
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    overflowWrap: 'anywhere',
    whiteSpace: text['--topic-title-white-space'],
  },
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
  secondary: { color: colors['--foreground-secondary'] },
  subtle: { color: colors['--foreground-subtle'] },
  muted: { color: colors['--foreground-muted'] },
  accent: { color: accent['--hl-text'] },
  danger: { color: colors['--danger'] },
})
