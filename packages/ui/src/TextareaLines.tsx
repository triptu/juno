/**
 * The layer of a `Textarea` with `format`, one block per line, so a quote
 * or a code block can tint the whole line. A chunk of its own, loaded when
 * idle once a field has `format` (`Textarea`); until then the layer draws
 * the text as it draws marks. Nothing here changes a glyph's width: bold is
 * a stroke, italic is the slant the browser draws for a font with no
 * italic face (the field's has none), code is a tint in the field's font.
 */
import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { colors, spacing } from '@juno/tokens/tokens.stylex'
import { layerStyles, markLook } from './internal/textareaLayer'
import type { TextareaFormat, TextareaMark, TextareaRange } from './Textarea'

/** How much the bold stroke thickens a stem: about the body text's 400 to the messages' 600 (measured, see the decision log). */
const BOLD_STROKE = '0.035em' // tokens-allow: A glyph stroke, not a size.

const ZERO_WIDTH_SPACE = '\u200b'

/** The text as the layer draws it, a block per line. An empty line holds a zero-width space, so it keeps its height. */
export function drawnLines(value: string, marks: ReadonlyArray<TextareaMark>, format: TextareaFormat | undefined, anchorAt: number | undefined): ReactNode[] {
  let start = 0
  return value.split('\n').map((line, index) => {
    const end = start + line.length
    const block = format?.codeBlocks.some((range) => range.start <= start && end <= range.end) === true
    const quote = format?.quotes.some((range) => range.start === start) === true
    const drawn = runs(value, start, end, marks, format, block, anchorAt)
    start = end + 1
    return (
      <div key={index} {...stylex.props(quote && styles.quote, block && styles.codeBlock)}>
        {drawn.length === 0 ? ZERO_WIDTH_SPACE : drawn}
      </div>
    )
  })
}

/** One line's runs, from `start` to `end`: chips and links over the text, and a span for each change of style, marker or anchor. */
function runs(value: string, start: number, end: number, marks: ReadonlyArray<TextareaMark>, format: TextareaFormat | undefined, inBlock: boolean, anchorAt: number | undefined): ReactNode[] {
  const spans = (format?.spans ?? []).filter((range) => range.end > start && range.start < end)
  const markers = (format?.markers ?? []).filter((range) => range.end > start && range.start < end)
  const text = (from: number, to: number, inMark: boolean): ReactNode[] => {
    const cuts = new Set([from, to])
    for (const range of [...spans, ...markers]) for (const at of [range.start, range.end]) if (at > from && at < to) cuts.add(at)
    if (!inMark && anchorAt !== undefined && anchorAt >= from && anchorAt < to) cuts.add(anchorAt).add(anchorAt + 1)
    const points = [...cuts].toSorted((a, b) => a - b)
    return points.slice(1).map((b, i) => {
      const a = points[i]!
      const over = (range: TextareaRange) => range.start <= a && range.end >= b
      const has = (style: string) => spans.some((span) => span.style === style && over(span))
      // In a code block the line is tinted, not the run.
      const looks = [has('bold') && styles.bold, has('italic') && styles.italic, has('strike') && styles.strike, !inBlock && has('code') && styles.code, markers.some(over) && styles.marker, !inMark && anchorAt === a && layerStyles.anchor]
      return looks.some(Boolean) ? <span key={a} {...stylex.props(...looks)}>{value.slice(a, b)}</span> : value.slice(a, b)
    })
  }
  const out: ReactNode[] = []
  let at = start
  for (const mark of marks) {
    if (mark.start < at || mark.end > end) continue
    out.push(...text(at, mark.start, false))
    // The anchor inside a mark is the mark: the link editor lines up under linked words.
    const anchored = anchorAt !== undefined && anchorAt >= mark.start && anchorAt < mark.end
    out.push(
      <span key={mark.start} data-mark={mark.look} {...stylex.props(markLook(mark), anchored && layerStyles.anchor)}>
        {text(mark.start, mark.end, true)}
      </span>,
    )
    at = mark.end
  }
  out.push(...text(at, end, false))
  return out
}

const styles = stylex.create({
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
  // Inline code: the code tint behind the run and its backticks.
  code: {
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
})
