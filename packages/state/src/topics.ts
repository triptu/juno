/**
 * Atoms for the topics feature (architecture 7). `topicListAtom(filter)` is
 * one filter's sidebar window; the sidebar reads it through
 * `sidebarListAtom` (`sidebar.ts`), which holds the shown window across a
 * filter change. Equal filters share one atom.
 *
 * `topics.list` sends rows that name their channel and people by id, with
 * the channels and people in the delta's `refs`. `topicListAtom` joins them
 * back into the `TopicRow`s the views take. A joined row keeps its object
 * while its wire row and everything it names keep theirs, so a delta that
 * changes one person re-renders only the rows that show that person.
 *
 * The subscribe and unsubscribe commands are run per row with
 * `runCommand(registry, topicsSubscribe, { id })`: a shared command atom
 * runs one call at a time, so a second write would interrupt the first.
 */
import * as Atom from 'effect/reactivity/Atom'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import {
  SIDEBAR_WINDOW,
  topicsCounts,
  topicsList,
  type ChannelRef,
  type KindFilter,
  type Person,
  type RowChannel,
  type TopicListRow,
  type TopicRow,
} from '@juno/contract'
import { liveQuery } from './atoms'
import type { ListWindow, WindowRefs } from './list'

export interface TopicListFilter {
  readonly kind: KindFilter
  readonly unreadOnly: boolean
  readonly scope?: string | undefined
  /** A sidebar view's id. `kind` stays as it was, for when the view is left. */
  readonly view?: string | undefined
}

export const defaultTopicListFilter: TopicListFilter = { kind: 'all', unreadOnly: false }

const listFamily = liveQuery(topicsList)
const countsFamily = liveQuery(topicsCounts)

/** What a joined row was built from, so the next delta can tell whether it still holds. */
interface Joined {
  readonly row: TopicRow
  readonly channel: ChannelRef | undefined
  readonly partner: Person | undefined
  readonly people: ReadonlyArray<Person | undefined>
  readonly art: string | undefined
}

/** By wire row object: rows with an unchanged `rev` keep their object (`applyListDelta`), so this is a hit while nothing changed. */
const joins = new WeakMap<TopicListRow, Joined>()

/** A channel the refs do not name. The engine always sends it; this only keeps a row drawable if it did not. */
const unknownChannel = (id: string): ChannelRef => ({ id, kind: 'public', name: id, label: id, tint: 'public', icon: 'hash', color: 'cyan' })
const unknownPerson = (id: string): Person => ({ id, name: id, color: 'cyan' })

function joinRow(wire: TopicListRow, refs: WindowRefs): TopicRow {
  const channel = refs.channels.get(wire.channelId)
  const partner = channel?.partnerId === undefined ? undefined : refs.people.get(channel.partnerId)
  const people = wire.participantIds.map((id) => refs.people.get(id))
  // An empty recipe is the engine saying "not shown" (AI assist off); the row then has no art.
  const recipe = refs.art.get(wire.id)?.recipe
  const art = recipe === undefined || recipe === '' ? undefined : recipe
  const held = joins.get(wire)
  if (held !== undefined && held.channel === channel && held.partner === partner && held.art === art && held.people.length === people.length && held.people.every((p, i) => p === people[i])) {
    return held.row
  }
  const { channelId: _channelId, participantIds: _participantIds, ...fields } = wire
  const { partnerId, ...channelFields } = channel ?? unknownChannel(wire.channelId)
  const rowChannel: RowChannel =
    partnerId === undefined ? channelFields : { ...channelFields, partner: partner ?? unknownPerson(partnerId) }
  const row: TopicRow = {
    ...fields,
    channel: rowChannel,
    participants: people.map((person, i) => person ?? unknownPerson(wire.participantIds[i]!)),
    ...(art === undefined ? {} : { art }),
  }
  joins.set(wire, { row, channel, partner, people, art })
  return row
}

/** The window with every row joined. `order`, `refs` and `meta` are the wire window's. */
export function joinTopicWindow(window: ListWindow<TopicListRow>): ListWindow<TopicRow> {
  const rows = new Map<string, TopicRow>()
  for (const [id, wire] of window.rows) rows.set(id, joinRow(wire, window.refs))
  return { order: window.order, rows, refs: window.refs, meta: window.meta }
}

const joinedFamily = Atom.family((key: string) => {
  const wire = listFamily(JSON.parse(key) as Parameters<typeof listFamily>[0])
  return Atom.make((get) => AsyncResult.map(get(wire), joinTopicWindow))
})

/** The sidebar list for a filter: pinned first, then recent, as `TopicRow`s, at most `SIDEBAR_WINDOW` of them. */
export const topicListAtom = (filter: TopicListFilter = defaultTopicListFilter) =>
  joinedFamily(
    JSON.stringify({
      kind: filter.kind,
      unreadOnly: filter.unreadOnly,
      ...(filter.scope === undefined ? {} : { scope: filter.scope }),
      // The scope wins over a view, so a scoped list is the same subscription with or without one.
      ...(filter.view === undefined || filter.scope !== undefined ? {} : { view: filter.view }),
      range: { limit: SIDEBAR_WINDOW },
    }),
  )

/** Unread topics per group, for the dots after the Channels and DMs filters. */
export const topicCountsAtom = (scope?: string) => countsFamily(scope === undefined ? {} : { scope })
