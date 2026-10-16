import * as stylex from '@stylexjs/stylex'
import { useRef, type ReactNode, type Ref, type TextareaHTMLAttributes, type UIEvent } from 'react'
import { accent, colors, layout, radii, sizes, spacing, text } from '@juno/tokens/tokens.stylex'
import { chipVariants, personHues } from './Chip'
import type { HueName } from './internal/hue'

export type TextareaVariant = 'inline' | 'card'

/** A run of the text drawn as a chip (a picked @person or #channel) or as a link. */
export interface TextareaMark {
  readonly start: number
  readonly end: number
  readonly look: 'person' | 'channel' | 'link'
  /** The person's hue, as their avatar and message chips have it. */
  readonly hue?: HueName
}

/** The anchor name of the character at `anchorAt`, for a popover placed with CSS anchor positioning. */
const TEXTAREA_ANCHOR = '--textarea-anchor'

export interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'style' | 'className' | 'value'> {
  /**
   * `inline`: no border of its own, grows with its content to a maximum and
   * then scrolls (composer). `card`: a bordered block on the page background
   * inside a card (send card).
   */
  readonly variant?: TextareaVariant
  /** For `inline`: the growth limit. */
  readonly maxHeight?: 'composer' | 'assistant'
  readonly label?: string
  /** The element, for an owner that focuses it (⌘J on the Juno composer). */
  readonly ref?: Ref<HTMLTextAreaElement>
  readonly value?: string
  /**
   * For `inline`: runs of the text drawn as chips. With it the text is drawn
   * by a layer under the field, which keeps its caret, selection and input.
   */
  readonly marks?: ReadonlyArray<TextareaMark>
  /** With `marks`: the character at this offset is the `TEXTAREA_ANCHOR`. */
  readonly anchorAt?: number
}

/**
 * A multi-line input. The inline variant grows with its content through
 * `field-sizing: content`, so no layout is read on a keystroke.
 *
 * With `marks` the field's own text is transparent and a layer under it
 * draws the same text in the same box, with the marked runs as chips. The
 * chips keep the text's weight and take no width (their inset is given
 * back with a negative margin), so every glyph sits where the field's
 * caret and selection expect it. The layer follows the field's scroll.
 */
export function Textarea({ variant = 'inline', maxHeight = 'composer', label, rows, marks, anchorAt, onScroll, ...rest }: TextareaProps) {
  const layer = useRef<HTMLDivElement>(null)
  const field = (
    <textarea
      aria-label={label}
      rows={rows ?? (variant === 'inline' ? 1 : 2)}
      {...rest}
      {...(marks === undefined
        ? { onScroll }
        : {
            onScroll: (event: UIEvent<HTMLTextAreaElement>) => {
              if (layer.current !== null) layer.current.scrollTop = event.currentTarget.scrollTop
              onScroll?.(event)
            },
          })}
      {...stylex.props(styles.base, variants[variant], variant === 'inline' && maxHeights[maxHeight], marks !== undefined && styles.inkless)}
    />
  )
  if (marks === undefined) return field
  return (
    <div {...stylex.props(styles.marked)}>
      <div ref={layer} aria-hidden data-textarea-layer="" {...stylex.props(variants.inline, styles.layer)}>
        {drawn(rest.value ?? '', marks, anchorAt)}
      </div>
      {field}
    </div>
  )
}

