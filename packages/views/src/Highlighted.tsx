/**
 * Text with the parts a search matched in semibold (spec section 10): a
 * ⌘K row and a destination list row. Ranges are [start, end)
 * offsets into `text`, in order and not overlapping; a range that does not
 * fit is left plain.
 */
import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { colors, weights } from '@juno/tokens/tokens.stylex'

export type TextRanges = ReadonlyArray<readonly [number, number]>

/** `subtle`: in muted text, the matched parts also step up to the subtle colour. */
export function Highlighted({ text, ranges, tone }: { readonly text: string; readonly ranges?: TextRanges | undefined; readonly tone?: 'subtle' }) {
  if (ranges === undefined || ranges.length === 0) return text
  const parts: Array<ReactNode> = []
  let at = 0
  for (const [start, end] of ranges) {
    if (start < at || end > text.length || end <= start) continue
    if (start > at) parts.push(text.slice(at, start))
    parts.push(
      <span key={start} data-match="" {...stylex.props(styles.match, tone === 'subtle' && styles.subtle)}>
        {text.slice(start, end)}
      </span>,
    )
    at = end
  }
  if (at < text.length) parts.push(text.slice(at))
  return <>{parts}</>
}

const styles = stylex.create({
  match: {
    fontWeight: weights['--weight-semibold'],
  },
  subtle: {
    color: colors['--foreground-subtle'],
  },
})
