/**
 * Slack's markup in composer text (spec section 8), read as Slack's client
 * reads it with "Format messages with markup" on. One grammar serves the
 * send (`composeOutgoing`), the field's look while typing (`markupLayout`)
 * and the formatting keys (`toggleMarkup`), so all three agree.
 *
 * - `*bold*`, `_italic_`, `~strike~` and `` `code` `` style a run on one
 *   line. A marker opens at the line start or after a character that is not
 *   a letter or digit, with no space after it; it closes at the nearest same
 *   marker with no space before it and no letter or digit after it. So
 *   `snake_case_name`, `2*3*4` and a lone `*` stay as typed. Styles nest
 *   (`*bold _and italic_*`); nothing is styled inside code.
 * - Three backticks open a code block anywhere outside a quote line and the
 *   next three close it, across lines. One newline right after the opening
 *   fence and one right before the closing fence belong to the fences.
 *   Without a closing fence the backticks are text.
 * - A line that starts with ">" is a quote line; the ">" and one space after
 *   it are its marker.
 *
 * Mentions, links and emoji shortcodes are opaque: markers inside them do
 * not count, and a styled run can hold them.
 */
import { findLinks } from './links'

export type MarkupStyle = 'bold' | 'italic' | 'strike' | 'code'

export interface MarkupRange {
  readonly start: number
  readonly end: number
}

/** A styled run, its markers excluded. */
export interface MarkupSpan extends MarkupRange {
  readonly style: MarkupStyle
}

/** One line's markup. */
export interface LineMarkup {
  readonly spans: ReadonlyArray<MarkupSpan>
  /** The marker characters. */
  readonly markers: ReadonlyArray<MarkupRange>
}

/** A part of the text: a line (or what a code block leaves of one) or a code block. */
export type MarkupPiece =
  | {
      readonly kind: 'line'
      readonly start: number
      readonly end: number
      /** A quote line's ">" and the space after it. */
      readonly quote?: MarkupRange
    }
  | {
      readonly kind: 'code'
      /** From the opening fence to the end of the closing fence. */
      readonly start: number
      readonly end: number
      /** The code, without the fences and the newlines that belong to them. */
      readonly content: MarkupRange
    }

/** The markup of a whole text, as the field draws it. */
export interface MarkupLayout {
  /** Styled runs without their markers, except that code (a span or a block) takes in its backticks or fences, since the field tints them too. */
  readonly spans: ReadonlyArray<MarkupSpan>
  /** Marker characters: style markers, fences, and quote lines' ">". */
  readonly markers: ReadonlyArray<MarkupRange>
  /** Code blocks, fences included. */
  readonly codeBlocks: ReadonlyArray<MarkupRange>
  /** Quote lines, from the ">" to the end of the line. */
  readonly quotes: ReadonlyArray<MarkupRange>
}

