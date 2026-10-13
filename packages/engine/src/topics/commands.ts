/**
 * `topics.subscribe` and `topics.unsubscribe` (spec section 5 "Subscribe
 * works on any thread"; architecture 4.4 and 5.7; ADR 0010).
 *
 * One command is three steps:
 * 1. one writer transaction that reads the state before the change, writes
 *    the new state and fires the keys the sidebar query listens to, so the
 *    row appears or leaves at once;
 * 2. for a thread, the mirror call to Slack through the `Outbox` seam
 *    (`subscriptions.thread.add` or `.remove` with `channel`, `thread_ts`
 *    and `last_read`, research section 3). Main has no Slack subscription:
 *    its flag is client-only and the command ends after step 1;
 * 3. the outcome, refreshed from Slack where Slack may know better. While
 *    the call is in flight the thread has a pending `follow` outbox row:
 *    socket events and pages about the thread do not change the flag (the
 *    command's intent stays visible) but are noted. After success, a noted
 *    observation means Slack may have changed since it accepted the call,
 *    so the root is looked up and its `subscribed` applies. After a final
 *    failure the root is always looked up; restoring the state from before
 *    the command could restore something stale. Only when that lookup fails
 *    too is the old state put back, and then only while the row is still
 *    what step 1 wrote. The command then fails with the contract's error.
 *
 * Commands on the same thread run one at a time (`Outbox.exclusive`). A
 * command stamps `thread_subs.observed_at` with its own time, so a page
 * requested before it cannot bring the old state back. specs/follow.qnt
 * models this: `localChange`, `accept`, `acknowledge`, `reject`.
 *
 * The undo is computed from the state before the change: a change returns
 * the opposite command, no change returns nothing.
 *
 * Thread state is Slack's follow flag in `thread_subs`; Main state is
 * `topic_overlay.unsubscribed_at`. The pure rules in `@juno/domain` read
 * both (`isSubscribed`, `sidebarPlacement`).
 */
import { Clock, Effect } from 'effect'
import { NotFound, NotSignedIn, type CommandResult, type SubscribeError } from '@juno/contract'
import { compareTs, millisToTs, parseTopicId, type Ts } from '@juno/domain'
import { Invalidation, StoreWriter, transaction, type SqlError } from '@juno/store'
import {
  beginPendingFollow,
  clearThreadSub,
  endPendingFollow,
  readMessage,
  readState,
  setThreadSub,
  syncKeys,
  threadSub,
  type ThreadSubRow,
} from '@juno/sync'
import { Outbox } from '../outbox'
import { Workspace, type StoreServices } from '../workspace'

type Services = Workspace | Outbox

/** `topics.subscribe` when `subscribed`, `topics.unsubscribe` otherwise. */
export const setSubscribed = (id: string, subscribed: boolean): Effect.Effect<CommandResult, SubscribeError, Services> =>
  Effect.gen(function* () {
    const workspace = yield* Workspace
    const open = yield* workspace.current
    if (open === undefined) return yield* new NotSignedIn()
    const parsed = parseTopicId(id)
    if (parsed === undefined || parsed.kind === 'group') return yield* new NotFound({ kind: 'topic', id })
    // A store failure is a bug, not a state the user can act on (architecture 2.6).
    const local = <A>(effect: Effect.Effect<A, SqlError, StoreServices>): Effect.Effect<A> => effect.pipe(Effect.provide(open.context), Effect.orDie)
    const undo: CommandResult = { undo: { _tag: subscribed ? 'topics.unsubscribe' : 'topics.subscribe', id } }

    if (parsed.kind === 'main') {
      const changed = yield* local(transaction(setMainSubscribed(parsed.channel, id, subscribed)))
      if (changed === 'missing') return yield* new NotFound({ kind: 'topic', id })
      return changed ? undo : {}
    }

    const { channel, threadTs } = parsed
    const outbox = yield* Outbox

    /** Slack's root for the thread, applied as a page. Returns false when Slack could not say. */
    const refresh = (previous: ThreadSubRow | undefined, forgetIfUnfollowed: boolean) =>
      Effect.gen(function* () {
        const requestedAt = millisToTs(yield* Clock.currentTimeMillis)
        const answer = yield* Effect.result(
          outbox.lookup((api) => api.call('conversations.replies', { channel, ts: threadTs as Ts, oldest: threadTs as Ts, inclusive: true, limit: 1 })),
        )
        const root = answer._tag === 'Success' ? answer.success.messages.find((m) => m.ts === threadTs) : undefined
        if (root?.subscribed === undefined) return false
        yield* local(transaction(applyLookup(channel, threadTs, root.subscribed, root.last_read, requestedAt, forgetIfUnfollowed && previous === undefined)))
        return true
      })

    return yield* outbox.exclusive(id)(
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        const stamp = millisToTs(now)
        const before = yield* local(transaction(setThreadSubscribed(channel, threadTs, id, subscribed, stamp, now)))
        if (before === 'missing') return yield* new NotFound({ kind: 'topic', id })
        if (before === 'unchanged') return {}
        const args = { channel, thread_ts: threadTs, last_read: before.lastRead }
        const result = yield* Effect.result(outbox.send((api) => api.call(subscribed ? 'subscriptions.thread.add' : 'subscriptions.thread.remove', args)))
        const seen = yield* local(transaction(endPendingFollow(channel, threadTs)))
        if (result._tag === 'Success') {
          if (seen) yield* refresh(before.previous, false)
          return undo
        }
        if (!(yield* refresh(before.previous, true))) yield* local(transaction(revertThreadSub(channel, threadTs, { subscribed, stamp }, before.previous)))
        return yield* result.failure
      }),
    )
  })

