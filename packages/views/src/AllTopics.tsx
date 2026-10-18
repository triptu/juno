import * as stylex from '@stylexjs/stylex'
import { Hash } from '@phosphor-icons/react/dist/icons/Hash'
import { Lock } from '@phosphor-icons/react/dist/icons/Lock'
import { MagnifyingGlass } from '@phosphor-icons/react/dist/icons/MagnifyingGlass'
import { PushPin } from '@phosphor-icons/react/dist/icons/PushPin'
import { User } from '@phosphor-icons/react/dist/icons/User'
import { Users } from '@phosphor-icons/react/dist/icons/Users'
import { useVirtualizer } from '@tanstack/react-virtual'
import { memo, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import type { AllTopicsChip, AllTopicsCounts, AllTopicsSort, ChannelRef, KindFilter, TopicRow } from '@juno/contract'
import { accent, colors, layout, radii, sizes, spacing } from '@juno/tokens/tokens.stylex'
import {
  activateHandlers,
  Button,
  channelIcons,
  Chip,
  EmptyState,
  Icon,
  PageHeader,
  pointerMoved,
  Segmented,
  Select,
  Text,
  TextField,
  type ActivateEvent,
  type ChipVariant,
  type PhosphorIcon,
} from '@juno/ui'
import { inField } from './fieldMenu'
import { channelIconFor } from './look'
import { RenameField } from './RenameField'

/** Minimum row height; the virtualizer measures wrapped titles (inventory 10). */
const ROW_HEIGHT = 52
/** Rows drawn beyond the viewport on each side (performance 3.5). */
const OVERSCAN = 6

const CHIPS: ReadonlyArray<{ readonly id: AllTopicsChip; readonly label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'quiet', label: 'Quiet' },
  { id: 'unsubscribed', label: 'Unfollowed' },
]

const STATUS: Record<TopicRow['status'], { readonly label: string; readonly variant: ChipVariant }> = {
  open: { label: 'Open', variant: 'filled' },
  resolved: { label: 'Resolved', variant: 'success' },
  quiet: { label: 'Quiet', variant: 'quiet' },
  unsubscribed: { label: 'Unfollowed', variant: 'quiet' },
}

const KIND_OPTIONS: ReadonlyArray<{ readonly value: KindFilter; readonly label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'channels', label: 'Channels' },
  { value: 'dms', label: 'DMs' },
]

const SORT_OPTIONS = [
  { value: 'recent', label: 'Most recent' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'messages', label: 'Most messages' },
] as const

export interface AllTopicsRowProps {
  readonly row: TopicRow
  /** The relative time, already formatted ("3m"). */
  readonly time: string
  /** Position in the whole list, from 1, for `aria-rowindex`. */
  readonly position: number
  /** Roving tabindex: the one row Tab reaches. */
  readonly tabbable: boolean
  /** Mouse down or Enter; `event.metaKey` asks for a new tab. */
  readonly onOpen: (id: string, event: ActivateEvent) => void
  /** Right-click, or the context-menu key (which the platform sends as a context menu event). */
  readonly onContextMenu: (id: string) => void
  /** Pointer enter (a real move, not content scrolling under a still pointer) or keyboard focus: warm the topic's query. */
  readonly onPrefetch?: (id: string) => void
  /** The title is a field for Rename: the row does not open until it ends. */
  readonly renaming?: boolean
  /** Rename saved (Enter or leaving the field) with the text as typed. */
  readonly onRename?: (id: string, title: string) => void
  /** Rename cancelled (Esc). */
  readonly onRenameCancel?: (id: string) => void
}

/**
 * One row of the All topics table (inventory 10): the title with the Main
 * tag and a pin, the "Sender: text" preview, where it lives, the status
 * chip, the message count and the last update. The row opens on mouse down
 * and carries the topic's menu.
 */
