// The sidebar rule of spec section 5 ("What shows up") exists twice: as SQL
// in the sidebar and counts queries (`topics/query.ts`) and as the pure rule
// in `@juno/domain` (`sidebarPlacement`). These tests hold the two together:
// first over a table of every status a topic can have, straight against a
// store, then end to end for the two mention branches.
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Effect, Layer } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'
import {
  byLatestActivity,
  isDm,
  matchesSidebarFilter,
  millisToTs,
  sidebarPlacement,
  type ChannelId,
  type ConversationKind,
  type SidebarFilter,
  type Topic,
  type TopicId,
  type UserId,
} from '@juno/domain'
import type { TopicCounts } from '@juno/contract'
import { Store, StoreWriter, workspacePathsFromDir, type StoreError } from '@juno/store'
import { SELF_ID } from '@juno/fake-slack'
import { topicCountsAtom } from '@juno/state'
import { countTopics, listTopics, type ListFilter } from '../src/topics/query'
import { startTestEngine, type RunningEngine } from './harness'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 9, 13, 12)

interface Conversation {
  readonly id: string
  readonly kind: ConversationKind
  readonly member?: boolean
  readonly archived?: boolean
  readonly ignored?: boolean
}

type Overlay = 'none' | 'unsubscribed' | 'resolved' | 'reopened' | 'pinned' | 'pinned-resolved' | 'pinned-unsubscribed'
const OVERLAYS: ReadonlyArray<Overlay> = ['none', 'unsubscribed', 'resolved', 'reopened', 'pinned', 'pinned-resolved', 'pinned-unsubscribed']

interface Case {
  readonly id: string
  readonly channel: Conversation
  readonly kind: 'thread' | 'main'
  /** Slack's follow flag: no `thread_subs` row, an explicit unfollow, or followed. */
  readonly subscribed?: 0 | 1 | null
  readonly mention: boolean
  readonly unread: number
  readonly overlay: Overlay
  readonly ageDays: number
}

/** The status table: every combination of follow flag, mention, unread, overlay and age, in every kind of conversation. */
function statusTable(): { readonly conversations: ReadonlyArray<Conversation>; readonly cases: ReadonlyArray<Case> } {
  const conversations: Array<Conversation> = []
  const cases: Array<Case> = []
  const threads: Conversation = { id: 'C0THREADS', kind: 'public' }
  conversations.push(threads)
  let n = 0
  for (const subscribed of [null, 0, 1] as const)
    for (const mention of [false, true])
      for (const unread of [0, 2])
        for (const overlay of OVERLAYS)
          for (const ageDays of [1, 10]) {
            n++
            const ts = millisToTs(NOW - ageDays * DAY - n * 1000)
            cases.push({ id: `t:${threads.id}:${ts}`, channel: threads, kind: 'thread', subscribed, mention, unread, overlay, ageDays })
          }
  // One Main per conversation, so each Main case gets its own.
  for (const kind of ['public', 'private', 'im', 'mpim'] as const)
    for (const unread of [0, 2])
      for (const overlay of OVERLAYS)
        for (const ageDays of [1, 10]) {
          const channel: Conversation = { id: `${kind === 'im' ? 'D' : kind === 'mpim' ? 'G' : 'C'}0${kind.toUpperCase()}${overlay.toUpperCase().replace(/-/g, '')}${unread}${ageDays}`, kind }
          conversations.push(channel)
          cases.push({ id: `m:${channel.id}`, channel, kind: 'main', mention: false, unread, overlay, ageDays })
        }
  // An old Main kept alive by a followed thread inside the window.
  const alive: Conversation = { id: 'C0ALIVE', kind: 'public' }
  conversations.push(alive)
  cases.push({ id: `m:${alive.id}`, channel: alive, kind: 'main', mention: false, unread: 0, overlay: 'none', ageDays: 10 })
  cases.push({ id: `t:${alive.id}:${millisToTs(NOW - DAY)}`, channel: alive, kind: 'thread', subscribed: 1, mention: false, unread: 0, overlay: 'none', ageDays: 1 })
  // Conversations the sidebar never shows, whatever the topic: ignored, archived, and not a member. Pins included.
  for (const flags of [{ ignored: true }, { archived: true }, { member: false }] as const) {
    const channel: Conversation = { id: `C0${Object.keys(flags)[0]!.toUpperCase()}`, kind: 'public', ...flags }
    conversations.push(channel)
    cases.push({ id: `m:${channel.id}`, channel, kind: 'main', mention: false, unread: 2, overlay: 'none', ageDays: 1 })
    cases.push({ id: `t:${channel.id}:${millisToTs(NOW - DAY)}`, channel, kind: 'thread', subscribed: 1, mention: true, unread: 2, overlay: 'pinned', ageDays: 1 })
  }
  return { conversations, cases }
}

