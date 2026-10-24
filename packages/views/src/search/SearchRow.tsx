/**
 * One row of the Search list (SPEC 10a, "Rows"), as `searchRows` lays them
 * out. Flat: the topic's line (art 16, title, place, time) over the match's
 * (sender, snippet). Grouped: a thread's topic line, its match lines, "N
 * more in this thread"; a run of Main matches under one header. The line
 * where the list stops being complete. Matched words are semibold.
 */
import * as stylex from '@stylexjs/stylex'
import { memo, type ComponentType, type PointerEvent, type ReactNode } from 'react'
import type { SearchGroup, SearchHit } from '@juno/contract'
import { accent, colors, radii, sizes, spacing, text, weights } from '@juno/tokens/tokens.stylex'
import { focusRing, Icon, TopicArt } from '@juno/ui'
import { kindIcon } from '../look'
import { searchTime, tsMillis } from './model'
import type { SearchRowItem } from './rows'

export const searchRowDomId = (id: string) => `search-row-${id}`

export interface SearchRowProps {
  readonly row: SearchRowItem
  readonly now?: number
  readonly time?: ComponentType<{ at: number }>
  readonly selected: boolean
  /** The list or the field has focus: the selection takes the nav tint. */
  readonly focused: boolean
  readonly tabbable: boolean
  readonly onSelect: (id: string, how: 'pointer' | 'keyboard') => void
  readonly onOpen: (id: string, options: { readonly newTab: boolean }) => void
  readonly onExpand: (groupId: string) => void
}

/** Rows keep their object while the snapshot leaves them alone, so a page draws only its own rows. */
export const SearchRow = memo(function SearchRow(props: SearchRowProps) {
  const { row } = props
  if (row.kind === 'older') return <OlderLine />
  if (row.kind === 'mainHeader') return <MainHeader group={row.group} />
  return <Stop {...props} row={row} />
})

function Stop({ row, now, time, selected, focused, tabbable, onSelect, onOpen, onExpand }: SearchRowProps & { readonly row: Exclude<SearchRowItem, { readonly kind: 'older' | 'mainHeader' }> }) {
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.ctrlKey) return
    if (row.kind === 'more') {
      event.preventDefault()
      return onExpand(row.group.id)
    }
    if (event.metaKey) {
      // The tab opens behind this one; focus and the selection stay where they are.
      event.preventDefault()
      return onOpen(row.id, { newTab: true })
    }
    onSelect(row.id, 'pointer')
  }
  const option = { id: searchRowDomId(row.id), tabIndex: tabbable ? 0 : -1, 'data-search-row': row.id, onPointerDown } as const
  if (row.kind === 'more') {
    return (
      <div {...option} role="button" {...stylex.props(styles.line, styles.more, focusRing.inset)}>
        {`${row.count} more in this thread`}
      </div>
    )
  }
  // The selection's tint is the focus indicator, as in ⌘K: no ring on every arrow press (review.md).
  const look = [styles.stop, selected && styles.selected, selected && focused && styles.selectedFocused] as const
  return (
    <div {...option} role="option" aria-selected={selected} {...stylex.props(...shapeOf(row.kind), ...look)}>
      <RowContent row={row} now={now} time={time} />
    </div>
  )
}

const shapeOf = (kind: 'flat' | 'title' | 'topic' | 'match') =>
  kind === 'flat' ? [styles.flat] : kind === 'match' ? [styles.line, styles.matchLine] : kind === 'topic' ? [styles.line, styles.topicLine, styles.groupStart] : [styles.line, styles.topicLine]

function RowContent({ row, now, time: TimeLeaf }: { readonly row: Extract<SearchRowItem, { readonly kind: 'flat' | 'title' | 'topic' | 'match' }>; readonly now?: number
  readonly time?: ComponentType<{ at: number }> }) {
  const art = (size: 16 | 20) => <TopicArt topicId={row.group.topicId} {...(row.group.art === undefined ? {} : { recipe: row.group.art })} size={size} />
  switch (row.kind) {
    case 'flat':
      return (
        <>
          <span {...stylex.props(styles.flatTop)}>
            {art(16)}
            <Title group={row.group} />
            <Where group={row.group} />
            <Time at={tsMillis(row.hit.ts)} now={now} time={TimeLeaf} />
          </span>
          <span {...stylex.props(styles.flatBottom)}>
            <Snippet hit={row.hit} />
          </span>
        </>
      )
    case 'match':
      return (
        <>
          <Snippet hit={row.hit} />
          <Time at={tsMillis(row.hit.ts)} now={now} time={TimeLeaf} />
        </>
      )
    default:
      return (
        <>
          {art(row.kind === 'topic' ? 20 : 16)}
          <Title group={row.group} />
          <Where group={row.group} />
          <Time at={tsMillis(row.group.at)} now={now} time={TimeLeaf} />
        </>
      )
  }
}

function OlderLine() {
  return (
    <div role="presentation" data-search-older="" {...stylex.props(styles.older)}>
      <span>Older matches on this Mac</span>
      <span {...stylex.props(styles.olderRule)} />
    </div>
  )
}

function MainHeader({ group }: { readonly group: SearchGroup }) {
  return (
    <div role="presentation" {...stylex.props(styles.line, styles.topicLine)}>
      <span {...stylex.props(styles.slot)}>
        <Icon icon={kindIcon(group.place.kind)} size={14} />
      </span>
      <span data-sensitive="" {...stylex.props(styles.mainHead)}>
        {group.title}
      </span>
    </div>
  )
}

function Title({ group }: { readonly group: SearchGroup }) {
  return (
    <span data-sensitive="" {...stylex.props(styles.title)}>
      <Marked text={group.title} ranges={group.titleRanges} />
    </span>
  )
}

