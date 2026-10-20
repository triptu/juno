import * as stylex from '@stylexjs/stylex'
import { useState, type ReactNode } from 'react'
import type { BodyBlock, BodyInline } from '@juno/contract'
import { colors, radii, spacing, weights } from '@juno/tokens/tokens.stylex'
import { Button } from '@juno/ui'

type Table = Extract<BodyBlock, { kind: 'table' }>

/** Rows shown before "Show all", as Slack's client cuts a table in a message. */
const TABLE_ROWS_SHOWN = 10

/**
 * A Slack table in a message (SPEC section 7, "Tables"): the first row is
 * the header, cells hold message text, and a column keeps to one line unless
 * Slack wraps it. The box is as wide as the table up to the message's width
 * and scrolls sideways inside itself past that, its far edge fading while
 * there is more to see. A table of more than ten
 * rows shows ten and a Show all button that grows it in place.
 */
export function MessageTable({ table, render, tabbable }: { readonly table: Table; readonly render: (inlines: ReadonlyArray<BodyInline>) => ReactNode; readonly tabbable: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const [head, ...body] = table.rows
  const long = table.rows.length > TABLE_ROWS_SHOWN
  const shown = long && !expanded ? body.slice(0, TABLE_ROWS_SHOWN - 1) : body
  const cell = (inlines: ReadonlyArray<BodyInline>, column: number, header: boolean, last: boolean) => {
    const setting = table.columns?.[column]
    const Tag = header ? 'th' : 'td'
    return <Tag key={column} dir="auto" {...(header ? { scope: 'col' } : {})} {...stylex.props(styles.cell, header && styles.header, !last && styles.divided, setting?.wrap ? styles.wrap : styles.line, setting?.align !== undefined && aligns[setting.align])}>{render(inlines)}</Tag>
  }
  return <>
    <div data-msg-table="" {...stylex.props(styles.box)}>
      <table aria-label={table.caption !== undefined && table.showCaption !== true ? table.caption : undefined} {...stylex.props(styles.table)}>
        {table.showCaption && <caption {...stylex.props(styles.caption)}>{table.caption}</caption>}
        {head !== undefined && <thead><tr>{head.map((inlines, column) => cell(inlines, column, true, body.length === 0))}</tr></thead>}
        {shown.length > 0 && <tbody>{shown.map((row, index) => <tr key={index}>{row.map((inlines, column) => cell(inlines, column, false, index === shown.length - 1))}</tr>)}</tbody>}
      </table>
    </div>
    {long && <div data-expands-in-place="" {...stylex.props(styles.more)}>
      <Button size="sm" variant="ghost" tabIndex={tabbable ? 0 : -1} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Show less' : `Show all ${table.rows.length} rows`}</Button>
    </div>}
  </>
}

// While the box can scroll on, its far edge fades, so a table cut between two
// columns never reads as whole. The box's own scroll drives it, so no script
// watches the scroll: a table that fits has no scroll timeline and no fade, and
// the fade goes at the end of the scroll. A mask, so it suits any row background.
const fadeEnd = stylex.keyframes({
  '0%, 99%': { maskImage: `linear-gradient(to left, transparent, black ${spacing['--space-6']})` }, // tokens-allow: a mask's alpha, not a colour that shows.
})

const styles = stylex.create({
  // As wide as the table, never wider than the message: past that it scrolls inside its frame.
  box: {
    width: 'fit-content',
    maxWidth: '100%',
    marginBlock: spacing['--space-0-5'],
    overflowX: 'auto',
    animationName: fadeEnd,
    animationDuration: 'auto',
    animationTimeline: 'scroll(self inline)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colors['--border-default'],
    borderRadius: radii['--radius-md'],
  },
  table: {
    borderCollapse: 'collapse',
    // A wrapped column is never narrower than its longest word.
    overflowWrap: 'break-word',
  },
  caption: {
    textAlign: 'start',
    fontWeight: weights['--weight-semibold'],
    paddingBlock: spacing['--space-1'],
    paddingInline: spacing['--space-2-5'],
  },
  cell: {
    paddingBlock: spacing['--space-1'],
    paddingInline: spacing['--space-2-5'],
    textAlign: 'start',
    verticalAlign: 'top',
  },
  // Quiet: the message's bold on a soft fill, as a quote block's.
  header: {
    fontWeight: weights['--weight-semibold'],
    backgroundColor: colors['--quote-fill'],
  },
  divided: {
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: colors['--border-default'],
  },
  line: { whiteSpace: 'pre' },
  wrap: { whiteSpace: 'pre-wrap' },
  // Show all starts where the table's frame starts: the ghost button's inset and 1px border are pulled back.
  more: {
    display: 'flex',
    marginInlineStart: `calc(-1 * (${spacing['--space-2-5']} + 1px))`, // tokens-allow: the button's 1px border.
  },
})

const aligns = stylex.create({
  center: { textAlign: 'center' },
  right: { textAlign: 'right' },
})