const STYLE_OF: Readonly<Record<string, MarkupStyle>> = { '*': 'bold', _: 'italic', '~': 'strike' }
export const MARKER_OF: Readonly<Record<MarkupStyle, string>> = { bold: '*', italic: '_', strike: '~', code: '`' }
const WORD = /[\p{L}\p{N}\p{M}]/u
const SPACE = /\s/
const FENCE = '```'
const QUOTE_MARKER = /^>[^\S\n]?/
/** A shortcode as the composer writes emoji, known or not: opaque, so `:white_check_mark:` has no italic. */
const SHORTCODE = /:[a-z0-9_+\-']+(?:::skin-tone-[2-6])?:/g

// What a character is to the grammar.
const FREE = 0
/** Inside a mention, link or shortcode. */
const OPAQUE = 1
/** A code span's backticks or content. */
const CODE = 2
const ESCAPED = 3

/** Backslash escapes markup punctuation without changing the text that is sent. */
const ESCAPE = /\\([\\*_~`>])/g
const escapedAt = (text: string, at: number): boolean => {
  let slashes = 0
  while (at > 0 && text[--at] === '\\') slashes++
  return slashes % 2 === 1
}

/** The first entry of the sorted `list` at or after `min`, or -1. */
function firstFrom(list: ReadonlyArray<number>, min: number): number {
  let low = 0
  let high = list.length
  while (low < high) {
    const mid = (low + high) >> 1
    if (list[mid]! < min) low = mid + 1
    else high = mid
  }
  return low < list.length ? list[low]! : -1
}

/**
 * The markup of `text` from `from` to `to`, one line with no newline in it.
 * Offsets are into `text`. Outside the range counts as a line edge.
 * `opaque` ranges (picked mentions, linked words) hold no markers; URLs and
 * shortcodes never do.
 */
export function lineMarkup(text: string, from = 0, to = text.length, opaque: ReadonlyArray<MarkupRange> = []): LineMarkup {
  const kind = new Uint8Array(Math.max(0, to - from))
  const block = (start: number, end: number) => kind.fill(OPAQUE, Math.max(0, start - from), Math.max(0, Math.min(to, end) - from))
  for (const range of opaque) if (range.end > from && range.start < to) block(range.start, range.end)
  const line = text.slice(from, to)
  for (const link of findLinks(line)) block(from + link.start, from + link.end)
  for (const m of line.matchAll(SHORTCODE)) block(from + m.index, from + m.index + m[0].length)

  const escapes: MarkupRange[] = []
  for (const match of line.matchAll(ESCAPE)) {
    const at = from + match.index
    if (kind[at - from] !== FREE) continue
    kind.fill(ESCAPED, at - from, at + 2 - from)
    escapes.push({ start: at, end: at + 1 })
  }
  const inside = (i: number) => i >= from && i < to
  const free = (i: number) => inside(i) && kind[i - from] === FREE
  const isWord = (i: number) => {
    if (!free(i)) return false
    const at = /[\uDC00-\uDFFF]/.test(text[i]!) && i > from ? i - 1 : i
    return WORD.test(String.fromCodePoint(text.codePointAt(at)!))
  }
  const isSpace = (i: number) => !inside(i) || (kind[i - from] === FREE && SPACE.test(text[i]!))
  const spans: MarkupSpan[] = []
  const markers: MarkupRange[] = [...escapes]

  // Code first: nothing inside it is markup.
  const tick = (i: number) => free(i) && text[i] === '`' && !(free(i - 1) && text[i - 1] === '`') && !(free(i + 1) && text[i + 1] === '`')
  for (let i = from; i < to; i++) {
    if (!tick(i) || isWord(i - 1) || isSpace(i + 1)) continue
    let close = -1
    for (let j = i + 2; j < to; j++) {
      if (tick(j) && !isSpace(j - 1) && !isWord(j + 1)) {
        close = j
        break
      }
    }
    if (close < 0) continue
    for (let at = markers.length - 1; at >= 0; at--) {
      const escape = markers[at]!
      if (escape.start > i && escape.end <= close && !/[\\`]/.test(text[escape.end]!)) markers.splice(at, 1)
    }
    kind.fill(CODE, i - from, close + 1 - from)
    spans.push({ start: i + 1, end: close, style: 'code' })
    markers.push({ start: i, end: i + 1 }, { start: close, end: close + 1 })
    i = close
  }

  // Where each marker may close, in order.
  const closers: Record<string, number[]> = { '*': [], _: [], '~': [] }
  for (let i = from; i < to; i++) {
    const marker = text[i]!
    const list = closers[marker]
    if (list === undefined || !free(i) || isSpace(i - 1) || (free(i - 1) && text[i - 1] === marker) || (free(i + 1) && text[i + 1] === marker) || isWord(i + 1)) continue
    list.push(i)
  }
  const parse = (start: number, end: number) => {
    for (let i = start; i < end; i++) {
      const marker = text[i]!
      const style = STYLE_OF[marker]
      if (style === undefined || !free(i)) continue
      if (isWord(i - 1) || (free(i - 1) && text[i - 1] === marker)) continue
      if (i + 1 >= end || isSpace(i + 1) || (free(i + 1) && text[i + 1] === marker)) continue
      const close = firstFrom(closers[marker]!, i + 2)
      if (close < 0 || close >= end) continue
      spans.push({ start: i + 1, end: close, style })
      markers.push({ start: i, end: i + 1 }, { start: close, end: close + 1 })
      parse(i + 1, close)
      i = close
    }
  }
  parse(from, to)
  return { spans, markers }
}

/**
 * `text` as lines, quote lines and code blocks, in order. A line a code
 * block starts or ends in gives the text before or after the block as a
 * line of its own, when there is any.
 */
export function markupPieces(text: string): ReadonlyArray<MarkupPiece> {
  const out: MarkupPiece[] = []
  let at = 0
  // After a code block that ends mid-line, the rest of that line is not a line start: no quote.
  let lineStart = true
  while (at <= text.length) {
    const newline = text.indexOf('\n', at)
    const end = newline < 0 ? text.length : newline
    const quote = lineStart ? QUOTE_MARKER.exec(text.slice(at, end)) : null
    if (quote !== null) {
      out.push({ kind: 'line', start: at, end, quote: { start: at, end: at + quote[0].length } })
    } else {
      const block = codeBlockFrom(text, at, end)
      if (block !== undefined) {
        if (text.slice(at, block.start).trim() !== '') out.push({ kind: 'line', start: at, end: block.start })
        out.push(block)
        const after = text.indexOf('\n', block.end)
        const restEnd = after < 0 ? text.length : after
        if (text.slice(block.end, restEnd).trim() !== '') {
          at = block.end
          lineStart = false
          continue
        }
        if (after < 0) break
        at = after + 1
        lineStart = true
        continue
      }
      out.push({ kind: 'line', start: at, end })
    }
    if (newline < 0) break
    at = newline + 1
    lineStart = true
  }
  return out
}

/** The code block that opens on the line from `at` to `end`, if it closes. */
function codeBlockFrom(text: string, at: number, end: number): Extract<MarkupPiece, { kind: 'code' }> | undefined {
  for (let open = text.indexOf(FENCE, at); open >= 0 && open < end; open = text.indexOf(FENCE, open + 1)) {
    if (escapedAt(text, open)) continue
    let close = text.indexOf(FENCE, open + FENCE.length)
    while (close >= 0 && escapedAt(text, close)) close = text.indexOf(FENCE, close + FENCE.length)
    if (close < 0) return undefined
    let start = open + FENCE.length
    let stop = close
    if (text[start] === '\n') start++
    if (stop > start && text[stop - 1] === '\n') stop--
    // An empty block is text.
    if (stop > start) return { kind: 'code', start: open, end: close + FENCE.length, content: { start, end: stop } }
  }
  return undefined
}

/**
 * Everything the field draws for `text`. `opaque` ranges are the picked
 * mentions and linked words the field shows; markers inside them do not count.
 */
export function markupLayout(text: string, opaque: ReadonlyArray<MarkupRange> = []): MarkupLayout {
  const spans: MarkupSpan[] = []
  const markers: MarkupRange[] = []
  const codeBlocks: MarkupRange[] = []
  const quotes: MarkupRange[] = []
  for (const piece of markupPieces(text)) {
    if (piece.kind === 'code') {
      codeBlocks.push({ start: piece.start, end: piece.end })
      markers.push({ start: piece.start, end: piece.start + FENCE.length }, { start: piece.end - FENCE.length, end: piece.end })
      spans.push({ start: piece.start, end: piece.end, style: 'code' })
      continue
    }
    let from = piece.start
    if (piece.quote !== undefined) {
      quotes.push({ start: piece.start, end: piece.end })
      // The ">" is the marker; the space after it is the quote's own.
      markers.push({ start: piece.quote.start, end: piece.quote.start + 1 })
      from = piece.quote.end
    }
    const line = lineMarkup(text, from, piece.end, opaque)
    spans.push(...line.spans.map((span) => (span.style === 'code' ? { ...span, start: span.start - 1, end: span.end + 1 } : span)))
    markers.push(...line.markers)
  }
  return { spans, markers, codeBlocks, quotes }
}

/** A change to the field's text: put `insert` from `start` to `end`, then select `selection`. */
export interface MarkupEdit {
  readonly start: number
  readonly end: number
  readonly insert: string
  readonly selection: MarkupRange
}

const lineStartOf = (text: string, at: number) => text.lastIndexOf('\n', at - 1) + 1
const lineEndOf = (text: string, at: number) => {
  const newline = text.indexOf('\n', at)
  return newline < 0 ? text.length : newline
}

/**
 * The edit a formatting key makes (⌘B, ⌘I, ⌘⇧X, ⌘⇧C, ⌘⇧9, spec section 8).
 * A style wraps the selection in its markers, or takes them off when they
 * are already there; with no selection it puts in an empty pair with the
 * caret inside, or takes an empty pair away. Spaces at the selection's ends
 * stay outside the markers, and each selected line is wrapped on its own,
 * since a style does not cross lines; code over more than one line is a
 * code block. Quote adds "> " to every selected line, or takes it off when
 * every one has it. Undefined when there is nothing to change.
 */
export function toggleMarkup(text: string, selection: MarkupRange, style: MarkupStyle | 'quote', atomic: ReadonlyArray<MarkupRange> = []): MarkupEdit | undefined {
  for (const range of atomic) {
    if (selection.start < range.end && selection.end > range.start) selection = { start: Math.min(selection.start, range.start), end: Math.max(selection.end, range.end) }
  }
  if (style === 'quote') return toggleQuote(text, selection)
  const marker = MARKER_OF[style]
  const { start, end } = selection
  if (start === end) {
    if (text[start - 1] === marker && text[start] === marker) return { start: start - 1, end: start + 1, insert: '', selection: { start: start - 1, end: start - 1 } }
    return { start, end, insert: marker + marker, selection: { start: start + 1, end: start + 1 } }
  }
  const selected = text.slice(start, end)
  if (style === 'code' && selected.includes('\n')) {
    if (text.slice(start - 4, start) === `${FENCE}\n` && text.slice(end, end + 4) === `\n${FENCE}`) return { start: start - 4, end: end + 4, insert: selected, selection: { start: start - 4, end: end - 4 } }
    return { start, end, insert: `${FENCE}\n${selected}\n${FENCE}`, selection: { start: start + 4, end: end + 4 } }
  }
  const from = start + (selected.length - selected.trimStart().length)
  const to = end - (selected.length - selected.trimEnd().length)
  if (to <= from) return undefined
  const words = text.slice(from, to)
  if (words.includes('\n')) {
    const lines = words.split('\n')
    const wrapped = (line: string) => line.trim().length >= 2 && line.trim().startsWith(marker) && line.trim().endsWith(marker)
    const unwrap = lines.every((line) => line.trim() === '' || wrapped(line))
    const insert = lines
      .map((line) => {
        const core = line.trim()
        if (core === '') return line
        const lead = line.slice(0, line.length - line.trimStart().length)
        const trail = line.slice(line.trimEnd().length)
        return lead + (unwrap ? core.slice(1, -1) : marker + core + marker) + trail
      })
      .join('\n')
    return { start: from, end: to, insert, selection: { start: from, end: from + insert.length } }
  }
  if (text[from - 1] === marker && text[to] === marker) return { start: from - 1, end: to + 1, insert: words, selection: { start: from - 1, end: to - 1 } }
  if (words.length >= 2 && words.startsWith(marker) && words.endsWith(marker)) return { start: from, end: to, insert: words.slice(1, -1), selection: { start: from, end: to - 2 } }
  return { start: from, end: to, insert: marker + words + marker, selection: { start: from + 1, end: to + 1 } }
}

function toggleQuote(text: string, selection: MarkupRange): MarkupEdit {
  const start = lineStartOf(text, selection.start)
  // A selection that ends at the start of a line does not take that line.
  const last = selection.end > selection.start && text[selection.end - 1] === '\n' ? selection.end - 1 : selection.end
  const end = lineEndOf(text, last)
  const lines = text.slice(start, end).split('\n')
  const quoted = lines.every((line) => QUOTE_MARKER.test(line))
  const insert = lines.map((line) => (quoted ? line.replace(QUOTE_MARKER, '') : QUOTE_MARKER.test(line) ? line : `> ${line}`)).join('\n')
  if (selection.start === selection.end) {
    const caret = Math.max(start, selection.start + (quoted ? -(lines[0]!.match(QUOTE_MARKER)?.[0].length ?? 0) : 2))
    return { start, end, insert, selection: { start: caret, end: caret } }
  }
  return { start, end, insert, selection: { start, end: start + insert.length } }
}