export const AllTopicsRow = memo(function AllTopicsRow({
  row,
  time,
  position,
  tabbable,
  onOpen,
  onContextMenu,
  onPrefetch,
  renaming = false,
  onRename,
  onRenameCancel,
}: AllTopicsRowProps) {
  const unread = row.unreadCount > 0
  const status = STATUS[row.status]
  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onPrefetch?.(row.id)
  }
  const activate = activateHandlers<HTMLDivElement>((event) => onOpen(row.id, event), { disabled: renaming })
  return (
    <div
      role="row"
      aria-rowindex={position + 1}
      tabIndex={tabbable ? 0 : -1}
      data-all-topics-row=""
      data-topic-id={row.id}
      onPointerEnter={onPrefetch === undefined ? undefined : (event: PointerEvent<HTMLDivElement>) => pointerMoved(event) && onPrefetch(row.id)}
      onFocus={onFocus}
      onContextMenu={(event: MouseEvent<HTMLDivElement>) => {
        if (inField(event)) return
        event.preventDefault()
        onContextMenu(row.id)
      }}
      {...activate}
      {...stylex.props(styles.grid, styles.row)}
    >
      <span role="gridcell" {...stylex.props(styles.topic)}>
        <span {...stylex.props(styles.titleLine)}>
          {renaming ? (
            <RenameField title={row.title} size="row" onSave={(title) => onRename?.(row.id, title)} onCancel={() => onRenameCancel?.(row.id)} />
          ) : (
            <Text variant="bodySmall" tone="default" weight={unread ? 'semibold' : 'medium'} topicTitle dir="auto" tooltipWhenTruncated data-row-title="" data-sensitive={row.kind !== 'main' && row.titleSensitive === true ? '' : undefined}>
              {row.kind === 'main' ? row.channel.label : row.title}
            </Text>
          )}
          {row.kind === 'main' ? (
            <Chip variant="outline" size={18}>
              Main
            </Chip>
          ) : null}
          {row.pinned ? (
            <span {...stylex.props(styles.pin)} title="Pinned">
              <Icon icon={PushPin} size={12} label="Pinned" />
            </span>
          ) : null}
        </span>
        <Text variant="meta" tone="muted" truncate dir="auto" data-sensitive="">
          {row.preview.text.length === 0 || row.preview.sender.length === 0 ? (
            row.preview.text || row.preview.sender
          ) : (
            <>
              <bdi>{row.preview.sender}</bdi>: {row.preview.text}
            </>
          )}
        </Text>
      </span>
      <span role="gridcell" {...stylex.props(styles.where)}>
        {row.channel.kind === 'private' ? <Icon icon={Lock} size={13} label="Private channel" /> : <Icon icon={whereIcon(row.channel)} size={13} />}
        <Text variant="ui" tone="subtle" truncate dir="auto" tooltipWhenTruncated>
          {row.channel.name}
        </Text>
      </span>
      <span role="gridcell" {...stylex.props(styles.cell, styles.status)}>
        <Chip variant={status.variant} size={22}>
          {status.label}
        </Chip>
      </span>
      <span role="gridcell" {...stylex.props(styles.cell, styles.end, styles.messages)}>
        <Text variant="ui" tone="subtle" numeric sx={styles.messageCount}>
          {row.messageCount}
        </Text>
      </span>
      <span role="gridcell" {...stylex.props(styles.cell, styles.end)}>
        <Text variant="ui" tone="muted" numeric sx={styles.time}>
          {time}
        </Text>
      </span>
    </div>
  )
})

/** A row whose topic is not in the window yet: the row's box and divider, nothing else (no spinner, final geometry). */
export function AllTopicsPlaceholderRow({ position }: { readonly position: number }) {
  return <div role="row" aria-rowindex={position + 1} aria-busy="true" {...stylex.props(styles.grid, styles.row, styles.placeholder)} />
}

/** The channel's own icon, or a person for DMs, as on a sidebar row's line three. A private channel shows the lock instead. */
function whereIcon(channel: Pick<ChannelRef, 'kind' | 'icon'>): PhosphorIcon {
  switch (channel.kind) {
    case 'im':
      return User
    case 'mpim':
      return Users
    default: {
      const name = channelIconFor(channel.icon)
      return name === undefined ? Hash : channelIcons[name]
    }
  }
}

export interface AllTopicsFilterState {
  readonly status: AllTopicsChip
  readonly kind: KindFilter
  readonly scope?: string | undefined
  readonly sort: AllTopicsSort
}

