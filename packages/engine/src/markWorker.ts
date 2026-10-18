/**
 * `MarkWorker`: sends pending read marks to Slack (architecture 5.6 and 5.7,
 * specs/readstate.qnt `accept`, `respond`, `retry`, `reject`).
 *
 * Each topic has at most one `mark` outbox row, written by the commands. A
 * new row waits `MARK_DELAY_MILLIS`, and later marks replace its intent, so
 * marks in quick succession make one call. The worker sends the row's
 * current intent through `Outbox.send`, one topic at a time
 * (`Outbox.exclusive`):
 *
 * - success: when no newer mark replaced the intent meanwhile the row ends,
 *   Juno records Slack's new pointer and stamps its observation clock, and,
 *   when Slack said something about the topic while the mark was pending,
 *   asks Slack for its pointer. Otherwise the newer intent is sent at once;
 * - offline or rate limited: the row keeps its intent and is sent again
 *   with backoff, also after a restart;
 * - refused (`Rejected`): the row ends and Slack is asked, so Slack's
 *   pointer applies;
 * - no session: the row waits for one.
 *
 * Main uses `conversations.mark { ts }`; a thread uses
 * `subscriptions.thread.mark { ts, read }`, with `read: 0` and the first
 * unread reply for Mark as unread. When the mirror setting is off the row is
 * dropped unsent and the mark stays local.
 */
import { Clock, Context, Effect, Layer, Queue, Schedule, Stream } from 'effect'
import { millisToTs, parseTopicId, type ParsedTopicId, type Ts } from '@juno/domain'
import { transaction, type SqlError } from '@juno/store'
import { deferMark, dropMark, endMark, observeRead, pendingMark, pendingMarks, rejectMark, reindexTopics, storedMe } from '@juno/sync'
import { EngineConfig } from './config'
import { SyncLink } from './syncLink'
import { Outbox } from './outbox'
import { watchWorkerPasses } from './workerPasses'
import { Workspace, type OpenWorkspace, type StoreServices } from './workspace'
import { queueReadCatchUp } from './readCatchUp'
import { mirrorSetting } from './readSetting'

/** Longest wait between two tries of a mark that keeps failing. */
const MAX_BACKOFF_MILLIS = 5 * 60_000
/** How long a mark waits for a session before it is tried again. */
const NO_SESSION_MILLIS = 5_000
/** A worker pass that failed (a store error) is tried again after this. */
const PASS_RETRY_MILLIS = 5_000
/** Lookups that cannot reach Slack are tried again this many times, about a minute in all. */
const LOOKUP_RETRIES = 6

type Topic = ParsedTopicId

export class MarkWorker extends Context.Service<
  MarkWorker,
  {
    /** Look at the pending marks now: a command queued one, or the setting changed. */
    readonly wake: Effect.Effect<void>
  }
