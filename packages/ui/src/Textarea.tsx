import * as stylex from '@stylexjs/stylex'
import { useCallback, useLayoutEffect, useRef, type ReactNode, type Ref, type RefObject, type TextareaHTMLAttributes, type UIEvent } from 'react'
import { accent, colors, layout, radii, sizes, spacing, text } from '@juno/tokens/tokens.stylex'
import { chipVariants, personHues } from './Chip'
import { variants as typeVariants } from './internal/type'
import type { HueName } from './internal/hue'

export type TextareaVariant = 'inline' | 'card' | 'field'

/** A run of the text drawn as a chip (a picked @person or #channel) or as a link. */
export interface TextareaMark {
  readonly start: number
  readonly end: number
  readonly look: 'person' | 'channel' | 'link'
  /** The person's hue, as their avatar and message chips have it. */
  readonly hue?: HueName
}

export interface TextareaRange {
  readonly start: number
  readonly end: number
}

/** Slack's markup in the text, drawn as it will look (`markupLayout` in `@juno/richtext`). */
export interface TextareaFormat {
  /** Styled runs, without their markers. */
  readonly spans: ReadonlyArray<TextareaRange & { readonly style: 'bold' | 'italic' | 'strike' | 'code' }>
  /** Marker characters, drawn dimmed. */
  readonly markers: ReadonlyArray<TextareaRange>
  /** Code blocks, fences included: the lines wholly inside one are drawn as one tinted block. */
  readonly codeBlocks: ReadonlyArray<TextareaRange>
  /** Quote lines, drawn as messages draw a quote. */
  readonly quotes: ReadonlyArray<TextareaRange>
}

/** The `field` variant's growth limit: 8 lines of ui text (13.5 × 1.5), its 6px insets and its border. */
const FIELD_MAX_HEIGHT = '176px' // tokens-allow: One component's growth limit.

/** How much the bold stroke thickens a stem: about the body text's 400 to the messages' 600 (measured, see the decision log). */
const BOLD_STROKE = '0.035em' // tokens-allow: A glyph stroke, not a size.

/** The anchor name of the character at `anchorAt`, for a popover placed with CSS anchor positioning. */
const TEXTAREA_ANCHOR = '--textarea-anchor'

export interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'style' | 'className' | 'value'> {
  /**
   * `inline`: no border of its own, grows with its content to a maximum and
   * then scrolls (composer). `card`: a bordered block on the page background
   * inside a card (send card). `field`: drawn like a 32px TextField, and
   * grows with its content to 8 lines and then scrolls
   * (a note on What Juno remembers).
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
  /**
   * For `inline`: Slack's markup, drawn by the same layer as `marks`. Every
   * look keeps each glyph's width: bold is a stroke, italic the field
   * font's slant, code a tint in the field font.
   */
  readonly format?: TextareaFormat
  /** With `marks` or `format`: the character at this offset is the `TEXTAREA_ANCHOR`. */
  readonly anchorAt?: number
}

/**
 * A multi-line input. The inline variant grows with its content through
 * `field-sizing: content`, so no layout is read on a keystroke.
 *
 * With `marks` or `format` the field's own text is transparent and a layer
 * under it draws the same text in the same box, one block per line, with
 * the marked runs as chips and the markup styled. Nothing it draws changes
 * a glyph's width: chips and code give their inset back with a negative
 * margin, bold is a stroke, italic is the slant the browser draws for a
 * font with no italic face (the field's has none), and code keeps the
 * field's font. So every glyph sits where the field's caret and selection
 * expect it. The layer follows the field's scroll.
 */
export function Textarea({ variant = 'inline', maxHeight = 'composer', label, rows, marks, format, anchorAt, onScroll, ref, ...rest }: TextareaProps) {
  const layered = marks !== undefined || format !== undefined
  const layer = useRef<HTMLDivElement>(null)
  const own = useRef<HTMLTextAreaElement | null>(null)
  // Text the field opens with (a saved draft, a message to edit) takes typing at its end, not before it.
  useLayoutEffect(() => {
    const element = own.current
    if (element !== null) element.setSelectionRange(element.value.length, element.value.length)
  }, [])
  const attach = useCallback(
    (node: HTMLTextAreaElement | null) => {
      own.current = node
      setRef(ref, node)
    },
    [ref],
  )
  const field = (
    <textarea
      ref={attach}
      aria-label={label}
      rows={rows ?? (variant === 'card' ? 2 : 1)}
      {...rest}
      {...(!layered
        ? { onScroll }
        : {
            onScroll: (event: UIEvent<HTMLTextAreaElement>) => {
              if (layer.current !== null) layer.current.scrollTop = event.currentTarget.scrollTop
              onScroll?.(event)
            },
          })}
      {...stylex.props(styles.base, variants[variant], variant === 'field' && typeVariants.ui, variant === 'inline' && maxHeights[maxHeight], layered && styles.inkless)}
    />
  )
  if (!layered) return field
  return (
    <div {...stylex.props(styles.marked)}>
      <div ref={layer} aria-hidden data-textarea-layer="" {...stylex.props(variants.inline, styles.layer)}>
        {drawnLines(rest.value ?? '', marks ?? [], format, anchorAt)}
      </div>
      {field}
    </div>
  )
}

