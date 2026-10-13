/**
 * `reads.markRead` and `reads.markUnread` (architecture 5.6, ADR 0010,
 * specs/readstate.qnt `localChange`).
 *
 * One writer transaction reads the state before the change, moves Juno's
 * pointer by the rules in `@juno/domain`, re-indexes the topic (so the
 * sidebar count changes with the mark) and, when the mark mirrors, writes
 * or replaces the topic's one `mark` outbox row. The command returns as soon
 * as that commits; `MarkWorker` sends the row later. A mark mirrors when the
 * mirror setting is on and the topic is Main or a thread the user follows
 * in Slack; an unfollowed thread stays local.
 *
 * The undo is computed from the state before the change: Mark read undoes
 * as Mark as unread from the first message that was unread, and Mark as
 * unread undoes as Mark read back to the old pointer.
 */
import { Clock, Effect } from 'effect'
import { NotFound, NotSignedIn, type CommandResult, type ReadError, type UndoCommand } from '@juno/contract'
import { markReadLocally, markUnreadLocally, millisToTs, parseTopicId, tsBefore, type ParsedTopicId, type ReadState, type Ts } from '@juno/domain'
import { StoreWriter, transaction, type SqlError } from '@juno/store'
import { readMessage, readState, reindexTopics, storedMe, threadSub, writeLocalMark } from '@juno/sync'
import { EngineConfig } from '../config'
import { Workspace } from '../workspace'
import { mirrorSetting } from './setting'

/** How long a new mark waits before it is sent, so marks in quick succession make one call. */
export const MARK_DELAY_MILLIS = 400

type Topic = Exclude<ParsedTopicId, { readonly kind: 'group' }>

/** What a command did: its undo, and whether a mark now waits for the worker. */
interface Marked {
  readonly result: CommandResult
  readonly queued: boolean
}

export const markRead = (id: string, upTo: string | undefined) =>
  command(id, (topic, before, at, mirrors) =>
    Effect.gen(function* () {
      const target = (upTo as Ts | undefined) ?? (yield* latestOf(topic))
      if (target === undefined) return undefined
      const next = markReadLocally(before, target, at, mirrors)
      if (next === undefined) return undefined
      const from = (yield* firstAfter(topic, before.lastReadTs)) ?? target
      return { next, undo: { _tag: 'reads.markUnread', id, from } satisfies UndoCommand }
    }),
  )

export const markUnread = (id: string, from: string | undefined) =>
  command(id, (topic, before, at, mirrors) =>
    Effect.gen(function* () {
      const first = (from as Ts | undefined) ?? (yield* latestOf(topic))
      if (first === undefined) return undefined
      // Slack's rule: the pointer is the message before the first unread one (research section 3).
      const pointer = (yield* messageBefore(topic, first)) ?? tsBefore(first)
      const next = markUnreadLocally(before, pointer, at, mirrors)
      if (next === undefined) return undefined
      const undo: UndoCommand =
        before.lastReadTs !== undefined && !before.markedUnread
          ? { _tag: 'reads.markRead', id, upTo: before.lastReadTs }
          : { _tag: 'reads.markUnread', id, from: (yield* firstAfter(topic, before.lastReadTs)) ?? first }
      // A thread's mark unread is sent as "unread from this reply".
      return { next, undo, ...(topic.kind === 'thread' ? { from: first } : {}) }
    }),
  )

type Change = (
  topic: Topic,
  before: ReadState,
  at: Ts,
  mirrors: boolean,
) => Effect.Effect<{ readonly next: ReadState; readonly undo: UndoCommand; readonly from?: Ts } | undefined, SqlError, StoreWriter>

