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
  Select,
  Text,
  TextField,
  type ActivateEvent,
  type ChipVariant,
  type PhosphorIcon,
} from '@juno/ui'
import { channelIconFor } from './look'
import { RenameField } from './RenameField'

/** Every row is this tall, so the virtual list knows every position without measuring (inventory 10: min-height 52). */
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

const KIND_OPTIONS = [
  { value: 'all', label: 'Channels and DMs' },
  { value: 'channels', label: 'Channels' },
  { value: 'dms', label: 'DMs' },
] as const

const SORT_OPTIONS = [
  { value: 'recent', label: 'Most recent' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'messages', label: 'Most messages' },
] as const

/** The place select's value for "Anywhere". Conversation ids never take it. */
const ANYWHERE = ''

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
            <Text variant="bodySmall" tone="default" weight={unread ? 'semibold' : 'medium'} truncate dir="auto" tooltipWhenTruncated data-row-title="">
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
          {row.preview.text.length === 0 ? (
            row.preview.sender
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
      <span role="gridcell" {...stylex.props(styles.cell)}>
        <Chip variant={status.variant} size={22}>
          {status.label}
        </Chip>
      </span>
      <span role="gridcell" {...stylex.props(styles.cell, styles.end)}>
        <Text variant="ui" tone="subtle" numeric>
          {row.messageCount}
        </Text>
      </span>
      <span role="gridcell" {...stylex.props(styles.cell, styles.end)}>
        <Text variant="ui" tone="muted" numeric>
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
  /** The conversations the place select lists, channels then DMs. */
  readonly places: ReadonlyArray<ChannelRef>
  readonly onStatus: (status: AllTopicsChip) => void
  readonly onKind: (kind: KindFilter) => void
  /** `undefined` is Anywhere. */
  readonly onScope: (scope: string | undefined) => void
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
 * filter, the status chips with their counts and the three selects, then
 * the table. The table is a virtual list (performance 3.5): it lays out
 * `total` rows of a fixed height and draws only those near the viewport,
 * asking the owner for each one. ↑ and ↓ move between rows.
 */
export function AllTopics({
  query,
  onQueryChange,
  filter,
  counts,
  places,
  onStatus,
  onKind,
  onScope,
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
        <div {...stylex.props(styles.filters)}>
          {/* Chips switch on mouse down, like the sidebar's filters (performance 4.1). */}
          <div role="group" aria-label="Status" {...stylex.props(styles.chips)}>
            {CHIPS.map((chip) => (
              <Button
                key={chip.id}
                variant="filter"
                pressed={filter.status === chip.id}
                aria-label={`${chip.label} ${counts[chip.id]}`}
                {...activateHandlers<HTMLButtonElement>(() => onStatus(chip.id))}
              >
                {chip.label}
                <Text variant="ui" tone="subtle" weight="regular" numeric sx={styles.count}>
                  {counts[chip.id]}
                </Text>
              </Button>
            ))}
          </div>
          <div {...stylex.props(styles.selects)}>
            <Select size={30} label="Kind" value={filter.kind} options={KIND_OPTIONS} onChange={(event) => onKind(event.currentTarget.value as KindFilter)} />
            <Select
              size={30}
              label="Where"
              value={filter.scope ?? ANYWHERE}
              options={[{ value: ANYWHERE, label: 'Anywhere' }, ...places.map((place) => ({ value: place.id, label: place.label }))]}
              onChange={(event) => onScope(event.currentTarget.value === ANYWHERE ? undefined : event.currentTarget.value)}
            />
            <Select size={30} label="Sort" value={filter.sort} options={SORT_OPTIONS} onChange={(event) => onSort(event.currentTarget.value as AllTopicsSort)} />
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
          <Text variant="tableHeader" tone="muted" role="columnheader">
            Where
          </Text>
          <Text variant="tableHeader" tone="muted" role="columnheader">
            Status
          </Text>
          <Text variant="tableHeader" tone="muted" role="columnheader" sx={styles.endText}>
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
              <div key={item.key} data-row-index={item.index} {...stylex.props(styles.slot, slotAt(item.start - margin))}>
                {renderRow(item.index, item.index === tabbable)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
})

const rowsHeight = stylex.create({ is: (px: number) => ({ height: px }) }).is
const slotAt = stylex.create({ at: (px: number) => ({ transform: `translateY(${px}px)` }) }).at

const styles = stylex.create({
  page: {
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    minHeight: 0,
    minWidth: 0,
    backgroundColor: colors['--background'],
  },
  head: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-4'],
    paddingBlock: `${spacing['--space-8']} ${spacing['--space-4']}`,
    paddingInline: spacing['--space-10'],
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: colors['--border-subtle'],
  },
  filters: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing['--space-2'],
  },
  chips: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: spacing['--space-0-5'],
  },
  count: {
    marginInlineStart: spacing['--space-1-5'],
  },
  selects: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: spacing['--space-1-5'],
  },
  scroller: {
    position: 'relative',
    flexGrow: 1,
    minHeight: 0,
    overflow: 'auto',
    overscrollBehavior: 'contain',
  },
  table: {
    minWidth: layout['--all-topics-table-min'],
    paddingBlock: `${spacing['--space-1']} ${spacing['--space-10']}`,
    paddingInline: spacing['--space-7'],
    boxSizing: 'border-box',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: layout['--all-topics-columns'],
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
  // Each row's box is fixed and contained, so a row entering or leaving lays out only itself.
  slot: {
    position: 'absolute',
    top: 0,
    insetInline: 0,
    height: sizes['--row-52'],
    contain: 'strict',
  },
  row: {
    cursor: 'default',
    userSelect: 'none',
    contain: 'content',
    paddingBlock: spacing['--space-2'],
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
    display: 'flex',
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
})