function setRef(ref: Ref<HTMLTextAreaElement> | undefined, node: HTMLTextAreaElement | null): void {
  if (typeof ref === 'function') ref(node)
  else if (ref !== undefined && ref !== null) (ref as RefObject<HTMLTextAreaElement | null>).current = node
}

/** A run drawn in a box of its own: a chip or link, or inline code with its markers. */
interface Box {
  readonly start: number
  readonly end: number
  readonly mark?: TextareaMark
}

const ZERO_WIDTH_SPACE = '\u200b'

/**
 * The text as the layer draws it: a block per line, so a quote or a code
 * block can tint the whole line. A line's runs are chips and inline code
 * boxes over plain text, and the styled runs, markers and the anchor
 * character inside them. An empty line holds a zero-width space, so it
 * keeps its height.
 */
function drawnLines(value: string, marks: ReadonlyArray<TextareaMark>, format: TextareaFormat | undefined, anchorAt: number | undefined): ReactNode[] {
  const lines: ReactNode[] = []
  const quoted = new Set(format?.quotes.map((range) => range.start))
  let start = 0
  let afterQuote = false
  for (const [index, line] of value.split('\n').entries()) {
    const end = start + line.length
    const block = format?.codeBlocks.find((range) => range.start <= start && end <= range.end)
    const quote = quoted.has(start)
    const drawn = runs(value, start, end, marks, format, block !== undefined, anchorAt)
    lines.push(
      <div
        key={index}
        {...stylex.props(
          quote && styles.quote,
          quote && !afterQuote && styles.first,
          quote && !quoted.has(end + 1) && styles.last,
          block !== undefined && styles.codeBlock,
          block !== undefined && block.start === start && styles.first,
          block !== undefined && block.end === end && styles.last,
        )}
      >
        {drawn.length === 0 ? ZERO_WIDTH_SPACE : drawn}
      </div>,
    )
    afterQuote = quote
    start = end + 1
  }
  return lines
}