const command = (id: string, change: Change): Effect.Effect<Marked, ReadError, Workspace | EngineConfig> =>
  Effect.gen(function* () {
    const workspace = yield* Workspace
    const config = yield* EngineConfig
    const open = yield* workspace.current
    if (open === undefined) return yield* new NotSignedIn()
    const parsed = parseTopicId(id)
    if (parsed === undefined || parsed.kind === 'group') return yield* new NotFound({ kind: 'topic', id })
    const topic = parsed
    const now = yield* Clock.currentTimeMillis
    const outcome = yield* transaction(
      Effect.gen(function* () {
        if (!(yield* exists(topic))) return 'missing' as const
        const mirrors = (yield* mirrorSetting(config)).on && (topic.kind === 'main' || (yield* threadSub(topic.channel, topic.threadTs))?.subscribed === true)
        const changed = yield* change(topic, yield* readState(id), millisToTs(now), mirrors)
        if (changed === undefined) return { result: {}, queued: false }
        yield* writeLocalMark(id, changed.next, changed.from, now, MARK_DELAY_MILLIS)
        const me = yield* storedMe
        if (me !== undefined) yield* reindexTopics([id], { me })
        return { result: { undo: changed.undo }, queued: changed.next.pendingLocalWrite }
      }),
    ).pipe(Effect.provide(open.context), Effect.orDie)
    if (outcome === 'missing') return yield* new NotFound({ kind: 'topic', id })
    return outcome
  })

const exists = (topic: Topic): Effect.Effect<boolean, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    if (topic.kind === 'thread') return (yield* readMessage(topic.channel, topic.threadTs)) !== undefined
    const sql = yield* StoreWriter
    return (yield* sql<{ id: string }>`SELECT id FROM conversations WHERE id = ${topic.channel}`).length > 0
  })

// The messages a topic shows: Main's top-level messages and broadcasts, or a thread's root and replies.
// Slack's ts are fixed-width strings, so SQL orders them as text.

const latestOf = (topic: Topic): Effect.Effect<Ts | undefined, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const stored = yield* (topic.kind === 'main'
      ? sql<{ ts: string }>`SELECT ts FROM messages WHERE channel = ${topic.channel} AND deleted = 0
          AND (thread_ts IS NULL OR thread_ts = ts OR subtype = 'thread_broadcast') ORDER BY ts DESC LIMIT 1`
      : sql<{ ts: string }>`SELECT ts FROM messages WHERE channel = ${topic.channel} AND deleted = 0
          AND (ts = ${topic.threadTs} OR thread_ts = ${topic.threadTs}) ORDER BY ts DESC LIMIT 1`)
    if (stored[0] !== undefined) return stored[0].ts as Ts
    // Nothing stored yet: what Slack said is the latest.
    if (topic.kind === 'thread') return ((yield* readMessage(topic.channel, topic.threadTs))?.latest_reply ?? undefined) as Ts | undefined
    const counts = yield* sql<{ latest: string | null }>`SELECT latest FROM channel_reads WHERE channel = ${topic.channel}`
    return (counts[0]?.latest ?? undefined) as Ts | undefined
  })

const messageBefore = (topic: Topic, ts: Ts): Effect.Effect<Ts | undefined, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const rows = yield* (topic.kind === 'main'
      ? sql<{ ts: string }>`SELECT ts FROM messages WHERE channel = ${topic.channel} AND deleted = 0 AND ts < ${ts}
          AND (thread_ts IS NULL OR thread_ts = ts OR subtype = 'thread_broadcast') ORDER BY ts DESC LIMIT 1`
      : sql<{ ts: string }>`SELECT ts FROM messages WHERE channel = ${topic.channel} AND deleted = 0 AND ts < ${ts}
          AND (ts = ${topic.threadTs} OR thread_ts = ${topic.threadTs}) ORDER BY ts DESC LIMIT 1`)
    return rows[0]?.ts as Ts | undefined
  })

/** The first message after `pointer` (the oldest one without a pointer): the first that was unread. */
const firstAfter = (topic: Topic, pointer: Ts | undefined): Effect.Effect<Ts | undefined, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const after = pointer ?? '0'
    const rows = yield* (topic.kind === 'main'
      ? sql<{ ts: string }>`SELECT ts FROM messages WHERE channel = ${topic.channel} AND deleted = 0 AND ts > ${after}
          AND (thread_ts IS NULL OR thread_ts = ts OR subtype = 'thread_broadcast') ORDER BY ts ASC LIMIT 1`
      : sql<{ ts: string }>`SELECT ts FROM messages WHERE channel = ${topic.channel} AND deleted = 0 AND ts > ${after}
          AND (ts = ${topic.threadTs} OR thread_ts = ${topic.threadTs}) ORDER BY ts ASC LIMIT 1`)
    return rows[0]?.ts as Ts | undefined
  })
