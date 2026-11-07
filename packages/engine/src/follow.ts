/**
 * `topics.subscribe` and `topics.unsubscribe`, and Notify me on a thread
 * (`notifications.setLevel`): follow and unfollow a thread
 * (spec section 5 "Notify me on a thread"; architecture 4.4 and 5.7; ADR
 * 0010). Main has no follow; a Main id is `NotFound`.
 *
 * One command is three steps:
 * 1. one writer transaction that reads the state before the change, writes
 *    the new state and fires the keys the sidebar query listens to, so the
 *    row appears or leaves at once;
 * 2. the mirror call to Slack through the `Outbox` seam
 *    (`subscriptions.thread.add` or `.remove` with `channel`, `thread_ts`
 *    and `last_read`, research section 3);
 * 3. the outcome, refreshed from Slack where Slack may know better. While
 *    the call is in flight the thread has a pending `follow` outbox row:
 *    socket events and pages about the thread do not change the flag (the
 *    command's intent stays visible) but are noted. After success, a noted
 *    observation means Slack may have changed since it accepted the call,
 *    so the root is looked up and its `subscribed` applies. After a failure
 *    the root is always looked up: the answer may have been lost after Slack
 *    accepted the call, so the state from before the command is never put
 *    back unasked. When the lookup fails too, the row keeps the command's
 *    state and the lookup is retried in the background with backoff, until
 *    Slack answers or something newer about the thread is observed. The
 *    command then fails with the contract's error.
 *
 * Commands on the same thread run one at a time (`Outbox.exclusive`). A
 * command stamps `thread_subs.observed_at` with its own time, and again when
 * it ends, so a page requested before or during it cannot bring the old
 * state back. specs/follow.qnt models this: `localChange`, `accept`,
 * `acknowledge`, `reject`, `failLookup`.
 *
 * Only the mirror call and the lookup after it can be cut off (the window
 * closed, Follow new threads restarted). A command cut off during the call
 * still ends its row, and Slack is asked in the background as after a
 * failure, since it may have accepted the call. One cut off during the
 * lookup leaves that lookup to the background too, so nothing waits for a
 * read the command no longer needs.
 *
 * The undo is computed from the state before the change: a change returns
 * the opposite command, no change returns nothing.
 *
 * Follow new threads (`followNew.ts`) subscribes with `how: 'auto'`: the
 * same three steps on the background lane, but the first transaction also
 * records the thread in `auto_followed` and changes nothing when it was
 * recorded before or Slack has already said something about the thread
 * (followed or not). So each thread is followed this way at most once, and
 * never over an unfollow, even one the user makes while the follow waits
 * its turn (specs/follownew.qnt).
 *
 * The state is Slack's follow flag in `thread_subs`. The pure rules in
 * `@juno/domain` read it (`isFollowed`, `sidebarPlacement`).
 */
import { EngineTiming } from './config'
import { Cause, Clock, Effect, Exit, Schedule } from 'effect'
import { NotFound, NotSignedIn, type CommandResult, type SubscribeError } from '@juno/contract'
import { compareTs, maxTs, millisToTs, parseTopicId, type Ts } from '@juno/domain'
import { Invalidation, StoreWriter, transaction, type SqlError } from '@juno/store'
import {
  beginPendingFollow,
  clearThreadSub,
  endPendingFollow,
  readMessage,
  readState,
  setThreadSub,
  threadSub,
  type ThreadSubRow,
} from '@juno/sync'
import { Outbox } from './outbox'
import { Workspace, type StoreServices } from './workspace'

type Services = Workspace | Outbox

/** Who follows: the user's command, or Follow new threads. */
export type FollowedBy = 'command' | 'auto'