function Where({ group }: { readonly group: SearchGroup }) {
  if (group.kind === 'main') return null
  return (
    <span {...stylex.props(styles.where)}>
      <Icon icon={kindIcon(group.place.kind)} size={12} />
      <span data-sensitive="" {...stylex.props(styles.whereName)}>
        {group.place.name}
      </span>
    </span>
  )
}

function Time({ at, now = 0, time: TimeLeaf }: { readonly at: number; readonly now?: number
  readonly time?: ComponentType<{ at: number }> }) {
  return <span {...stylex.props(styles.time)}>{TimeLeaf === undefined ? searchTime(at, now) : <TimeLeaf at={at} />}</span>
}

function Snippet({ hit }: { readonly hit: SearchHit }) {
  return (
    <>
      <span data-sensitive="" {...stylex.props(styles.sender)}>
        {hit.sender}
      </span>
      <span data-sensitive="" dir="auto" {...stylex.props(styles.snippet)}>
        <Marked text={hit.text} ranges={hit.ranges} />
      </span>
    </>
  )
}

/** Text with the matched words in semibold and the default colour. Ranges out of order or out of bounds are left plain. */
function Marked({ text: value, ranges }: { readonly text: string; readonly ranges: ReadonlyArray<{ readonly start: number; readonly end: number }> }) {
  if (ranges.length === 0) return value
  const parts: ReactNode[] = []
  let at = 0
  for (const { start, end } of ranges) {
    if (start < at || end > value.length || end <= start) continue
    if (start > at) parts.push(value.slice(at, start))
    parts.push(
      <b key={start} data-match="" {...stylex.props(styles.match)}>
        {value.slice(start, end)}
      </b>,
    )
    at = end
  }
  if (at < value.length) parts.push(value.slice(at))
  return <>{parts}</>
}

const styles = stylex.create({
  // A row the arrows stop on: in flow, laid out only near the view.
  stop: {
    outlineStyle: 'none',
    contain: 'content',
    contentVisibility: 'auto',
    cursor: 'default',
    userSelect: 'none',
  },
  // On the selected fill, the muted time and snippet take their 4.5:1 colour (review.md, finding 3).
  selected: {
    backgroundColor: colors['--secondary-default'],
    '--foreground-muted': colors['--foreground-muted-on-fill'],
  },
  selectedFocused: {
    backgroundColor: accent['--hl-nav'],
  },
  line: {
    display: 'flex',
    alignItems: 'center',
    boxSizing: 'border-box',
    borderRadius: radii['--radius-lg'],
    paddingInline: spacing['--space-2-5'],
    containIntrinsicSize: `auto ${sizes['--control-32']}`,
  },
  topicLine: {
    gap: spacing['--space-2-5'],
    height: sizes['--control-34'],
  },
  groupStart: {
    marginTop: spacing['--space-1'],
  },
  matchLine: {
    gap: spacing['--space-2'],
    height: sizes['--control-32'],
    paddingInlineStart: spacing['--space-10'],
  },
  more: {
    height: sizes['--control-26'],
    marginBottom: spacing['--space-1'],
    paddingInlineStart: spacing['--space-10'],
    color: colors['--foreground-muted'],
    fontSize: text['--text-meta-size'],
    cursor: 'default',
    userSelect: 'none',
  },
  slot: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: sizes['--control-20'],
    color: colors['--foreground-muted'],
  },
  mainHead: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: text['--text-meta-size'],
    fontWeight: weights['--weight-medium'],
    color: colors['--foreground-subtle'],
  },
  // Flat: two lines, the topic's and the match's, the second under the title.
  flat: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    boxSizing: 'border-box',
    height: sizes['--row-52'],
    paddingInline: spacing['--space-2-5'],
    borderRadius: radii['--radius-lg'],
    containIntrinsicSize: `auto ${sizes['--row-52']}`,
  },
  flatTop: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2'],
    minWidth: 0,
    height: sizes['--control-22'],
  },
  flatBottom: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2'],
    minWidth: 0,
    height: sizes['--control-20'],
    paddingInlineStart: spacing['--space-6'],
  },
  title: {
    flexShrink: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: text['--text-row-title-size'],
    fontWeight: weights['--weight-medium'],
    color: colors['--foreground-default'],
  },
  where: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-1'],
    flexShrink: 0,
    maxWidth: '40%',
    whiteSpace: 'nowrap',
    fontSize: text['--text-meta-size'],
    color: colors['--foreground-muted'],
  },
  whereName: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  time: {
    flexShrink: 0,
    marginInlineStart: 'auto',
    paddingInlineStart: spacing['--space-2'],
    whiteSpace: 'nowrap',
    fontSize: text['--text-tag-small-size'],
    fontVariantNumeric: 'tabular-nums',
    color: colors['--foreground-muted'],
  },
  sender: {
    flexShrink: 0,
    maxWidth: '40%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: text['--text-meta-size'],
    color: colors['--foreground-subtle'],
  },
  snippet: {
    flexGrow: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: text['--text-row-preview-size'],
    color: colors['--foreground-muted'],
  },
  match: {
    fontWeight: weights['--weight-semibold'],
    color: colors['--foreground-default'],
  },
  older: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2-5'],
    height: sizes['--control-32'],
    marginTop: spacing['--space-1-5'],
    marginBottom: spacing['--space-0-5'],
    paddingInline: spacing['--space-2-5'],
    whiteSpace: 'nowrap',
    fontSize: text['--text-tag-small-size'],
    fontWeight: weights['--weight-medium'],
    color: colors['--foreground-muted'],
  },
  olderRule: {
    flexGrow: 1,
    height: spacing['--space-pixel'],
    backgroundColor: colors['--border-subtle'],
  },
})
