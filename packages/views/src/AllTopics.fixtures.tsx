import { defineFixtures, scene, type FixtureFrame } from '@juno/ui'
import { PrivacyOn } from './fixtures/privacy'
import type { AllTopicsCounts, PickConversations, TopicRow } from '@juno/contract'
import { AllTopics, AllTopicsPlaceholderRow, AllTopicsRow, type AllTopicsFilterState, type AllTopicsProps } from './AllTopics'
import { PlacePicker, type PlacePick, type PlacePickerProps } from './PlacePicker'
import { conversations } from './fixtures/newChat'
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

const eng: PlacePick = { id: channels.eng.id, name: channels.eng.name, kind: channels.eng.kind, tint: channels.eng.tint }

/** The open list with "ma" typed: the DM, the group DM and a channel, by the word search. */
const maQuery: PickConversations = {
  recent: [],
  people: [
    { ...conversations.maya, highlight: [[0, 2]] },
    { ...conversations.group, highlight: [[0, 2]] },
  ],
  channels: [{ key: 'C0MARKETING', name: 'marketing', kind: 'public', tint: 'public', channelId: 'C0MARKETING', empty: false, highlight: [[0, 2]] }],
}

const recent: PickConversations = {
  recent: [conversations.eng, conversations.maya, conversations.hiring, conversations.group, conversations.billing],
  people: [],
  channels: [],
}

const placePicker = (overrides: Partial<PlacePickerProps> = {}) => (
  <PlacePicker place={undefined} open={false} onOpen={noop} query="" onQuery={noop} conversations={undefined} onPick={noop} {...overrides} />
)

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
    place: placePicker(),
    onStatus: noop,
    onKind: noop,
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

const page = (overrides?: Parameters<typeof props>[0], frame: FixtureFrame = { width: 1000, height: 640 }) =>
  scene<AllTopicsProps>(() => <AllTopics {...props(overrides)} />, { ...frame, padded: false })

export default defineFixtures(
  AllTopics,
  {
    Titles: {
      'one-line': page({ list: [rows.long, { ...rows.postgres, title: 'Plan' }, ...table] }, { width: 664, height: 640, topicTitleLines: 'one' }),
      'two-lines': page({ list: [rows.long, { ...rows.postgres, title: 'Plan' }, ...table] }, { width: 664, height: 640, topicTitleLines: 'two' }),
    },
    State: {
      default: page(),
      // Shot 40b: the Resolved chip.
      resolved: page({ list: resolvedOnly, filter: { status: 'resolved', kind: 'all', sort: 'recent' } }),
      // Shot 40c.
      empty: page({ list: [], query: 'nothing like this', counts: { all: 0, open: 0, resolved: 0, quiet: 0, unsubscribed: 0 } }),
      // Before the first window: the chrome, and no rows yet.
      loading: page({ list: [], ready: false }),
      // Privacy mode: the previews blur, and so do titles that are only the first words; AI and renamed titles stay readable.
      privacy: scene<AllTopicsProps>(() => (
        <PrivacyOn>
          <AllTopics {...props()} />
        </PrivacyOn>
      ), { width: 1000, height: 640, padded: false }),
      'narrowed-to-a-channel': page({ list: [rows.postgres], filter: { status: 'all', kind: 'channels', scope: channels.eng.id, sort: 'messages' }, place: placePicker({ place: eng }) }),
    },
    Filters: {
      // Anywhere, every kind, most recent.
      default: page(),
      // A channel picked: the button takes its tint.
      'place-picked': page({ list: [rows.postgres], filter: { status: 'all', kind: 'all', scope: channels.eng.id, sort: 'recent' }, place: placePicker({ place: eng }) }),
      // The picker open with nothing typed: Anywhere first, then recent places.
      'picker-open': page({ place: placePicker({ open: true, conversations: recent }) }),
      // The picker open with "ma" typed: a DM, a group DM and a channel.
      'picker-query': page({ place: placePicker({ open: true, query: 'ma', conversations: maQuery }) }),
      // A narrow window: the controls wrap under the tabs, nothing overlaps.
      narrow: page({ place: placePicker({ place: eng }) }, { width: 560, height: 480 }),
    },
    Size: {
      // Under 560 Msgs hides too, and the table still fits without scrolling sideways.
      narrow: page(undefined, { width: 520, height: 560 }),
      // Under 648 the Where column hides, and the others keep their room.
      'where-hidden': page(undefined, { width: 620, height: 560 }),
      // The minimum window with the sidebar hidden: every column fits.
      'minimum-window': page(undefined, { width: 720, height: 436 }),
      // The minimum window with the sidebar shown (336): the status tabs are a pop-up, Status hides, nothing scrolls sideways.
      'minimum-window-sidebar': page(undefined, { width: 336, height: 436 }),
      // Just under 520: the compact header and table, with a place picked.
      compact: page({ place: placePicker({ place: eng }), filter: { status: 'open', kind: 'all', sort: 'recent' } }, { width: 500, height: 480 }),
      wide: page(undefined, { width: 1400, height: 640 }),
    },
    Window: {
      // 5,000 topics, with the window at the top: the rows below it are placeholders until the window moves to them.
      'large-list': page({ total: 5_000, renderRow: renderRows(table, (index) => index < 8) }),
    },
  },
)