/** `topics.subscribe` when `subscribed`, `topics.unsubscribe` otherwise. */
export const setSubscribed = (id: string, subscribed: boolean, how: FollowedBy = 'command'): Effect.Effect<CommandResult, SubscribeError, Services> =>
  Effect.gen(function* () {
    const workspace = yield* Workspace
    const open = yield* workspace.current
    if (open === undefined) return yield* new NotSignedIn()
    const parsed = parseTopicId(id)
    if (parsed === undefined || parsed.kind !== 'thread') return yield* new NotFound({ kind: 'topic', id })
    // A store failure is a bug, not a state the user can act on (architecture 2.6).
    const local = <A>(effect: Effect.Effect<A, SqlError, StoreServices>): Effect.Effect<A> => effect.pipe(Effect.provide(open.context), Effect.orDie)
    const undo: CommandResult = { undo: { _tag: subscribed ? 'topics.unsubscribe' : 'topics.subscribe', id } }

    const { channel, threadTs } = parsed
    const timing = yield* EngineTiming
    const outbox = yield* Outbox

    /**
     * Slack's root for the thread, applied as a page. `endedAt` is when the
     * command ended; the lookup starts after it, so its stamp is later even
     * within the same millisecond. Returns false when Slack could not say.
     */
    const refresh = (previous: ThreadSubRow | undefined, forgetIfUnfollowed: boolean, endedAt: number) =>
      Effect.gen(function* () {
        const requestedAt = maxTs(millisToTs(yield* Clock.currentTimeMillis), millisToTs(endedAt, 1)) as Ts
        const answer = yield* Effect.result(
          outbox.lookup((api) => api.call('conversations.replies', { channel, ts: threadTs as Ts, oldest: threadTs as Ts, inclusive: true, limit: 1 })),
        )
        const root = answer._tag === 'Success' ? answer.success.messages.find((m) => m.ts === threadTs) : undefined
        if (root?.subscribed === undefined) return false
        yield* local(transaction(applyLookup(channel, threadTs, root.subscribed, root.last_read, requestedAt, forgetIfUnfollowed && previous === undefined)))
        return true
      })

    /** `refresh` again after a second, then with backoff, while nothing about the thread was observed after the command ended. */
    const retryRefresh = (previous: ThreadSubRow | undefined, forgetIfUnfollowed: boolean, endedAt: number, ended: Ts) =>
      Effect.gen(function* () {
        const current = yield* local(threadSub(channel, threadTs))
        if (current?.observedAt === undefined || compareTs(current.observedAt, ended) > 0) return
        if (!(yield* refresh(previous, forgetIfUnfollowed, endedAt))) return yield* Effect.fail('unanswered' as const)
      }).pipe(Effect.retry({ schedule: Schedule.exponential(timing.lookupRetryMillis), times: LOOKUP_RETRIES }), Effect.delay(timing.lookupRetryMillis))

    /** `refresh`, and when Slack could not say, `retryRefresh` in the background. */
    const refreshOrRetry = (previous: ThreadSubRow | undefined, forgetIfUnfollowed: boolean, endedAt: number, ended: Ts) =>
      Effect.gen(function* () {
        if (!(yield* refresh(previous, forgetIfUnfollowed, endedAt))) yield* outbox.background(retryRefresh(previous, forgetIfUnfollowed, endedAt, ended))
      })

    return yield* outbox.exclusive(id)(
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          const stamp = millisToTs(now)
          const before = yield* local(transaction(setThreadSubscribed(channel, threadTs, id, subscribed, stamp, now, how)))
          if (before === 'missing') return yield* new NotFound({ kind: 'topic', id })
          if (before === 'unchanged') return {}
          const args = { channel, thread_ts: threadTs, last_read: before.lastRead }
          const send = how === 'auto' ? outbox.sendBackground : outbox.send
          const exit = yield* Effect.exit(restore(send((api) => api.call(subscribed ? 'subscriptions.thread.add' : 'subscriptions.thread.remove', args))))
          const endedAt = yield* Clock.currentTimeMillis
          const ended = millisToTs(endedAt)
          const seen = yield* local(transaction(endPendingFollow(channel, threadTs, ended)))
          // After a failure Slack is always asked: the answer may have been lost after Slack accepted the call.
          const failed = Exit.isFailure(exit)
          const lookup = refreshOrRetry(before.previous, failed, endedAt, ended)
          if (failed && Cause.hasInterrupts(exit.cause)) {
            yield* outbox.background(lookup)
            return yield* Effect.failCause(exit.cause)
          }
          if (seen || failed) {
            // A read nothing else waits for: a command cut off during it leaves it to the background.
            const read = yield* Effect.exit(restore(lookup))
            if (Exit.isFailure(read)) {
              if (Cause.hasInterrupts(read.cause)) yield* outbox.background(lookup)
              return yield* Effect.failCause(read.cause)
            }
          }
          return Exit.isSuccess(exit) ? undo : yield* Effect.failCause(exit.cause)
        }),
      ),
    )
  })

/** Retries after the first background lookup: seven tries over about a minute in all. */
const LOOKUP_RETRIES = 6

/** The state before the command (a failed first Subscribe can forget the row again), and the read pointer the mirror call sends. */
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
  how: FollowedBy,
): Effect.Effect<ThreadBefore | 'missing' | 'unchanged', SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const root = yield* readMessage(channel, threadTs)
    if (root === undefined) return 'missing'
    const previous = yield* threadSub(channel, threadTs)
    if (how === 'auto' && (!(yield* claimAutoFollow(channel, threadTs)) || previous !== undefined)) return 'unchanged'
    if ((previous?.subscribed ?? false) === subscribed) return 'unchanged'
    yield* setThreadSub(channel, threadTs, subscribed, undefined, { kind: 'command', at: stamp })
    yield* beginPendingFollow(channel, threadTs, subscribed, now)
    // Slack wants the thread's read pointer with a follow change. Juno's when it has one; otherwise the root, so
    // the change never marks replies read in Slack that the user has not seen.
    const reads = yield* readState(topicId)
    return { previous, lastRead: (reads.lastReadTs ?? root.ts) as Ts }
  })

/** Records that Follow new threads has had its one go at a thread. False when it had it before. */
export const claimAutoFollow = (channel: string, threadTs: string): Effect.Effect<boolean, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const added = yield* sql<{ channel: string }>`INSERT INTO auto_followed (channel, thread_ts) VALUES (${channel}, ${threadTs})
      ON CONFLICT DO NOTHING RETURNING channel`
    return added.length > 0
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
