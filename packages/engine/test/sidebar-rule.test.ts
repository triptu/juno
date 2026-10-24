// The sidebar rule of spec section 5 ("What shows up") exists twice: as SQL
// in the sidebar and counts queries (`topics/query.ts`) and as the pure rule
// in `@juno/domain` (`sidebarPlacement`). These tests hold the two together
// over a table of every status a topic can have, straight against a store.
// The mention branches run end to end in `flows/follow.flow.test.ts`.
import { Effect } from 'effect'
import { describe, expect, it } from 'bun:test'
import { byLatestActivity, isDm, matchesSidebarFilter, sidebarPlacement, type ChannelId, type SidebarFilter, type Topic } from '@juno/domain'
import type { TopicCounts } from '@juno/contract'
import { StoreWriter } from '@juno/store'
import { countTopics, listTopics, type ListFilter } from '../src/topics/query'
import { NOW, seed, shownConversation, statusTable, tempStore, topicOf, tsOf } from './statusTable'

const FILTERS: ReadonlyArray<ListFilter> = [
  { kind: 'all', unreadOnly: false },
  { kind: 'channels', unreadOnly: false },
  { kind: 'dms', unreadOnly: false },
  { kind: 'all', unreadOnly: true },
  { kind: 'dms', unreadOnly: true },
  { kind: 'all', unreadOnly: false, scope: 'C0THREADS' },
  { kind: 'all', unreadOnly: false, scope: 'C0ALIVE' },
]

/** A view in the status table's store, and whether it keeps its conversations out of All. */
interface TableView {
  readonly id: string
  readonly keepOut: boolean
  readonly channels: ReadonlyArray<string>
}

/** The domain's answer over the status table, with the views as spec section 5 ("Views") puts them. */
function domainSide(views: ReadonlyArray<TableView> = []) {
  const { conversations, cases } = statusTable()
  // Membership and archiving are the store's business, not the rule's: those topics never show.
  const channelActivity = new Map<string, string>()
  for (const c of cases) {
    const ts = tsOf(c)
    const known = channelActivity.get(c.channel.id)
    if (known === undefined || ts > known) channelActivity.set(c.channel.id, ts)
  }
  const topics = cases.filter((c) => shownConversation(c.channel)).map((c) => topicOf(c, channelActivity.get(c.channel.id)))
  const keptOut = new Set(views.filter((v) => v.keepOut).flatMap((v) => v.channels))
  /** The conversations a filter shows: the scope's, a view's, or the rest without those kept out of All. */
  const inPlace = (topic: Topic, filter: ListFilter): boolean => {
    if (filter.scope !== undefined) return true
    if (filter.view !== undefined) return views.find((v) => v.id === filter.view)?.channels.includes(topic.channel.id) === true
    return !keptOut.has(topic.channel.id)
  }
  const expected = (filter: ListFilter) => {
    // A view ignores the kind.
    const kind = filter.view !== undefined && filter.scope === undefined ? 'all' : filter.kind
    const domainFilter: SidebarFilter = { kind, unreadOnly: filter.unreadOnly, ...(filter.scope === undefined ? {} : { scope: filter.scope as ChannelId }) }
    const pinned: Array<Topic> = []
    const recent: Array<Topic> = []
    for (const topic of topics) {
      if (!matchesSidebarFilter(topic, domainFilter) || !inPlace(topic, filter)) continue
      const placement = sidebarPlacement(topic, { now: NOW })
      if (placement === 'pinned') pinned.push(topic)
      if (placement === 'recent') recent.push(topic)
    }
    return { pinned: pinned.toSorted(byLatestActivity).map((t) => t.id), recent: recent.toSorted(byLatestActivity).map((t) => t.id) }
  }
  const expectedCounts = (scope: string | undefined): TopicCounts => {
    const unread = topics.filter((t) => (scope === undefined || t.channel.id === scope) && t.activity.unreadCount > 0 && sidebarPlacement(t, { now: NOW }) !== 'hidden')
    const grouped = unread.filter((t) => scope !== undefined || !keptOut.has(t.channel.id))
    return {
      channelsUnread: grouped.filter((t) => !isDm(t.channel.kind)).length,
      dmsUnread: grouped.filter((t) => isDm(t.channel.kind)).length,
      viewMentions: views.filter((v) => unread.some((t) => t.activity.mentionsMe && v.channels.includes(t.channel.id))).map((v) => v.id),
    }
  }
  return { conversations, cases, topics, expected, expectedCounts }
}

/** Writes the views straight into the store, in order. */
const seedViews = (views: ReadonlyArray<TableView>) =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    for (const [position, view] of views.entries()) {
      yield* sql`INSERT INTO sidebar_views (id, name, icon, position, keep_out_of_all, created_at) VALUES (${view.id}, ${view.id}, NULL, ${position}, ${view.keepOut ? 1 : 0}, '0')`
      for (const channel of view.channels) yield* sql`INSERT INTO sidebar_view_channels (view_id, channel, added_at) VALUES (${view.id}, ${channel}, '0')`
    }
  })

