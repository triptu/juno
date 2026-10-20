/**
 * The layer of a `Textarea` with `format`, one block per line, so a quote
 * or a code block can tint the whole line. A chunk of its own, loaded when
 * a layered field mounts (`Textarea`); until then the layer draws plain text. Nothing here changes a glyph's width: bold is
 * a stroke, italic is the slant the browser draws for a font with no
 * italic face (the field's has none), code is a tint in the field's font.
 */
import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { colors, radii, spacing } from '@juno/tokens/tokens.stylex'
import { layerStyles, markLook } from './internal/textareaLayer'
import type { TextareaFormat, TextareaMark, TextareaRange } from './Textarea'

/** How much the bold stroke thickens a stem: about the body text's 400 to the messages' 600 (measured, see the decision log). */
const BOLD_STROKE = '0.035em' // tokens-allow: A glyph stroke, not a size.

const ZERO_WIDTH_SPACE = '\u200b'

/** The text as the layer draws it, a block per line. An empty line holds a zero-width space, so it keeps its height. */
export function drawnLines(value: string, marks: ReadonlyArray<TextareaMark>, format: TextareaFormat | undefined, anchorAt: number | undefined): ReactNode[] {
  const quoted = new Set(format?.quotes.map((range) => range.start))
  let start = 0
  let afterQuote = false
  return value.split('\n').map((line, index) => {
    const end = start + line.length
    const block = format?.codeBlocks.find((range) => range.start <= start && end <= range.end)
    const quote = quoted.has(start)
    const drawn = runs(value, start, end, marks, format, block !== undefined, anchorAt)
    // The first and last line of a block round its outer corners; a code block's edge goes round its outside.
    const first = block === undefined ? quote && !afterQuote : block.start === start
    const last = block === undefined ? quote && !quoted.has(end + 1) : block.end === end
    afterQuote = quote
    start = end + 1
    const looks = [
      styles.line,
      quote && styles.quote,
      block !== undefined && styles.codeBlock,
      block !== undefined && (first ? (last ? edges.only : edges.first) : last ? edges.last : edges.middle),
      (quote || block !== undefined) && first && styles.first,
      (quote || block !== undefined) && last && styles.last,
    ]
    return (
      <div key={index} data-testid={block !== undefined ? 'textarea-code-block' : quote ? 'textarea-quote' : undefined} {...stylex.props(...looks)}>
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
      return looks.some(Boolean) ? <span key={a} data-testid={['bold', 'italic', 'strike', 'code'].filter(has).map((style) => `textarea-${style}`).join(' ') || undefined} {...stylex.props(...looks)}>{value.slice(a, b)}</span> : value.slice(a, b)
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

/** The text as runs: plain text, chips, and the anchor character. A trailing newline keeps its empty line. */
export function drawn(value: string, marks: ReadonlyArray<TextareaMark>, anchorAt: number | undefined): ReactNode[] {
  const out: ReactNode[] = []
  let at = 0
  const plain = (end: number) => {
    if (end <= at) return
    if (anchorAt !== undefined && anchorAt >= at && anchorAt < end) {
      if (anchorAt > at) out.push(value.slice(at, anchorAt))
      out.push(
        <span key="anchor" {...stylex.props(layerStyles.anchor)}>
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
    out.push(
      <span key={mark.start} data-mark={mark.look} {...stylex.props(markLook(mark), anchored && layerStyles.anchor)}>
        {value.slice(mark.start, mark.end)}
      </span>,
    )
    at = mark.end
  }
  plain(value.length)
  if (value.endsWith('\n')) out.push('\u200b')
  return out
}


const styles = stylex.create({
  line: { unicodeBidi: 'plaintext' },
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
  // A code block's lines: one block as messages draw one (the inset surface: the page background inside a
  // 1px edge, `CodeBlock`), reaching into the layer's inset. Dark mode tells it from a quote's lighter fill.
  codeBlock: {
    paddingInline: spacing['--space-1'],
    marginInline: `calc(-1 * ${spacing['--space-1']})`,
    backgroundColor: colors['--background'],
  },
  // As messages draw a quote (inventory 6.3): the soft fill and the subtle colour, reaching into the layer's inset.
  quote: {
    paddingInline: spacing['--space-1'],
    marginInline: `calc(-1 * ${spacing['--space-1']})`,
    backgroundColor: colors['--quote-fill'],
    color: colors['--foreground-subtle'],
  },
  first: {
    borderStartStartRadius: radii['--radius-md'],
    borderStartEndRadius: radii['--radius-md'],
  },
  last: {
    borderEndStartRadius: radii['--radius-md'],
    borderEndEndRadius: radii['--radius-md'],
  },
})

/** A code block's 1px edge, drawn inside each line's box so no glyph moves: the sides on every line, the top on its first, the bottom on its last. */
const edges = stylex.create({
  middle: {
    boxShadow: `inset 1px 0 ${colors['--border-default']}, inset -1px 0 ${colors['--border-default']}`, // tokens-allow: The edge is a 1px hairline.
  },
  first: {
    boxShadow: `inset 1px 0 ${colors['--border-default']}, inset -1px 0 ${colors['--border-default']}, inset 0 1px ${colors['--border-default']}`, // tokens-allow: The edge is a 1px hairline.
  },
  last: {
    boxShadow: `inset 1px 0 ${colors['--border-default']}, inset -1px 0 ${colors['--border-default']}, inset 0 -1px ${colors['--border-default']}`, // tokens-allow: The edge is a 1px hairline.
  },
  only: {
    boxShadow: `inset 0 0 0 1px ${colors['--border-default']}`, // tokens-allow: The edge is a 1px hairline.
  },
})