export interface AllTopicsProps {
  /** The text filter as typed. */
  readonly query: string
  readonly onQueryChange: (text: string) => void
  readonly filter: AllTopicsFilterState
  readonly counts: AllTopicsCounts
  /** The place filter: a `PlacePicker`, wired by the owner. */
  readonly place: ReactNode
  readonly onStatus: (status: AllTopicsChip) => void
  readonly onKind: (kind: KindFilter) => void
  readonly onSort: (sort: AllTopicsSort) => void
  /** False until the first rows have arrived: the table draws nothing yet. */
  readonly ready: boolean
  /** Rows in the whole list. */
  readonly total: number
  /** A stable key for the row at `index`: its topic id when known. */
  readonly rowKey: (index: number) => string
  /** The row at `index`, or its placeholder. `tabbable` is the roving tabindex. */
  readonly renderRow: (index: number, tabbable: boolean) => ReactNode
  /** The rows on screen changed, as indexes into the whole list. */
  readonly onVisibleRange?: (start: number, end: number) => void
  /** Changes when the list is replaced (a new filter): the table scrolls back to the top. */
  readonly listKey: string
  readonly onClearFilters: () => void
}

/**
 * The All topics page (spec section 11, inventory 10): the title and text
 * filter; the status tabs with their counts, the kind, the place and the
 * sort; then the table. The table is a virtual list (performance 3.5): it lays out
 * `total` rows of a fixed height and draws only those near the viewport,
 * asking the owner for each one. ↑ and ↓ move between rows.
 */
export function AllTopics({
  query,
  onQueryChange,
  filter,
  counts,
  place,
  onStatus,
  onKind,
  onSort,
  ready,
  total,
  rowKey,
  renderRow,
  onVisibleRange,
  listKey,
  onClearFilters,
}: AllTopicsProps) {
  return (
    <div {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.head)}>
        <PageHeader
          title="All topics"
          size="compact"
          subtitle="Everything you're part of, including quiet, resolved and unfollowed topics."
          trailing={
            <TextField
              size={34}
              leadingIcon={MagnifyingGlass}
              placeholder="Filter by title or message"
              width="search"
              label="Filter topics"
              value={query}
              onChange={(event) => onQueryChange(event.currentTarget.value)}
            />
          }
        />
        <div data-all-topics-filters="" {...stylex.props(styles.filters)}>
          <span {...stylex.props(styles.statusTabs)}>
            <Segmented
              label="Status"
              value={filter.status}
              options={CHIPS.map((chip) => ({ value: chip.id, label: chip.label, count: counts[chip.id] }))}
              onChange={onStatus}
            />
          </span>
          <span {...stylex.props(styles.statusMenu)}>
            <Select
              size={28}
              label="Status"
              value={filter.status}
              options={CHIPS.map((chip) => ({ value: chip.id, label: `${chip.label} (${counts[chip.id]})` }))}
              onChange={(event) => onStatus(event.currentTarget.value as AllTopicsChip)}
            />
          </span>
          <div {...stylex.props(styles.controls)}>
            <Segmented label="Kind" value={filter.kind} options={KIND_OPTIONS} onChange={onKind} />
            {place}
            <Select size={28} label="Sort" value={filter.sort} options={SORT_OPTIONS} onChange={(event) => onSort(event.currentTarget.value as AllTopicsSort)} />
          </div>
        </div>
      </div>
      <Table ready={ready} total={total} rowKey={rowKey} renderRow={renderRow} onVisibleRange={onVisibleRange} listKey={listKey} onClearFilters={onClearFilters} />
    </div>
  )
}

type TableProps = Pick<AllTopicsProps, 'ready' | 'total' | 'rowKey' | 'renderRow' | 'onVisibleRange' | 'listKey' | 'onClearFilters'>

/**
 * The table, on its own so that a scroll, which re-renders the component
 * that holds the virtualizer, re-renders only the table and not the chips
 * and selects above it.
 */