>()('juno/engine/MarkWorker') {
  static readonly layer: Layer.Layer<MarkWorker, never, Workspace | Outbox | EngineConfig | SyncLink> = Layer.effect(
    MarkWorker,
    Effect.gen(function* () {
      const workspace = yield* Workspace
      const outbox = yield* Outbox
      const sync = yield* SyncLink
      const config = yield* EngineConfig
      const signal = yield* Queue.sliding<void>(1)
      const wake = Effect.asVoid(Queue.offer(signal, undefined))

      /** Slack's pointer for the topic, applied as a page. Fails when Slack could not answer, or answered too late to apply. */
      const lookUp = (open: OpenWorkspace, topic: Topic, topicId: string) =>
        Effect.gen(function* () {
          const local = inStore(open)
          const requestedAt = millisToTs(yield* Clock.currentTimeMillis)
          const answer = yield* outbox.lookup((api) =>
            topic.kind === 'main'
              ? Effect.map(api.call('conversations.info', { channel: topic.channel }), (r) => r.channel.last_read)
              : Effect.map(
                  api.call('conversations.replies', { channel: topic.channel, ts: topic.threadTs, oldest: topic.threadTs, inclusive: true, limit: 1 }),
                  (r) => r.messages.find((m) => m.ts === topic.threadTs)?.last_read,
                ),
          )
          if (answer === undefined) return
          const outcome = yield* local(
            transaction(
              Effect.gen(function* () {
                const observed = yield* observeRead(topicId, { kind: 'page', lastReadTs: answer, requestedAt })
                const me = yield* storedMe
                if (observed === 'applied' && me !== undefined) yield* reindexTopics([topicId], { me })
                return observed
              }),
            ),
          )
          // Something newer was observed while the lookup was in flight, and Slack still disagrees: ask again.
          if (outcome === 'lookup') return yield* Effect.fail('again' as const)
        }).pipe(Effect.retry({ schedule: Schedule.exponential('1 second'), times: LOOKUP_RETRIES }))

      const send = (open: OpenWorkspace, topicId: string) =>
        outbox.exclusive(topicId)(
          Effect.gen(function* () {
            const local = inStore(open)
            const mark = yield* local(pendingMark(topicId))
            const now = yield* Clock.currentTimeMillis
            if (mark === undefined || mark.nextAt > now) return
            const parsed = parseTopicId(topicId)
            if (parsed === undefined || !(yield* local(mirrorSetting(config))).on) {
              return yield* local(transaction(dropMark(topicId)))
            }
            const topic = parsed
            const result = yield* Effect.result(
              (mark.catchUp ? outbox.sendBackground : outbox.send)((api) =>
                topic.kind === 'main'
                  ? api.call('conversations.mark', { channel: topic.channel, ts: mark.lastReadTs })
                  : api.call('subscriptions.thread.mark', {
                      channel: topic.channel,
                      thread_ts: topic.threadTs,
                      ts: mark.unread ? (mark.from ?? mark.lastReadTs) : mark.lastReadTs,
                      read: !mark.unread,
                    }),
              ),
            )
            const answeredMillis = yield* Clock.currentTimeMillis
            const answeredAt: Ts = millisToTs(answeredMillis)
            if (result._tag === 'Success') {
              const { seen } = yield* local(transaction(endMark(topicId, { gen: mark.gen, lastReadTs: mark.lastReadTs }, answeredAt)))
              if (seen) yield* outbox.background(lookUp(open, topic, topicId))
              return
            }
            const error = result.failure
            switch (error._tag) {
              case 'Rejected':
                if (yield* local(transaction(rejectMark(topicId, mark.gen, answeredAt)))) yield* outbox.background(lookUp(open, topic, topicId))
                return yield* Effect.logWarning('reads: Slack refused a mark', { code: error.code })
              case 'NotSignedIn':
                return yield* local(deferMark(topicId, answeredMillis + NO_SESSION_MILLIS, error._tag))
              case 'RateLimited':
                return yield* local(deferMark(topicId, answeredMillis + Math.max(error.retryAfterMillis, backoff(mark.attempts)), error._tag))
              case 'Offline':
                return yield* local(deferMark(topicId, answeredMillis + backoff(mark.attempts), error._tag))
            }
          }),
        )

      /** Sends every due mark. Returns how long until the next one is due, or `undefined` when none is pending. */
      const observePass = watchWorkerPasses('mark')
      const pass = (open: OpenWorkspace) =>
        Effect.gen(function* () {
          const local = inStore(open)
          yield* local(transaction(queueReadCatchUp(config, true)))
          const now = yield* Clock.currentTimeMillis
          yield* observePass(now)
          const due = (yield* local(pendingMarks)).filter((mark) => mark.nextAt <= now)
          // Re-read the queue between catch-up marks so newly opened topics do not wait for the backlog.
          const catchUp = due.find((mark) => mark.catchUp)
          const batch = due.filter((mark) => !mark.catchUp)
          if (catchUp !== undefined) batch.push(catchUp)
          yield* Effect.forEach(batch, (mark) => send(open, mark.topicId), { concurrency: 4, discard: true })
          const rest = yield* local(pendingMarks)
          if (rest.length === 0) return undefined
          const after = yield* Clock.currentTimeMillis
          return Math.max(0, Math.min(...rest.map((mark) => mark.nextAt)) - after)
        }).pipe(
          Effect.catchCause((cause) => Effect.as(Effect.logError('reads: mark pass failed', { cause }), PASS_RETRY_MILLIS)),
        )

      const loop = Effect.gen(function* () {
        while (true) {
          const open = yield* workspace.current
          const wait = open === undefined ? undefined : yield* pass(open)
          yield* Effect.raceFirst(Queue.take(signal), wait === undefined ? Effect.never : Effect.sleep(wait))
        }
      })

      yield* Effect.forkScoped(loop)
      // A workspace that opens (a sign-in, a restart) may hold marks from before.
      yield* Effect.forkScoped(Stream.runForEach(workspace.changes, () => wake))
      yield* Effect.forkScoped(Stream.runForEach(sync.caughtUps, () => wake))
      return MarkWorker.of({ wake })
    }),
  )
}

/** Runs a store effect in the open workspace. A store failure is a bug (architecture 2.6). */
const inStore =
  (open: OpenWorkspace) =>
  <A>(effect: Effect.Effect<A, SqlError, StoreServices>): Effect.Effect<A> =>
    effect.pipe(Effect.provide(open.context), Effect.orDie)

const backoff = (attempts: number): number => Math.min(1000 * 2 ** attempts, MAX_BACKOFF_MILLIS)