const tsOf = (c: Case) => (c.kind === 'thread' ? c.id.split(':')[2]! : millisToTs(NOW - c.ageDays * DAY))

/** The domain's view of a case, built from the table, not from the query. */
function topicOf(c: Case, channelActivity: string | undefined): Topic {
  const last = tsOf(c)
  const resolvedAt = c.overlay === 'resolved' || c.overlay === 'reopened' || c.overlay === 'pinned-resolved' ? NOW - 2 * DAY : undefined
  const resolvedActivityTs = c.overlay === 'reopened' ? millisToTs(NOW - 20 * DAY) : resolvedAt === undefined ? undefined : last
  return {
    id: c.id as TopicId,
    kind: c.kind,
    channel: { id: c.channel.id as ChannelId, kind: c.channel.kind, name: c.channel.id, ...(c.channel.ignored ? { ignored: true } : {}) },
    activity: {
      lastActivityTs: last as Topic['activity']['lastActivityTs'],
      ...(c.kind === 'main' && channelActivity !== undefined ? { channelLastActivityTs: channelActivity as Topic['activity']['lastActivityTs'] } : {}),
      messageCount: 3,
      unreadCount: c.unread,
      mentionsMe: c.mention,
      participants: [] as ReadonlyArray<UserId>,
    },
    overlay: {
      ...(resolvedAt === undefined ? {} : { resolvedAt, resolvedActivityTs: resolvedActivityTs as Topic['activity']['lastActivityTs'] }),
      ...(c.overlay.startsWith('pinned') ? { pinnedAt: NOW - 3 * DAY } : {}),
      ...(c.overlay === 'unsubscribed' || c.overlay === 'pinned-unsubscribed' ? { unsubscribedAt: NOW - 3 * DAY } : {}),
    },
    ...(c.kind === 'thread' && c.subscribed !== null && c.subscribed !== undefined ? { slackSubscribed: c.subscribed === 1 } : {}),
  }
}

/** Writes the table into a fresh store: conversations, the index, Slack's follow flags, the overlay and the ignored list. */
const seed = (conversations: ReadonlyArray<Conversation>, cases: ReadonlyArray<Case>) =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    yield* sql`INSERT INTO team (id, name, self_user_id) VALUES ('T0', 'Team', ${SELF_ID})`
    for (const c of conversations) {
      yield* sql`INSERT INTO conversations (id, kind, name, user_id, member_ids_json, is_member, is_archived) VALUES (${c.id}, ${c.kind}, ${c.id}, ${c.kind === 'im' ? 'U0OTHER' : null}, ${c.kind === 'mpim' ? JSON.stringify([SELF_ID, 'U0OTHER']) : null}, ${c.member === false ? 0 : 1}, ${c.archived ? 1 : 0})`
      if (c.ignored) yield* sql`INSERT INTO ignored_channels (channel, ignored_at) VALUES (${c.id}, ${String(NOW)})`
    }
    for (const c of cases) {
      const ts = tsOf(c)
      yield* sql`INSERT INTO topic_index (topic_id, channel, kind, last_activity_ts, message_count, participants_json, root_ts, unread_count, unread_exact, mentions_me, preview_json, rev)
        VALUES (${c.id}, ${c.channel.id}, ${c.kind}, ${ts}, 3, '[]', ${c.kind === 'thread' ? ts : null}, ${c.unread}, 1, ${c.mention ? 1 : 0}, ${JSON.stringify({ sender: 'Maya', text: c.id, rootText: c.id })}, 1)`
      if (c.kind === 'thread' && c.subscribed !== null && c.subscribed !== undefined)
        yield* sql`INSERT INTO thread_subs (channel, thread_ts, subscribed) VALUES (${c.channel.id}, ${ts}, ${c.subscribed})`
      if (c.overlay !== 'none') {
        const topic = topicOf(c, undefined)
        yield* sql`INSERT INTO topic_overlay (topic_id, resolved_at, resolved_activity_ts, pinned_at, unsubscribed_at) VALUES (${c.id}, ${topic.overlay.resolvedAt === undefined ? null : String(topic.overlay.resolvedAt)}, ${topic.overlay.resolvedActivityTs ?? null}, ${topic.overlay.pinnedAt === undefined ? null : String(topic.overlay.pinnedAt)}, ${topic.overlay.unsubscribedAt === undefined ? null : String(topic.overlay.unsubscribedAt)})`
      }
    }
  })

