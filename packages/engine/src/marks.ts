/**
 * `reads.markRead` and `reads.markUnread` (architecture 5.6, ADR 0010,
 * specs/readstate.qnt `localChange`), and the mark inside `topics.resolve`.
 * A top-level module because the reads and topics features both mark.
 *
 * One writer transaction reads the state before the change, moves Juno's
 * pointer by the rules in `@juno/domain`, re-indexes the topic (so the
 * sidebar count changes with the mark) and, when the mark mirrors, writes
 * or replaces the topic's one `mark` outbox row. The command returns as soon
 * as that commits; `MarkWorker` sends the row later. A mark mirrors when the
 * mirror setting is on and the topic is Main or a thread the user follows
 * in Slack; an unfollowed thread stays local.
 *
 * Mark read also clears the Reopened tag (architecture 4.4).
 *
 * The undo is computed from the state before the change: Mark read undoes
 * as Mark as unread from the first message that was unread (with the tag
 * back when it cleared one), and Mark as unread undoes as Mark read back to
 * the old pointer, or, when it moved the pointer forward or the topic was
 * already marked unread, as Mark as unread from the first message that was
 * unread.
 */
import { Clock, Effect } from 'effect'
import { NotFound, NotSignedIn, type CommandResult, type EngineConfig as Config, type ReadError, type UndoCommand } from '@juno/contract'
import { compareTs, markReadLocally, markUnreadLocally, millisToTs, parseTopicId, tsBefore, type ParsedTopicId, type ReadState, type Ts } from '@juno/domain'
import { StoreWriter, transaction, type Invalidation, type SqlError } from '@juno/store'
import { patchOverlay, readMessage, readState, reindexTopics, storedMe, threadSub, writeLocalMark } from '@juno/sync'
import { EngineConfig, EngineTiming } from './config'
import { Workspace } from './workspace'
import { mirrorSetting } from './readSetting'


type Topic = ParsedTopicId

/** What a command did: its undo, and whether a mark now waits for the worker. */
export interface Marked {
  readonly result: CommandResult
  readonly queued: boolean
}

/** What a mark did inside its transaction: its undo, and whether a mark now waits for the worker. */
export interface MarkStep {
  readonly undo?: UndoCommand
  readonly queued: boolean
}

/**
 * Marks a topic that exists read up to `upTo`, or to its latest message,
 * inside the caller's writer transaction, and clears its Reopened tag.
 * `reads.markRead` and `topics.resolve` both run it.
 */
export const markReadStep = (id: string, topic: Topic, upTo: string | undefined, config: Config, now: number) =>
  Effect.gen(function* () {
    const marked = yield* step(id, topic, config, now, (before, at, mirrors) =>
      Effect.gen(function* () {
        const target = (upTo as Ts | undefined) ?? (yield* latestOf(topic))
        if (target === undefined) return undefined
        const next = markReadLocally(before, target, at, mirrors)
        if (next === undefined) return undefined
        const from = (yield* firstAfter(topic, before.lastReadTs)) ?? target
        return { next, undo: { _tag: 'reads.markUnread', id, from } satisfies UndoCommand }
      }),
    )
    const tag = yield* patchOverlay(id, { reopenedAt: null })
    if (tag === undefined) return marked
    const unreadFrom = marked.undo?._tag === 'reads.markUnread' ? marked.undo.from : undefined
    return { ...marked, undo: { _tag: 'topics.restore', id, overlay: tag, ...(unreadFrom === undefined ? {} : { unreadFrom }) } satisfies UndoCommand }
  })

export const markRead = (id: string, upTo: string | undefined) =>
  command(id, (topic, config, now) => markReadStep(id, topic, upTo, config, now))

/** Marks a topic that exists unread from `from`, or from its latest message, inside the caller's writer transaction. */
export const markUnreadStep = (id: string, topic: Topic, from: string | undefined, config: Config, now: number) =>
  step(id, topic, config, now, (before, at, mirrors) =>
    Effect.gen(function* () {
      const first = (from as Ts | undefined) ?? (yield* latestOf(topic))
      if (first === undefined) return undefined
      // Slack's rule: the pointer is the message before the first unread one (research section 3).
      const pointer = (yield* messageBefore(topic, first)) ?? tsBefore(first)
      const next = markUnreadLocally(before, pointer, at, mirrors)
      if (next === undefined) return undefined
      // Mark read never moves the pointer back, so a mark that moved it forward (from a message after the old
      // pointer) undoes as Mark as unread from the first message that was unread.
      const undo: UndoCommand =
        before.lastReadTs !== undefined && !before.markedUnread && compareTs(pointer, before.lastReadTs) <= 0
          ? { _tag: 'reads.markRead', id, upTo: before.lastReadTs }
          : { _tag: 'reads.markUnread', id, from: (yield* firstAfter(topic, before.lastReadTs)) ?? first }
      // A thread's mark unread is sent as "unread from this reply".
      return { next, undo, ...(topic.kind === 'thread' ? { from: first } : {}) }
    }),
  )

export const markUnread = (id: string, from: string | undefined) =>
  command(id, (topic, config, now) => markUnreadStep(id, topic, from, config, now))

type Change = (
  before: ReadState,
  at: Ts,
  mirrors: boolean,
) => Effect.Effect<{ readonly next: ReadState; readonly undo: UndoCommand; readonly from?: Ts } | undefined, SqlError, StoreWriter>

const step = (id: string, topic: Topic, config: Config, now: number, change: Change): Effect.Effect<MarkStep, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const mirrors = (yield* mirrorSetting(config)).on && (topic.kind === 'main' || (yield* threadSub(topic.channel, topic.threadTs))?.subscribed === true)
    const changed = yield* change(yield* readState(id), millisToTs(now), mirrors)
    if (changed === undefined) return { queued: false }
    yield* writeLocalMark(id, changed.next, changed.from, now, (yield* EngineTiming).markDelayMillis)
    const me = yield* storedMe
    if (me !== undefined) yield* reindexTopics([id], { me })
    return { undo: changed.undo, queued: changed.next.pendingLocalWrite }
  })

const command = (
  id: string,
  run: (topic: Topic, config: Config, now: number) => Effect.Effect<MarkStep, SqlError, StoreWriter | Invalidation>,
): Effect.Effect<Marked, ReadError, Workspace | EngineConfig> =>
  Effect.gen(function* () {
    const workspace = yield* Workspace
    const config = yield* EngineConfig
    const open = yield* workspace.current
    if (open === undefined) return yield* new NotSignedIn()
    const topic = parseTopicId(id)
    if (topic === undefined) return yield* new NotFound({ kind: 'topic', id })
    const now = yield* Clock.currentTimeMillis
    const outcome = yield* transaction(
      Effect.gen(function* () {
        if (!(yield* topicExists(topic))) return 'missing' as const
        const marked = yield* run(topic, config, now)
        return { result: marked.undo === undefined ? {} : { undo: marked.undo }, queued: marked.queued }
      }),
    ).pipe(Effect.provide(open.context), Effect.orDie)
    if (outcome === 'missing') return yield* new NotFound({ kind: 'topic', id })
    return outcome
  })

/** Whether the store knows the topic: a thread's root, or Main's conversation. */
export const topicExists = (topic: Topic): Effect.Effect<boolean, SqlError, StoreWriter> =>
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
