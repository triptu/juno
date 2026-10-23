/**
 * What the store knows about a message's conversation when it arrives: the
 * facts the decision order reads, and the earlier messages Juno's reading
 * gets. One topic is one conversation: a thread, or a channel's or DM's Main.
 */
import type { AiMessage } from '@juno/ai'
import { millisToTs, parseTopicId, tsToMillis, type ConversationFacts } from '@juno/domain'
import type { StoreWriter } from '@juno/store'
import { Effect } from 'effect'
import type { Candidate } from './model'

const EARLIER = 10
const DAY = 86_400_000

interface Row {
  readonly ts: string
  readonly user_id: string | null
  readonly text: string
  readonly name: string | null
}

export interface Conversation {
  readonly facts: ConversationFacts
  /** Oldest first, the owner's marked. */
  readonly before: ReadonlyArray<AiMessage>
  readonly threadRoot?: AiMessage
  readonly senderWroteSinceOwner: boolean
}

const message = (row: Row, self: string): AiMessage => ({
  sender: row.user_id === self ? 'Me' : row.name ?? 'Someone',
  text: row.text,
  at: new Date(tsToMillis(row.ts as never)).toISOString(),
  fromMe: row.user_id === self,
})

/** The conversation before `candidate`, as of `now`. Nothing here calls Slack. */
export const readConversation = (sql: StoreWriter['Service'], self: string, candidate: Candidate, now: number) =>
  Effect.gen(function* () {
    const topic = parseTopicId(candidate.topicId)
    const channel = candidate.channel.id
    const threadTs = topic?.kind === 'thread' ? topic.threadTs : undefined
    const earlier = threadTs === undefined
      ? yield* sql<Row>`SELECT m.ts, m.user_id, m.text, COALESCE(u.display_name, u.real_name, u.name) AS name FROM messages m LEFT JOIN users u ON u.id = m.user_id
          WHERE m.channel = ${channel} AND (m.thread_ts IS NULL OR m.thread_ts = m.ts OR m.subtype = 'thread_broadcast') AND m.ts < ${candidate.ts} AND m.deleted = 0
          ORDER BY m.ts DESC LIMIT ${EARLIER}`
      : yield* sql<Row>`SELECT m.ts, m.user_id, m.text, COALESCE(u.display_name, u.real_name, u.name) AS name FROM messages m LEFT JOIN users u ON u.id = m.user_id
          WHERE m.channel = ${channel} AND m.thread_ts = ${threadTs} AND m.ts <> ${threadTs} AND m.ts < ${candidate.ts} AND m.deleted = 0
          ORDER BY m.ts DESC LIMIT ${EARLIER}`
    const root = threadTs === undefined ? undefined
      : (yield* sql<Row>`SELECT m.ts, m.user_id, m.text, COALESCE(u.display_name, u.real_name, u.name) AS name FROM messages m LEFT JOIN users u ON u.id = m.user_id
          WHERE m.channel = ${channel} AND m.ts = ${threadTs}`)[0]
    const ownerLast = threadTs === undefined
      ? (yield* sql<{ ts: string | null }>`SELECT MAX(ts) AS ts FROM messages WHERE channel = ${channel} AND user_id = ${self} AND deleted = 0
          AND (thread_ts IS NULL OR thread_ts = ts OR subtype = 'thread_broadcast') AND ts < ${candidate.ts}`)[0]?.ts
      : (yield* sql<{ ts: string | null }>`SELECT MAX(ts) AS ts FROM messages WHERE channel = ${channel} AND user_id = ${self} AND deleted = 0
          AND (thread_ts = ${threadTs} OR ts = ${threadTs}) AND ts < ${candidate.ts}`)[0]?.ts
    // Whether the sender wrote in the topic after the owner's last message (or at all, when the owner has not written), before this one.
    const after = ownerLast ?? ''
    const senderSince = threadTs === undefined
      ? (yield* sql`SELECT 1 FROM messages WHERE channel = ${channel} AND user_id = ${candidate.senderId} AND deleted = 0
          AND (thread_ts IS NULL OR thread_ts = ts OR subtype = 'thread_broadcast') AND ts > ${after} AND ts < ${candidate.ts} LIMIT 1`).length > 0
      : (yield* sql`SELECT 1 FROM messages WHERE channel = ${channel} AND user_id = ${candidate.senderId} AND deleted = 0
          AND (thread_ts = ${threadTs} OR ts = ${threadTs}) AND ts > ${after} AND ts < ${candidate.ts} LIMIT 1`).length > 0
    const started = threadTs !== undefined && (root?.user_id === self
      || (yield* sql`SELECT 1 FROM started_threads WHERE channel = ${channel} AND root_ts = ${threadTs}`).length > 0)
    const followed = threadTs !== undefined
      && (yield* sql<{ subscribed: number }>`SELECT subscribed FROM thread_subs WHERE channel = ${channel} AND thread_ts = ${threadTs}`)[0]?.subscribed === 1
    const banner = (yield* sql<{ at: string | null }>`SELECT MAX(delivered_at) AS at FROM notification_log
      WHERE topic_id = ${candidate.topicId} AND delivered_at IS NOT NULL`)[0]?.at
    // The thread's first message counts as the previous one for its first reply.
    const previous = earlier[0] ?? root
    const facts: ConversationFacts = {
      ...(ownerLast == null ? {} : { ownerWroteMinutesAgo: Math.max(0, (now - tsToMillis(ownerLast as never)) / 60_000) }),
      ownerWroteLast: previous?.user_id === self,
      ownerStartedThread: started,
      followed,
      ...(banner == null ? {} : { bannerSecondsAgo: Math.max(0, (now - Date.parse(banner)) / 1000) }),
    }
    return {
      facts,
      before: earlier.toReversed().map((row) => message(row, self)),
      ...(root === undefined ? {} : { threadRoot: message(root, self) }),
      senderWroteSinceOwner: senderSince,
    } satisfies Conversation
  })

/** Messages the owner and the sender exchanged in their DM over the last 30 days. */
export const exchangesWith = (sql: StoreWriter['Service'], sender: string, now: number) =>
  Effect.map(
    sql<{ n: number }>`SELECT COUNT(*) AS n FROM messages m JOIN conversations c ON c.id = m.channel
      WHERE c.kind = 'im' AND c.user_id = ${sender} AND m.ts >= ${millisToTs(now - 30 * DAY)} AND m.deleted = 0`,
    (rows) => rows[0]?.n ?? 0,
  )