/** Membership and archiving are the store's business, not the rule's: topics there never show. */
const shownConversation = (c: Conversation) => c.member !== false && !c.archived

const FILTERS: ReadonlyArray<ListFilter> = [
  { kind: 'all', unreadOnly: false },
  { kind: 'channels', unreadOnly: false },
  { kind: 'dms', unreadOnly: false },
  { kind: 'all', unreadOnly: true },
  { kind: 'dms', unreadOnly: true },
  { kind: 'all', unreadOnly: false, scope: 'C0THREADS' },
  { kind: 'all', unreadOnly: false, scope: 'C0ALIVE' },
]

const tempStore: Layer.Layer<Layer.Success<ReturnType<typeof Store.layer>>, StoreError> = Layer.unwrap(
  Effect.map(
    Effect.acquireRelease(
      Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), 'juno-sidebar-rule-'))),
      (dir) => Effect.promise(() => fs.rm(dir, { recursive: true, force: true })),
    ),
    (dir) => Store.layer(workspacePathsFromDir(dir)),
  ),
)

describe('the sidebar rule, query against domain', () => {
  it('listTopics and the counts agree with sidebarPlacement over the status table, for every filter', async () => {
    const { conversations, cases } = statusTable()
    // The domain's answer. Membership and archiving are the store's business, not the rule's: those topics never show.
    const channelActivity = new Map<string, string>()
    for (const c of cases) {
      const ts = tsOf(c)
      const known = channelActivity.get(c.channel.id)
      if (known === undefined || ts > known) channelActivity.set(c.channel.id, ts)
    }
    const topics = cases.filter((c) => shownConversation(c.channel)).map((c) => topicOf(c, channelActivity.get(c.channel.id)))
    const expected = (filter: ListFilter) => {
      const domainFilter: SidebarFilter = { kind: filter.kind, unreadOnly: filter.unreadOnly, ...(filter.scope === undefined ? {} : { scope: filter.scope as ChannelId }) }
      const pinned: Array<Topic> = []
      const recent: Array<Topic> = []
      for (const topic of topics) {
        if (!matchesSidebarFilter(topic, domainFilter)) continue
        const placement = sidebarPlacement(topic, { now: NOW })
        if (placement === 'pinned') pinned.push(topic)
        if (placement === 'recent') recent.push(topic)
      }
      return { pinned: pinned.toSorted(byLatestActivity).map((t) => t.id), recent: recent.toSorted(byLatestActivity).map((t) => t.id) }
    }
    const expectedCounts = (scope: string | undefined): TopicCounts => {
      const shown = topics.filter(
        (t) => (scope === undefined || t.channel.id === scope) && t.activity.unreadCount > 0 && sidebarPlacement(t, { now: NOW }) !== 'hidden',
      )
      return { channelsUnread: shown.filter((t) => !isDm(t.channel.kind)).length, dmsUnread: shown.filter((t) => isDm(t.channel.kind)).length }
    }

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
    for (const c of mentionOnly) expect(all.recent).toContain(c.id)
    const unfollowedMention = cases.filter((c) => c.kind === 'thread' && c.subscribed === 0 && c.mention && c.unread > 0 && c.overlay === 'none')
    for (const c of unfollowedMention) expect([...all.pinned, ...all.recent]).not.toContain(c.id)
    expect(all.recent).toContain(`m:C0ALIVE`)
  })
})

