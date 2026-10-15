/**
 * `PostWorker`: posts queued messages and settles posts whose answer was
 * lost (architecture 5.7, specs/outbox.qnt).
 *
 * Rows are taken oldest first, and a channel's later rows wait while an
 * earlier one is not settled, so messages reach Slack in the order they
 * were sent. A `failed` row does not hold the channel up.
 *
 * - `queued`: the row becomes `sending` in its own transaction, then one
 *   `chat.postMessage` with its `client_msg_id` goes out through
 *   `Outbox.sendOnce`, which never retries, because a retry after a lost
 *   answer posts twice. The answer is stored as the echo would store it,
 *   which ends the row. A refusal makes it `failed`; a rate limit or a lost
 *   session puts it back to `queued` for later; a lost answer, or an
 *   answer Slack gives when it may have run the call (`internal_error` and
 *   friends), makes it `unknown`.
 * - `unknown`: after `SETTLE_MILLIS`, the worker reads the topic's recent
 *   messages from Slack. The message is there: it is stored, which ends the
 *   row. A complete read without it: the row is `queued` again. No answer:
 *   it asks again with backoff.
 *
 * Any write of the message (the echo, a page, the answer, the lookup) ends
 * the row in the same transaction (`writeMessage`), whichever comes first.
 * A row still `sending` when a pass starts was cut off (a restart, a store
 * failure) and becomes `unknown`, and the end of each boot
 * or catch-up makes every row due (the flush, architecture 5.8). Nothing is
 * sent while no sync runs.
 */
import { Clock, Context, Effect, Layer, Queue, Stream } from 'effect'
import { millisToTs, type Ts } from '@juno/domain'
import { transaction, type SqlError } from '@juno/store'
import {
  claimPost,
  deferLookup,
  failPost,
  flushPosts,
  pendingPosts,
  postUnknown,
  recoverPosts,
  requeuePost,
  type PendingPost,
  type TopicFetcher,
} from '@juno/sync'
import { Outbox } from '../outbox'
import { SyncLink } from '../syncLink'
import { Workspace, type OpenWorkspace, type StoreServices } from '../workspace'

/** A message as Slack sends it, the shape `TopicFetcher.sent` stores. */
type Message = Parameters<TopicFetcher['sent']>[0]['message']

/** How long after a lost answer the worker asks Slack whether the message is there. */
export const SETTLE_MILLIS = 2_000
/** Longest wait between two tries of a row that keeps failing. */
const MAX_BACKOFF_MILLIS = 5 * 60_000
/** How long a row waits for a session before it is tried again. */
const NO_SESSION_MILLIS = 5_000
/** A worker pass that failed (a store error) is tried again after this. */
const PASS_RETRY_MILLIS = 5_000
/** The lookup reads Slack's messages from this long before the send, for clocks that disagree. */
const LOOKUP_MARGIN_MILLIS = 5 * 60_000
/** Pages the lookup reads at most before it gives up and asks again later. */
const LOOKUP_PAGES = 5
/** Refusals that Slack may give after running the call: the answer is unknown, not a refusal. */
const MAYBE_POSTED = new Set(['internal_error', 'fatal_error', 'request_timeout', 'service_unavailable'])

export class PostWorker extends Context.Service<
  PostWorker,
  {
    /** Look at the pending posts now: a command queued one, or a row changed. */
    readonly wake: Effect.Effect<void>
  }