const Table = memo(function Table({ ready, total, rowKey, renderRow, onVisibleRange, listKey, onClearFilters }: TableProps) {
  const scroller = useRef<HTMLDivElement>(null)
  const rowsBox = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(0)
  // Where the rows start inside the scroller, under the table's padding and header row. Read once, before the first paint.
  const [margin, setMargin] = useState(ROW_HEIGHT)
  const empty = ready && total === 0
  useLayoutEffect(() => {
    if (rowsBox.current !== null) setMargin(rowsBox.current.offsetTop)
  }, [empty])
  // The virtualizer returns functions the React Compiler cannot memoize, so the compiler leaves this component as written.
  // It renders only the rows near the viewport, and each row is memoized by its owner.
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: total,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
    getItemKey: rowKey,
    scrollMargin: margin,
    onChange: (instance) => {
      const range = instance.range
      if (range !== null) onVisibleRange?.(range.startIndex, range.endIndex)
    },
  })

  // A new list starts at the top, with the first row tabbable.
  const shownKey = useRef(listKey)
  useLayoutEffect(() => {
    if (shownKey.current === listKey) return
    shownKey.current = listKey
    setActive(0)
    if (scroller.current !== null) scroller.current.scrollTop = 0
  }, [listKey])

  const tabbable = Math.min(active, Math.max(0, total - 1))

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    if (event.target instanceof HTMLInputElement) return
    const from = (event.target as HTMLElement).closest<HTMLElement>('[data-row-index]')
    if (from === null) return
    event.preventDefault()
    const next = Math.max(0, Math.min(total - 1, Number(from.dataset['rowIndex']) + (event.key === 'ArrowDown' ? 1 : -1)))
    setActive(next)
    virtualizer.scrollToIndex(next, { align: 'auto' })
    requestAnimationFrame(() => scroller.current?.querySelector<HTMLElement>(`[data-row-index="${next}"] [role="row"]`)?.focus({ preventScroll: true }))
  }

  const items = virtualizer.getVirtualItems()

  return (
    <div ref={scroller} role="grid" aria-label="All topics" aria-rowcount={total + 1} data-all-topics-table="" onKeyDown={onKeyDown} {...stylex.props(styles.scroller)}>
      <div {...stylex.props(styles.table)}>
        <div role="row" aria-rowindex={1} {...stylex.props(styles.grid, styles.header)}>
          <Text variant="tableHeader" tone="muted" role="columnheader">
            Topic
          </Text>
          <Text variant="tableHeader" tone="muted" role="columnheader" sx={styles.whereHeader}>
            Where
          </Text>
          <Text variant="tableHeader" tone="muted" role="columnheader" sx={styles.statusHeader}>
            Status
          </Text>
          <Text variant="tableHeader" tone="muted" role="columnheader" sx={[styles.endText, styles.messagesHeader]}>
            Msgs
          </Text>
          <Text variant="tableHeader" tone="muted" role="columnheader" sx={styles.endText}>
            Updated
          </Text>
        </div>
        {empty ? (
          <EmptyState
            illustration="nothing-here"
            title="No topics match these filters."
            action={
              <Button variant="secondary" size="md" onClick={onClearFilters}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <div ref={rowsBox} {...stylex.props(styles.rows, rowsHeight(virtualizer.getTotalSize()))}>
            {items.map((item) => (
              <div key={item.key} data-index={item.index} ref={virtualizer.measureElement} data-row-index={item.index} {...stylex.props(styles.slot, slotAt(item.start - margin))}>
                {renderRow(item.index, item.index === tabbable)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
})

// The tiers are measured on the page, so the header and the table change together. Each keeps 16px for a scrollbar
// beside the table.
// Where's minimum (72) plus the other columns' minimums (432), four gaps (64), the row's padding (24) and the table's (56):
// under this the Where column would cut its own header, so it hides and the others keep their room.
const NARROW = '@container all-topics (width < 664px)'
// The same without Where: the other minimums (432), three gaps (48), the row's padding and the table's (80). Under this
// Msgs hides too.
const NARROWER = '@container all-topics (width < 576px)'
// Under the narrowest columns' 500px (the minimum window with the sidebar shown is 336): the status tabs become a pop-up
// button, as Finder's view control does in a narrow window; Status hides from the table, the title takes the rest and
// the side padding narrows, so the table never scrolls sideways and a focused row's ring stays whole.
const COMPACT = '@container all-topics (width < 516px)'
// StyleX does not keep the order of conditions on one property, so the grid's three tiers do not overlap.
const NARROW_ONLY = '@container all-topics (576px <= width < 664px)'
const NARROWER_ONLY = '@container all-topics (516px <= width < 576px)'

const rowsHeight = stylex.create({ is: (px: number) => ({ height: px }) }).is
const slotAt = stylex.create({ at: (px: number) => ({ transform: `translateY(${px}px)` }) }).at

const styles = stylex.create({
  // Stretched, so its width never comes from its content: the page is a size container.
  page: {
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    alignSelf: 'stretch',
    width: '100%',
    minHeight: 0,
    minWidth: 0,
    backgroundColor: colors['--background'],
    containerType: 'inline-size',
    containerName: 'all-topics',
  },
  head: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-4'],
    paddingBlock: `${spacing['--space-8']} ${spacing['--space-4']}`,
    // On the table's text edge: its padding plus the row's.
    paddingInline: { default: spacing['--space-10'], [COMPACT]: spacing['--space-5'] },
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: colors['--border-subtle'],
  },
  // The status tabs, then the other controls at the end; on a narrow window the controls wrap under the tabs, then onto more lines.
  filters: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: { default: 'space-between', [COMPACT]: 'flex-start' },
    gap: spacing['--space-2'],
  },
  statusTabs: {
    display: { default: 'contents', [COMPACT]: 'none' },
  },
  statusMenu: {
    display: { default: 'none', [COMPACT]: 'contents' },
  },
  // In a compact page the controls flow with the status pop-up, so the four take two lines, not three.
  controls: {
    display: { default: 'flex', [COMPACT]: 'contents' },
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing['--space-2'],
    minWidth: 0,
  },
  time: { width: sizes['--topic-time-width'] },
  messageCount: { width: sizes['--control-40'] },
  scroller: {
    position: 'relative',
    flexGrow: 1,
    minHeight: 0,
    overflow: 'auto',
    scrollbarGutter: 'stable',
    overscrollBehavior: 'contain',
  },
  table: {
    paddingBlock: `${spacing['--space-1']} ${spacing['--space-10']}`,
    paddingInline: { default: spacing['--space-7'], [COMPACT]: spacing['--space-2'] },
    boxSizing: 'border-box',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: { default: layout['--all-topics-columns'], [NARROW_ONLY]: layout['--all-topics-columns-narrow'], [NARROWER_ONLY]: layout['--all-topics-columns-narrowest'], [COMPACT]: layout['--all-topics-columns-compact'] },
    columnGap: spacing['--space-4'],
    alignItems: 'center',
    boxSizing: 'border-box',
    height: sizes['--row-52'],
    paddingInline: spacing['--space-3'],
  },
  header: {
    position: 'sticky',
    top: 0,
    zIndex: 1,
    backgroundColor: colors['--background'],
    userSelect: 'none',
  },
  rows: {
    position: 'relative',
  },
  // Measure each visible slot; wrapped titles determine its height.
  slot: {
    position: 'absolute',
    top: 0,
    insetInline: 0,
    contain: 'content',
  },
  row: {
    height: 'calc-size(auto, round(up, size, 1px))', // tokens-allow: whole pixels match the virtualizer’s rounded measurements
    minHeight: sizes['--row-52'],
    cursor: 'default',
    userSelect: 'none',
    contain: 'content',
    paddingBlock: spacing['--space-1-5'],
    borderRadius: radii['--radius-lg'],
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: colors['--border-subtle'],
    backgroundColor: {
      default: 'transparent',
      ':hover': { default: null, '@media (hover: hover)': colors['--surface-hover'] },
    },
    outlineStyle: { default: 'none', ':focus-visible': 'solid' },
    outlineWidth: sizes['--focus-ring-width'],
    outlineOffset: `calc(-1 * ${sizes['--focus-ring-width']})`,
    outlineColor: accent['--focus-ring'],
  },
  whereHeader: {
    display: { default: 'block', [NARROW]: 'none' },
  },
  placeholder: {
    backgroundColor: 'transparent',
  },
  topic: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
  },
  titleLine: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-1-5'],
    minWidth: 0,
  },
  pin: {
    display: 'inline-flex',
    flexShrink: 0,
    color: colors['--foreground-muted'],
  },
  where: {
    display: { default: 'flex', [NARROW]: 'none' },
    alignItems: 'center',
    gap: spacing['--space-1-5'],
    minWidth: 0,
    color: colors['--foreground-subtle'],
  },
  cell: {
    display: 'flex',
    minWidth: 0,
  },
  end: {
    justifyContent: 'flex-end',
  },
  endText: {
    textAlign: 'end',
  },
  status: {
    display: { default: 'flex', [COMPACT]: 'none' },
  },
  statusHeader: {
    display: { default: 'block', [COMPACT]: 'none' },
  },
  messages: {
    display: { default: 'flex', [NARROWER]: 'none' },
  },
  messagesHeader: {
    display: { default: 'block', [NARROWER]: 'none' },
  },
})
