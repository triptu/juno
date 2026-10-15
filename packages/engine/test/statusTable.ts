// The status table the rule tests share: every combination of follow flag,
// mention, unread, overlay and age, in every kind of conversation, written
// straight into a store. The sidebar rule test (`sidebar-rule.test.ts`) and
// the All topics rule test (`all-topics-rule.test.ts`) check the engine's
// SQL against the domain's pure rules over it.
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Effect, Layer } from 'effect'
import { millisToTs, type ChannelId, type ConversationKind, type Topic, type TopicId, type UserId } from '@juno/domain'
import { Store, StoreWriter, workspacePathsFromDir, type StoreError } from '@juno/store'
import { SELF_ID } from '@juno/fake-slack'

export const DAY = 24 * 60 * 60 * 1000
export const NOW = Date.UTC(2026, 9, 13, 12)

export interface Conversation {
  readonly id: string
  readonly kind: ConversationKind
  readonly member?: boolean
  readonly archived?: boolean
  readonly ignored?: boolean
}

export type Overlay = 'none' | 'resolved' | 'reopened' | 'pinned' | 'pinned-resolved'
const OVERLAYS: ReadonlyArray<Overlay> = ['none', 'resolved', 'reopened', 'pinned', 'pinned-resolved']

export interface Case {
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
export function statusTable(): { readonly conversations: ReadonlyArray<Conversation>; readonly cases: ReadonlyArray<Case> } {
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

export const tsOf = (c: Case) => (c.kind === 'thread' ? c.id.split(':')[2]! : millisToTs(NOW - c.ageDays * DAY))

/** The domain's view of a case, built from the table, not from the query. */
export function topicOf(c: Case, channelActivity: string | undefined): Topic {
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
    },
    ...(c.kind === 'thread' && c.subscribed !== null && c.subscribed !== undefined ? { slackSubscribed: c.subscribed === 1 } : {}),
  }
}

/** Writes the table into a fresh store: conversations, the index, Slack's follow flags, the overlay and the ignored list. */
export const seed = (conversations: ReadonlyArray<Conversation>, cases: ReadonlyArray<Case>) =>
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
        yield* sql`INSERT INTO topic_overlay (topic_id, resolved_at, resolved_activity_ts, pinned_at) VALUES (${c.id}, ${topic.overlay.resolvedAt === undefined ? null : String(topic.overlay.resolvedAt)}, ${topic.overlay.resolvedActivityTs ?? null}, ${topic.overlay.pinnedAt === undefined ? null : String(topic.overlay.pinnedAt)})`
      }
    }
  })

/** Membership and archiving are the store's business, not the rule's: topics there never show. */
export const shownConversation = (c: Conversation) => c.member !== false && !c.archived

export const tempStore: Layer.Layer<Layer.Success<ReturnType<typeof Store.layer>>, StoreError> = Layer.unwrap(
  Effect.map(
    Effect.acquireRelease(
      Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), 'juno-status-table-'))),
      (dir) => Effect.promise(() => fs.rm(dir, { recursive: true, force: true })),
    ),
    (dir) => Store.layer(workspacePathsFromDir(dir)),
  ),
)