>()('juno/engine/send/PostWorker') {
  static readonly layer: Layer.Layer<PostWorker, never, Workspace | Outbox | SyncLink> = Layer.effect(
    PostWorker,
    Effect.gen(function* () {
      const workspace = yield* Workspace
      const outbox = yield* Outbox
      const link = yield* SyncLink
      const signal = yield* Queue.sliding<void>(1)
      const wake = Effect.asVoid(Queue.offer(signal, undefined))

      const post = (open: OpenWorkspace, fetcher: TopicFetcher, row: PendingPost) =>
        Effect.gen(function* () {
          const local = inStore(open)
          if (!(yield* local(transaction(claimPost(row.clientMsgId))))) return
          const result = yield* outbox
            .sendOnce((api) =>
              api.call('chat.postMessage', {
                channel: row.channel,
                text: row.text,
                ...(row.blocksJson === null ? {} : { blocks: JSON.parse(row.blocksJson) }),
                client_msg_id: row.clientMsgId,
                ...(row.threadTs === undefined ? {} : { thread_ts: row.threadTs as Ts }),
              }),
            )
            .pipe(
              Effect.result,
              // A bug after the request left may still have posted: unknown, never failed.
              Effect.catchDefect(() => Effect.succeed(undefined)),
            )
          const now = yield* Clock.currentTimeMillis
          if (result === undefined) return yield* local(transaction(postUnknown(row.clientMsgId, now + SETTLE_MILLIS, 'defect')))
          if (result._tag === 'Success') {
            // The answer may leave out the id; the stored message carries it, which ends the row.
            const message: Message = { ...result.success.message, client_msg_id: result.success.message.client_msg_id ?? row.clientMsgId }
            return yield* fetcher.sent({ channel: result.success.channel, message }).pipe(Effect.orDie)
          }
          const error = result.failure
          switch (error._tag) {
            case 'Rejected':
              if (MAYBE_POSTED.has(error.code)) return yield* local(transaction(postUnknown(row.clientMsgId, now + SETTLE_MILLIS, error.code)))
              yield* Effect.logWarning('send: Slack refused a message', { code: error.code })
              return yield* local(transaction(failPost(row.clientMsgId, error.code)))
            case 'RateLimited':
              return yield* local(transaction(requeuePost(row.clientMsgId, now + Math.max(error.retryAfterMillis, backoff(row.attempts)), error._tag)))
            case 'NotSignedIn':
              return yield* local(transaction(requeuePost(row.clientMsgId, now + NO_SESSION_MILLIS, error._tag)))
            case 'Offline':
              return yield* local(transaction(postUnknown(row.clientMsgId, now + SETTLE_MILLIS, error._tag)))
          }
        })

      /** Reads the topic's recent messages for the row's `client_msg_id`, newest pages first. */
      const lookUp = (open: OpenWorkspace, fetcher: TopicFetcher, row: PendingPost) =>
        Effect.gen(function* () {
          const local = inStore(open)
          const oldest = millisToTs(row.createdAt - LOOKUP_MARGIN_MILLIS)
          let cursor: string | undefined
          for (let page = 0; page < LOOKUP_PAGES; page++) {
            const answer = yield* outbox
              .lookup((api) =>
                row.threadTs === undefined
                  ? api.call('conversations.history', { channel: row.channel, oldest, limit: 100, ...(cursor === undefined ? {} : { cursor }) })
                  : api.call('conversations.replies', { channel: row.channel, ts: row.threadTs as Ts, oldest, limit: 100, ...(cursor === undefined ? {} : { cursor }) }),
              )
              .pipe(Effect.option)
            const now = yield* Clock.currentTimeMillis
            if (answer._tag === 'None') return yield* local(transaction(deferLookup(row.clientMsgId, now + backoff(row.attempts))))
            const found = answer.value.messages.find((message) => message.client_msg_id === row.clientMsgId)
            if (found !== undefined) return yield* fetcher.sent({ channel: row.channel, message: found }).pipe(Effect.orDie)
            cursor = answer.value.response_metadata?.next_cursor || undefined
            if (!answer.value.has_more || cursor === undefined) {
              // Slack has decided the lost request by now (specs/outbox.qnt): it is not there, so it may go again.
              return yield* local(transaction(requeuePost(row.clientMsgId, now, 'lost')))
            }
          }
          const now = yield* Clock.currentTimeMillis
          yield* local(transaction(deferLookup(row.clientMsgId, now + backoff(row.attempts))))
        })

      /** Settles every due row. Returns how long until the next one is due, or `undefined` when none waits. */
      const pass = (open: OpenWorkspace) =>
        Effect.gen(function* () {
          const local = inStore(open)
          const fetcher = yield* link.fetcher
          // No sync, no session: rows wait for the next catch-up.
          if (fetcher === undefined) return undefined
          const now = yield* Clock.currentTimeMillis
          // One pass posts at a time, so a row still `sending` here was cut off (a restart, a store failure) and may be in Slack.
          yield* local(transaction(recoverPosts(now)))
          const held = new Set<string>()
          for (const row of yield* local(pendingPosts)) {
            if (row.state === 'failed' || held.has(row.channel)) continue
            held.add(row.channel)
            if (row.nextAt > now) continue
            if (row.state === 'queued') yield* post(open, fetcher, row)
            else if (row.state === 'unknown') yield* lookUp(open, fetcher, row)
          }
          const rest = (yield* local(pendingPosts)).filter((row) => row.state !== 'failed')
          if (rest.length === 0) return undefined
          const after = yield* Clock.currentTimeMillis
          return Math.max(0, Math.min(...rest.map((row) => row.nextAt)) - after)
        }).pipe(Effect.catchCause((cause) => Effect.as(Effect.logError('send: post pass failed', { cause }), PASS_RETRY_MILLIS)))

      const loop = Effect.gen(function* () {
        while (true) {
          const open = yield* workspace.current
          const wait = open === undefined ? undefined : yield* pass(open)
          yield* Effect.raceFirst(Queue.take(signal), wait === undefined ? Effect.never : Effect.sleep(wait))
        }
      })

      /** Every boot and catch-up flushes: rows waiting on a backoff are due at once. */
      const flush = Effect.gen(function* () {
        const open = yield* workspace.current
        if (open !== undefined) yield* inStore(open)(transaction(flushPosts(yield* Clock.currentTimeMillis)))
        yield* wake
      })

      // A workspace that opens (a sign-in, a restart) may hold posts from before.
      yield* Effect.forkScoped(Stream.runForEach(workspace.changes, () => wake))
      yield* Effect.forkScoped(Stream.runForEach(link.caughtUps, () => flush))
      yield* Effect.forkScoped(loop)
      return PostWorker.of({ wake })
    }),
  )
}

/** Runs a store effect in the open workspace. A store failure is a bug (architecture 2.6). */
export const inStore =
  (open: OpenWorkspace) =>
  <A>(effect: Effect.Effect<A, SqlError, StoreServices>): Effect.Effect<A> =>
    effect.pipe(Effect.provide(open.context), Effect.orDie)

const backoff = (attempts: number): number => Math.min(1000 * 2 ** attempts, MAX_BACKOFF_MILLIS)