/** The text as runs: plain text, chips, and the anchor character. A trailing newline keeps its empty line. */
function drawn(value: string, marks: ReadonlyArray<TextareaMark>, anchorAt: number | undefined): ReactNode[] {
  const out: ReactNode[] = []
  let at = 0
  const plain = (end: number) => {
    if (end <= at) return
    if (anchorAt !== undefined && anchorAt >= at && anchorAt < end) {
      if (anchorAt > at) out.push(value.slice(at, anchorAt))
      out.push(
        <span key="anchor" {...stylex.props(styles.anchor)}>
          {value[anchorAt]}
        </span>,
      )
      if (anchorAt + 1 < end) out.push(value.slice(anchorAt + 1, end))
    } else {
      out.push(value.slice(at, end))
    }
    at = end
  }
  for (const mark of marks) {
    if (mark.start < at || mark.end > value.length) continue
    plain(mark.start)
    // The anchor inside a mark is the mark: the link editor lines up under linked words.
    const anchored = anchorAt !== undefined && anchorAt >= mark.start && anchorAt < mark.end
    const look = mark.look === 'link' ? styles.link : [styles.chip, mark.look === 'channel' ? chipVariants.filled : personHues[mark.hue ?? 'rose']]
    out.push(
      <span key={mark.start} data-mark={mark.look} {...stylex.props(look, anchored && styles.anchor)}>
        {value.slice(mark.start, mark.end)}
      </span>,
    )
    at = mark.end
  }
  plain(value.length)
  if (value.endsWith('\n')) out.push('​')
  return out
}

const styles = stylex.create({
  base: {
    display: 'block',
    width: '100%',
    margin: 0,
    boxSizing: 'border-box',
    backgroundColor: colors['--surface-default'],
    color: colors['--foreground-default'],
    outline: 'none',
    userSelect: 'text',
    cursor: 'text',
    '::placeholder': {
      color: colors['--foreground-muted'],
      opacity: 1,
    },
  },
  // The wrapper takes the field's place in its row; the field stays in flow and sets the height.
  marked: {
    position: 'relative',
    width: '100%',
    minWidth: 0,
  },
  // The field keeps its caret and selection; the layer under it draws the text.
  inkless: {
    position: 'relative',
    color: 'transparent',
    caretColor: colors['--foreground-default'],
    // The selection's fill covers the layer, so the field draws the selected text itself.
    '::selection': {
      color: colors['--foreground-default'],
    },
  },
  layer: {
    position: 'absolute',
    inset: 0,
    boxSizing: 'border-box',
    color: colors['--foreground-default'],
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
    // It overflows exactly when the field does, so a classic scrollbar narrows both alike.
    overflowY: 'auto',
    scrollbarColor: 'transparent transparent',
    pointerEvents: 'none',
    userSelect: 'none',
  },
  // The chip's inset is given back by its margin, so no glyph moves.
  chip: {
    borderRadius: radii['--radius-tag'],
    paddingInline: spacing['--space-0-5'],
    marginInline: `calc(-1 * ${spacing['--space-0-5']})`,
  },
  anchor: {
    anchorName: TEXTAREA_ANCHOR,
  },
  // As links in messages are drawn, with no change of width.
  link: {
    color: accent['--hl-text'],
    textDecorationLine: 'underline',
    textDecorationColor: 'color-mix(in oklch, currentColor 35%, transparent)',
    textUnderlineOffset: sizes['--link-underline-offset'],
  },
})

const variants = stylex.create({
  inline: {
    // 9 + 22 + 9 = the 40px single-line composer.
    paddingBlock: layout['--composer-padding-block'],
    paddingInline: spacing['--space-1'],
    borderWidth: 0,
    backgroundColor: 'transparent',
    fontFamily: text['--text-body-family'],
    fontSize: text['--text-body-size'],
    lineHeight: layout['--composer-line-height'],
    letterSpacing: text['--text-body-tracking'],
    resize: 'none',
    fieldSizing: 'content',
    overflowY: 'auto',
    overscrollBehavior: 'contain',
  },
  card: {
    paddingBlock: spacing['--space-2'],
    paddingInline: spacing['--space-2-5'],
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: {
      default: colors['--input-border'],
      ':focus': accent['--focus-ring'],
    },
    borderRadius: radii['--radius-lg'],
    backgroundColor: colors['--background'],
    fontFamily: text['--text-body-family'],
    fontSize: text['--text-body-size'],
    lineHeight: text['--text-body-small-leading'],
    letterSpacing: text['--text-body-tracking'],
    resize: 'none',
  },
})

const maxHeights = stylex.create({
  composer: { maxHeight: layout['--composer-max-height'] },
  assistant: { maxHeight: layout['--assistant-input-max-height'] },
})
