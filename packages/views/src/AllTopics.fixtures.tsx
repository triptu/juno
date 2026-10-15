import { defineFixtures, scene } from '@juno/ui'
import type { AllTopicsCounts, ChannelRef, TopicRow } from '@juno/contract'
import { AllTopics, AllTopicsPlaceholderRow, AllTopicsRow, type AllTopicsFilterState, type AllTopicsProps } from './AllTopics'
import { channels, NOW, rows } from './fixtures/topics'
import { relativeTime } from './time'

const noop = () => {}

/** The sidebar fixtures' rows, with the statuses All topics shows besides open. */
const table: ReadonlyArray<TopicRow> = [
  rows.alertsMain,
  rows.postgres,
  { ...rows.hiring, pinned: true, section: 'pinned' },
  rows.roadmap,
  rows.mayaMain,
  { ...rows.pricing, status: 'resolved', resolved: true },
  rows.offsite,
  { ...rows.notes, status: 'quiet' },
  { ...rows.packet, status: 'unsubscribed', subscribed: false },
  { ...rows.lunch, status: 'quiet' },
]

const counts = (list: ReadonlyArray<TopicRow>): AllTopicsCounts => {
  const out = { all: list.length, open: 0, resolved: 0, quiet: 0, unsubscribed: 0 }
  for (const row of list) out[row.status]++
  return out
}

const places: ReadonlyArray<ChannelRef> = Object.values(channels).map((entry: TopicRow['channel']) => {
  const { partner, ...channel } = entry
  return partner === undefined ? channel : { ...channel, partnerId: partner.id }
})

const renderRows =
  (list: ReadonlyArray<TopicRow>, loaded: (index: number) => boolean = () => true) =>
  (index: number, tabbable: boolean) => {
    const row = list[index % list.length]!
    if (!loaded(index)) return <AllTopicsPlaceholderRow position={index} />
    return <AllTopicsRow row={row} time={relativeTime(row.lastActivityAt, NOW)} position={index} tabbable={tabbable} onOpen={noop} onContextMenu={noop} />
  }

const props = (overrides: Partial<AllTopicsProps> & { readonly list?: ReadonlyArray<TopicRow> } = {}): AllTopicsProps => {
  const { list = table, ...rest } = overrides
  const filter: AllTopicsFilterState = { status: 'all', kind: 'all', sort: 'recent' }
  return {
    query: '',
    onQueryChange: noop,
    filter,
    counts: counts(table),
    places,
    onStatus: noop,
    onKind: noop,
    onScope: noop,
    onSort: noop,
    ready: true,
    total: list.length,
    rowKey: (index) => `${index}`,
    renderRow: renderRows(list),
    listKey: 'all',
    onClearFilters: noop,
    ...rest,
  }
}

const resolvedOnly = table.filter((row) => row.status === 'resolved')

const page = (overrides?: Parameters<typeof props>[0], frame = { width: 1000, height: 640 }) =>
  scene<AllTopicsProps>(() => <AllTopics {...props(overrides)} />, { ...frame, padded: false })

export default defineFixtures(
  AllTopics,
  {
    State: {
      default: page(),
      // Shot 40b: the Resolved chip.
      resolved: page({ list: resolvedOnly, filter: { status: 'resolved', kind: 'all', sort: 'recent' } }),
      // Shot 40c.
      empty: page({ list: [], query: 'nothing like this', counts: { all: 0, open: 0, resolved: 0, quiet: 0, unsubscribed: 0 } }),
      // Before the first window: the chrome, and no rows yet.
      loading: page({ list: [], ready: false }),
      'narrowed-to-a-channel': page({ list: [rows.postgres], filter: { status: 'all', kind: 'channels', scope: channels.eng.id, sort: 'messages' } }),
    },
    Size: {
      // The topic column keeps its minimum width and the table scrolls sideways.
      narrow: page(undefined, { width: 520, height: 560 }),
      wide: page(undefined, { width: 1400, height: 640 }),
    },
    Window: {
      // 5,000 topics, with the window at the top: the rows below it are placeholders until the window moves to them.
      'large-list': page({ total: 5_000, renderRow: renderRows(table, (index) => index < 8) }),
    },
  },
)