/** One line's runs, from `start` to `end`. */
function runs(value: string, start: number, end: number, marks: ReadonlyArray<TextareaMark>, format: TextareaFormat | undefined, inBlock: boolean, anchorAt: number | undefined): ReactNode[] {
  const within = <T extends TextareaRange>(ranges: ReadonlyArray<T> | undefined) => (ranges ?? []).filter((range) => range.end > start && range.start < end)
  const spans = within(format?.spans)
  const markers = within(format?.markers)
  // Inline code is a box from its opening marker to its closing one; in a code block the line is the box.
  const codeBoxes: Box[] = inBlock
    ? []
    : spans
        .filter((span) => span.style === 'code')
        .map((span) => ({
          start: Math.max(start, markers.find((marker) => marker.end === span.start)?.start ?? span.start),
          end: Math.min(end, markers.find((marker) => marker.start === span.end)?.end ?? span.end),
        }))
  const markBoxes: Box[] = marks.filter((mark) => mark.start >= start && mark.end <= end).map((mark) => ({ start: mark.start, end: mark.end, mark }))
  const boxes = [...codeBoxes, ...markBoxes].toSorted((a, b) => a.start - b.start || b.end - a.end)

  // Plain text between boxes: a span for each change of style, marker or anchor.
  const text = (from: number, to: number, inMark: boolean): ReactNode[] => {
    const cuts = new Set([from, to])
    for (const range of [...spans, ...markers]) for (const at of [range.start, range.end]) if (at > from && at < to) cuts.add(at)
    if (!inMark && anchorAt !== undefined && anchorAt >= from && anchorAt < to) cuts.add(anchorAt).add(anchorAt + 1)
    const points = [...cuts].toSorted((a, b) => a - b)
    const out: ReactNode[] = []
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i]!
      const b = points[i + 1]!
      const has = (style: string) => spans.some((span) => span.style === style && span.start <= a && span.end >= b)
      const marker = markers.some((range) => range.start <= a && range.end >= b)
      const anchor = !inMark && anchorAt === a
      const looks = [has('bold') && styles.bold, has('italic') && styles.italic, has('strike') && styles.strike, marker && styles.marker, anchor && styles.anchor]
      const piece = value.slice(a, b)
      out.push(looks.some(Boolean) ? <span key={a} {...stylex.props(...looks)}>{piece}</span> : piece)
    }
    return out
  }

  const nodes = (from: number, to: number, inside: ReadonlyArray<Box>, inMark: boolean): ReactNode[] => {
    const out: ReactNode[] = []
    let at = from
    for (const box of inside) {
      if (box.start < at || box.end > to) continue
      out.push(...text(at, box.start, inMark))
      const inner = inside.filter((other) => other !== box && other.start >= box.start && other.end <= box.end)
      const mark = box.mark
      if (mark === undefined) {
        out.push(<span key={`code-${box.start}`} {...stylex.props(styles.code)}>{nodes(box.start, box.end, inner, inMark)}</span>)
      } else {
        // The anchor inside a mark is the mark: the link editor lines up under linked words.
        const anchored = anchorAt !== undefined && anchorAt >= mark.start && anchorAt < mark.end
        const look = mark.look === 'link' ? styles.link : [styles.chip, mark.look === 'channel' ? chipVariants.filled : personHues[mark.hue ?? 'rose']]
        out.push(
          <span key={mark.start} data-mark={mark.look} {...stylex.props(look, anchored && styles.anchor)}>
            {nodes(box.start, box.end, inner, true)}
          </span>,
        )
      }
      at = box.end
    }
    out.push(...text(at, to, inMark))
    return out
  }
  return nodes(start, end, boxes, false)
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
  // A stroke drawn under the fill thickens each glyph without moving the next one.
  bold: {
    WebkitTextStrokeWidth: BOLD_STROKE,
    WebkitTextStrokeColor: 'currentColor',
    paintOrder: 'stroke fill',
  },
  // The field's font has no italic face, so this is the browser's slant of the upright one, at the same widths.
  italic: {
    fontStyle: 'italic',
  },
  strike: {
    textDecorationLine: 'line-through',
  },
  marker: {
    color: colors['--foreground-muted'],
  },
  // Inline code: the code tint around the run and its backticks, its inset given back as a chip's is.
  code: {
    borderRadius: radii['--radius-xs'],
    paddingInline: spacing['--space-0-5'],
    marginInline: `calc(-1 * ${spacing['--space-0-5']})`,
    backgroundColor: colors['--secondary-default'],
  },
  // A code block's lines: one tinted block, reaching into the layer's inset.
  codeBlock: {
    paddingInline: spacing['--space-1'],
    marginInline: `calc(-1 * ${spacing['--space-1']})`,
    backgroundColor: colors['--secondary-default'],
  },
  // As messages draw a quote (inventory 6.3): the soft fill and the subtle colour, reaching into the layer's inset.
  quote: {
    paddingInline: spacing['--space-1'],
    marginInline: `calc(-1 * ${spacing['--space-1']})`,
    backgroundColor: colors['--quote-fill'],
    color: colors['--foreground-subtle'],
  },
  // The first and last line of a code block or a run of quote lines round their outer corners.
  first: {
    borderStartStartRadius: radii['--radius-xs'],
    borderStartEndRadius: radii['--radius-xs'],
  },
  last: {
    borderEndStartRadius: radii['--radius-xs'],
    borderEndEndRadius: radii['--radius-xs'],
  },
  // As links in messages are drawn, with no change of width.
  link: {
    color: accent['--hl-text'],
    textDecorationLine: 'underline',
    textDecorationColor: colors['--link-underline'],
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
  // The 32px TextField's border, radius, inset and text, on more than one line.
  field: {
    paddingBlock: spacing['--space-1-5'],
    paddingInline: spacing['--space-2-5'],
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: {
      default: colors['--input-border'],
      ':focus': accent['--focus-ring'],
    },
    borderRadius: radii['--radius-md-plus'],
    letterSpacing: text['--text-ui-tracking'],
    resize: 'none',
    fieldSizing: 'content',
    maxHeight: FIELD_MAX_HEIGHT,
    overflowY: 'auto',
    overscrollBehavior: 'contain',
  },
})

const maxHeights = stylex.create({
  composer: { maxHeight: layout['--composer-max-height'] },
  assistant: { maxHeight: layout['--assistant-input-max-height'] },
})