describe('the sidebar rule, query against domain', () => {
  it('listTopics and the counts agree with sidebarPlacement over the status table, for every filter', async () => {
    const { conversations, cases, expected, expectedCounts } = domainSide()

    const program = Effect.gen(function* () {
      yield* seed(conversations, cases)
      for (const filter of FILTERS) {
        const { rows } = yield* listTopics(filter, { now: NOW, limit: 300 })
        const want = expected(filter)
        const label = JSON.stringify(filter)
        expect(rows.filter((r) => r.section === 'pinned').map((r) => r.id), `pinned, ${label}`).toEqual(want.pinned)
        expect(rows.filter((r) => r.section === 'recent').map((r) => r.id), `recent, ${label}`).toEqual(want.recent)
      }
      for (const scope of [undefined, 'C0THREADS', 'C0PUBLICNONE21']) {
        expect(yield* countTopics(scope), `counts, scope ${scope}`).toEqual(expectedCounts(scope))
      }
    })
    await Effect.runPromise(program.pipe(Effect.provide(tempStore), Effect.scoped))

    // The table covers the branches it is for.
    const all = expected({ kind: 'all', unreadOnly: false })
    const mentionOnly = cases.filter((c) => c.kind === 'thread' && c.subscribed === null && c.mention && c.unread > 0 && c.overlay === 'none')
    expect(mentionOnly.length).toBeGreaterThan(0)
    for (const c of mentionOnly) expect<unknown>(all.recent).toContain(c.id)
    const unfollowedMention = cases.filter((c) => c.kind === 'thread' && c.subscribed === 0 && c.mention && c.unread > 0 && c.overlay === 'none')
    for (const c of unfollowedMention) expect([...all.pinned, ...all.recent]).not.toContain(c.id)
    expect<unknown>(all.recent).toContain(`m:C0ALIVE`)
  })

  it('a view shows only its conversations, and Keep these out of All takes them out of All, Channels, DMs and their dots', async () => {
    const { conversations, cases } = statusTable()
    const shown = conversations.filter(shownConversation)
    const dm = shown.find((c) => c.kind === 'im')!
    const channel = shown.find((c) => c.kind === 'public' && c.id !== 'C0THREADS')!
    // "Bots" keeps the threads channel and a DM out of All; "Team" only gathers a channel and shares the DM.
    const views: ReadonlyArray<TableView> = [
      { id: 'vbots', keepOut: true, channels: ['C0THREADS', dm.id] },
      { id: 'vteam', keepOut: false, channels: [channel.id, dm.id] },
      { id: 'vempty', keepOut: true, channels: [] },
    ]
    const { expected, expectedCounts } = domainSide(views)
    const filters: ReadonlyArray<ListFilter> = [
      ...FILTERS,
      { kind: 'all', unreadOnly: false, view: 'vbots' },
      { kind: 'channels', unreadOnly: true, view: 'vbots' },
      { kind: 'all', unreadOnly: false, view: 'vteam' },
      { kind: 'all', unreadOnly: false, view: 'vempty' },
    ]
    const program = Effect.gen(function* () {
      yield* seed(conversations, cases)
      yield* seedViews(views)
      for (const filter of filters) {
        const { rows } = yield* listTopics(filter, { now: NOW, limit: 300 })
        const want = expected(filter)
        const label = JSON.stringify(filter)
        expect(rows.filter((r) => r.section === 'pinned').map((r) => r.id), `pinned, ${label}`).toEqual(want.pinned)
        expect(rows.filter((r) => r.section === 'recent').map((r) => r.id), `recent, ${label}`).toEqual(want.recent)
      }
      for (const scope of [undefined, 'C0THREADS', 'C0PUBLICNONE21']) {
        expect(yield* countTopics(scope), `counts, scope ${scope}`).toEqual(expectedCounts(scope))
      }
    })
    await Effect.runPromise(program.pipe(Effect.provide(tempStore), Effect.scoped))

    // The table covers the cases it is for: the kept-out channel had rows in All, the view has them, the scope still shows them.
    const all = expected({ kind: 'all', unreadOnly: false })
    const bots = expected({ kind: 'all', unreadOnly: false, view: 'vbots' })
    expect(bots.recent.some((id) => id.startsWith('t:C0THREADS:'))).toBe(true)
    expect([...all.pinned, ...all.recent].some((id) => id.startsWith('t:C0THREADS:'))).toBe(false)
    expect(expected({ kind: 'all', unreadOnly: false, scope: 'C0THREADS' }).recent.length).toBeGreaterThan(0)
    expect(expectedCounts(undefined).viewMentions).toContain('vbots')
  })
})