/** The state a failed mirror call may fall back to, and the read pointer the mirror call sends. */
interface ThreadBefore {
  readonly previous: ThreadSubRow | undefined
  readonly lastRead: Ts
}

const setThreadSubscribed = (
  channel: string,
  threadTs: string,
  topicId: string,
  subscribed: boolean,
  stamp: Ts,
  now: number,
): Effect.Effect<ThreadBefore | 'missing' | 'unchanged', SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const root = yield* readMessage(channel, threadTs)
    if (root === undefined) return 'missing'
    const previous = yield* threadSub(channel, threadTs)
    if ((previous?.subscribed ?? false) === subscribed) return 'unchanged'
    yield* setThreadSub(channel, threadTs, subscribed, undefined, { kind: 'command', at: stamp })
    yield* beginPendingFollow(channel, threadTs, subscribed, now)
    // Slack wants the thread's read pointer with a follow change. Juno's when it has one; otherwise the root, so
    // the change never marks replies read in Slack that the user has not seen.
    const reads = yield* readState(topicId)
    return { previous, lastRead: (reads.lastReadTs ?? root.ts) as Ts }
  })

/**
 * A root lookup's `subscribed`, unless something newer was observed since
 * the lookup started. After a failed first Subscribe, Slack's "not
 * followed" is stored as silence again (`forget`), as before the command.
 */
const applyLookup = (
  channel: string,
  threadTs: string,
  subscribed: boolean,
  lastRead: string | undefined,
  requestedAt: Ts,
  forget: boolean,
): Effect.Effect<void, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const current = yield* threadSub(channel, threadTs)
    if (current?.observedAt !== undefined && compareTs(current.observedAt, requestedAt) >= 0) return
    if (!subscribed && forget) return yield* clearThreadSub(channel, threadTs)
    yield* setThreadSub(channel, threadTs, subscribed, subscribed ? lastRead : undefined, { kind: 'page', requestedAt })
  })

/** The fallback when Slack cannot be asked: `previous` back, but only while the row is still what the command wrote. */
const revertThreadSub = (
  channel: string,
  threadTs: string,
  wrote: { readonly subscribed: boolean; readonly stamp: Ts },
  previous: ThreadSubRow | undefined,
): Effect.Effect<void, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const current = yield* threadSub(channel, threadTs)
    if (current?.subscribed !== wrote.subscribed || current.observedAt !== wrote.stamp) return
    if (previous === undefined) return yield* clearThreadSub(channel, threadTs)
    yield* setThreadSub(channel, threadTs, previous.subscribed, previous.slackLastRead, { kind: 'command', at: wrote.stamp })
  })

/** Main's client-only flag. Returns whether anything changed, or `missing` for a conversation the store does not know. */
const setMainSubscribed = (channel: string, topicId: string, subscribed: boolean): Effect.Effect<boolean | 'missing', SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const known = yield* sql<{ id: string }>`SELECT id FROM conversations WHERE id = ${channel}`
    if (known.length === 0) return 'missing'
    const rows = yield* sql<{ unsubscribed_at: string | null }>`SELECT unsubscribed_at FROM topic_overlay WHERE topic_id = ${topicId}`
    const current = rows[0]?.unsubscribed_at ?? null
    if ((current === null) === subscribed) return false
    const value = subscribed ? null : String(yield* Clock.currentTimeMillis)
    yield* sql`INSERT INTO topic_overlay (topic_id, unsubscribed_at) VALUES (${topicId}, ${value})
      ON CONFLICT (topic_id) DO UPDATE SET unsubscribed_at = excluded.unsubscribed_at`
    yield* Invalidation.use((i) => i.invalidate(syncKeys.overlay(topicId)))
    return true
  })