// End to end: the engine on the fake, the two mention branches arriving over the socket.

const engines: Array<RunningEngine> = []
afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.stop()
})

async function liveEngine(): Promise<RunningEngine> {
  const engine = await startTestEngine({ initial: (fake) => fake.signIn() })
  engines.push(engine)
  await engine.status('ready')
  await engine.phase('live')
  return engine
}

/** The counts the engine sends, once they equal what the sidebar shows: unread channel and DM rows. */
async function countsMatchRows(engine: RunningEngine): Promise<TopicCounts> {
  const atom = topicCountsAtom()
  const unmount = engine.registry.mount(atom)
  try {
    let counts: TopicCounts | undefined
    await engine.rowsUntil((rows) => {
      const result = engine.registry.get(atom)
      if (result._tag !== 'Success') return false
      const channels = rows.filter((r) => r.unreadCount > 0 && !isDm(r.channel.kind)).length
      const dms = rows.filter((r) => r.unreadCount > 0 && isDm(r.channel.kind)).length
      counts = result.value
      return counts.channelsUnread === channels && counts.dmsUnread === dms
    }, 'the counts to match the rows')
    return counts!
  } finally {
    unmount()
  }
}

describe('the mention branches, end to end', () => {
  it('a mention in a thread Slack said nothing about brings the thread in, and the counts go up', async () => {
    const engine = await liveEngine()
    await engine.rowsUntil((rows) => rows.length >= 20, 'rows')
    const before = await countsMatchRows(engine)

    const root = engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0LEO', text: 'Who owns the flaky checkout test?' })
    engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: `<@${SELF_ID}> can you take a look?`, threadTs: root.ts })
    const id = `t:C0ENG:${root.ts}`

    const rows = await engine.rowsUntil((list) => list.some((r) => r.id === id), 'the mentioned thread')
    expect(rows.find((r) => r.id === id)).toMatchObject({ kind: 'thread', mentionsMe: true, subscribed: false, section: 'recent' })
    expect(rows.find((r) => r.id === id)!.unreadCount).toBeGreaterThan(0)
    const after = await countsMatchRows(engine)
    expect(after.channelsUnread).toBeGreaterThan(before.channelsUnread)
  })

  it('a mention after an explicit unfollow keeps the thread hidden and out of the counts', async () => {
    const engine = await liveEngine()
    const rows = await engine.rowsUntil((list) => list.length >= 20, 'rows')
    const root = engine.fake.messages('C0ENG').find((m) => m.text?.startsWith('Draft plan is in the doc.'))!
    const id = `t:C0ENG:${root.ts}`
    expect(rows.find((r) => r.id === id)).toMatchObject({ subscribed: true })

    engine.fake.workspace.unsubscribe('C0ENG', root.ts as Parameters<typeof engine.fake.workspace.unsubscribe>[1])
    await engine.rowsUntil((list) => !list.some((r) => r.id === id), 'the unfollowed thread gone')
    const before = await countsMatchRows(engine)

    engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0LEO', text: `<@${SELF_ID}> one more thing on the plan.`, threadTs: root.ts })
    // Events apply in order: once a later message has reached its row, the mention has been applied too.
    engine.fake.injectMessage({ channel: 'D0SAM', user: 'U0SAM', text: 'Unrelated, later.' })
    const after = await engine.rowsUntil((list) => list.some((r) => r.preview.text === 'Unrelated, later.'), 'the later message')
    expect(after.some((r) => r.id === id)).toBe(false)
    const counts = await countsMatchRows(engine)
    expect(counts.channelsUnread).toBe(before.channelsUnread)
  })
})
