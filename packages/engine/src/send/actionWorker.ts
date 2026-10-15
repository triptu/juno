/**
 * `ActionWorker`: sends edits, deletes and reactions (architecture 5.7,
 * specs/outbox.qnt). The rows are written by the commands
 * (`actions.ts`, `@juno/sync` `actions.ts`).
 *
 * Rows are taken oldest first, and a channel's later rows wait while an
 * earlier one is not settled, so changes reach Slack in the order they
 * were made. For each row:
 *
 * - The message's ts is found first. A row whose post may still reach
 *   Slack waits for it (`depends_on`); one whose post was refused applies
 *   to the failed row instead; one whose post is gone ends unsent.
 * - A reaction back to what Slack has ends unsent: an add and a remove
 *   cancel.
 * - The call goes out through `Outbox.send`. Unlike a post these calls can
 *   be repeated safely: an edit sets the text again, and Slack's answers to
 *   a repeat (`message_not_found` after a delete, `already_reacted`,
 *   `no_reaction`) mean the change is there.
 * - Success stores the change as the socket event would and ends the row in
 *   the same transaction (`TopicFetcher.acted`), unless the user changed it
 *   again meanwhile, when it is sent again. A refusal ends the row, so the
 *   message shows what Slack has. No answer, Slack's own trouble
 *   (`internal_error` and friends), a rate limit or no session: tried again
 *   with backoff, also after a restart.
 *
 * Nothing is sent while no sync runs. The end of each boot or catch-up
 * makes every row due (architecture 5.8).
 */
import { Clock, Context, Effect, Layer, Queue, Stream } from 'effect'
import { millisToTs, type Ts } from '@juno/domain'
import { transaction } from '@juno/store'
import { actionDone, deferAction, dropAction, flushActions, pendingActions, placeOf, settleOnFailedPost, storedMe, type Acted, type PendingAction, type TopicFetcher } from '@juno/sync'
import { Outbox, type MirrorError } from '../outbox'
import { SyncLink } from '../syncLink'
import { Workspace, type OpenWorkspace } from '../workspace'
import { inStore } from './worker'

/** A message as Slack sends it, the shape `TopicFetcher.acted` stores. */
type Message = Parameters<TopicFetcher['sent']>[0]['message']

/** Longest wait between two tries of a row that keeps failing. */
const MAX_BACKOFF_MILLIS = 5 * 60_000
/** How long a row waits for a session before it is tried again. */
const NO_SESSION_MILLIS = 5_000
/** A worker pass that failed (a store error) is tried again after this. */
const PASS_RETRY_MILLIS = 5_000
/** How often a row waiting for its post looks again, besides the wakes from the send commands. */
const DEPENDENCY_POLL_MILLIS = 250
/** Refusals Slack gives for its own trouble: tried again later, like no answer. */
const TRANSIENT = new Set(['internal_error', 'fatal_error', 'request_timeout', 'service_unavailable', 'ratelimited'])
/** Answers that mean a repeated call found its change already made. */
const ALREADY_DONE = new Set(['message_not_found', 'already_reacted', 'no_reaction'])

export class ActionWorker extends Context.Service<
  ActionWorker,
  {
    /** Look at the pending actions now: a command queued one, or a post settled. */
    readonly wake: Effect.Effect<void>
  }
>()('juno/engine/send/ActionWorker') {
  static readonly layer: Layer.Layer<ActionWorker, never, Workspace | Outbox | SyncLink> = Layer.effect(
    ActionWorker,
    Effect.gen(function* () {
      const workspace = yield* Workspace
      const outbox = yield* Outbox
      const link = yield* SyncLink
      const signal = yield* Queue.sliding<void>(1)
      const wake = Effect.asVoid(Queue.offer(signal, undefined))

      /** The call for a row whose message has `ts`, and what Slack's acceptance stores. Undefined when there is nothing to send. */
      const callFor = (action: PendingAction, ts: string, selfId: string): Effect.Effect<Acted, MirrorError> => {
        const { channel } = action
        switch (action.kind) {
          case 'edit': {
            const text = action.payload.text ?? ''
            const blocks = action.payload.blocksJson == null ? undefined : JSON.parse(action.payload.blocksJson)
            return outbox
              .send((api) => api.call('chat.update', { channel, ts: ts as Ts, text, ...(blocks === undefined ? {} : { blocks }) }))
              .pipe(
                Effect.flatMap((answer) =>
                  Effect.map(Clock.currentTimeMillis, (now) => {
                    // Slack's answer carries the message; when it does not, it is what Juno sent. Either way it is edited now.
                    const sent: Message = answer.message ?? ({ type: 'message', ts: ts as Ts, user: selfId, text, ...(blocks === undefined ? {} : { blocks }) } as Message)
                    const message: Message = { ...sent, ts: ts as Ts, edited: sent.edited ?? { user: selfId, ts: millisToTs(now) } }
                    return { kind: 'edited', channel, message } as const
                  }),
                ),
              )
          }
          case 'delete':
            return outbox.send((api) => api.call('chat.delete', { channel, ts: ts as Ts })).pipe(Effect.as({ kind: 'deleted', channel, ts } as const))
          case 'react': {
            const name = action.payload.name ?? ''
            const added = action.payload.want === true
            return outbox
              .send((api) => api.call(added ? 'reactions.add' : 'reactions.remove', { channel, timestamp: ts as Ts, name }))
              .pipe(Effect.as({ kind: 'reacted', channel, ts, name, added } as const))
          }
        }
      }

      /** What the call stores when Slack says the change was already made. */
      const alreadyDone = (action: PendingAction, ts: string): Acted | undefined =>
        action.kind === 'delete'
          ? ({ kind: 'deleted', channel: action.channel, ts } as const)
          : action.kind === 'react'
            ? ({ kind: 'reacted', channel: action.channel, ts, name: action.payload.name ?? '', added: action.payload.want === true } as const)
            : undefined

      /** Settles one row. Answers whether it still waits for its post. */
      const run = (open: OpenWorkspace, fetcher: TopicFetcher, action: PendingAction) =>
        Effect.gen(function* () {
          const local = inStore(open)
          const place = yield* local(placeOf(action))
          switch (place.kind) {
            case 'waiting':
              return true
            case 'gone':
              yield* local(transaction(dropAction(action)))
              return false
            case 'failed':
              yield* local(transaction(settleOnFailedPost(action, place.post)))
              return false
            case 'ready':
              break
          }
          if (action.kind === 'react' && action.payload.want === action.payload.base) {
            yield* local(transaction(dropAction(action)))
            return false
          }
          const selfId = (yield* local(storedMe))?.userId ?? ''
          const result = yield* Effect.result(callFor(action, place.ts, selfId))
          const now = yield* Clock.currentTimeMillis
          const done = () => actionDone(action, now)
          if (result._tag === 'Success') {
            yield* fetcher.acted(result.success, done()).pipe(Effect.orDie)
            return false
          }
          const error: MirrorError = result.failure
          switch (error._tag) {
            case 'Rejected': {
              const acted = ALREADY_DONE.has(error.code) ? alreadyDone(action, place.ts) : undefined
              if (acted !== undefined) {
                yield* fetcher.acted(acted, done()).pipe(Effect.orDie)
                return false
              }
              if (TRANSIENT.has(error.code)) {
                yield* local(transaction(deferAction(action, now + backoff(action.attempts), error.code)))
                return false
              }
              yield* Effect.logWarning('send: Slack refused a message change', { kind: action.kind, code: error.code })
              yield* local(transaction(dropAction(action)))
              return false
            }
            case 'RateLimited':
              yield* local(transaction(deferAction(action, now + Math.max(error.retryAfterMillis, backoff(action.attempts)), error._tag)))
              return false
            case 'NotSignedIn':
              yield* local(transaction(deferAction(action, now + NO_SESSION_MILLIS, error._tag)))
              return false
            case 'Offline':
              yield* local(transaction(deferAction(action, now + backoff(action.attempts), error._tag)))
              return false
          }
        })

      /** Settles every due row. Returns how long until the next one is due, or `undefined` when none waits. */
      const pass = (open: OpenWorkspace) =>
        Effect.gen(function* () {
          const local = inStore(open)
          const fetcher = yield* link.fetcher
          if (fetcher === undefined) return undefined
          const now = yield* Clock.currentTimeMillis
          const held = new Set<string>()
          const waiting = new Set<number>()
          for (const action of yield* local(pendingActions)) {
            if (held.has(action.channel)) continue
            held.add(action.channel)
            if (action.nextAt > now) continue
            if (yield* run(open, fetcher, action)) waiting.add(action.id)
          }
          const rest = (yield* local(pendingActions)).filter((action) => !waiting.has(action.id))
          const after = yield* Clock.currentTimeMillis
          const due = rest.length === 0 ? undefined : Math.max(0, Math.min(...rest.map((action) => action.nextAt)) - after)
          // A row waiting for its post looks again soon; the post's own settling does not wake this worker.
          return waiting.size === 0 ? due : Math.min(due ?? DEPENDENCY_POLL_MILLIS, DEPENDENCY_POLL_MILLIS)
        }).pipe(Effect.catchCause((cause) => Effect.as(Effect.logError('send: action pass failed', { cause }), PASS_RETRY_MILLIS)))

      const loop = Effect.gen(function* () {
        while (true) {
          const open = yield* workspace.current
          const wait = open === undefined ? undefined : yield* pass(open)
          yield* Effect.raceFirst(Queue.take(signal), wait === undefined ? Effect.never : Effect.sleep(wait))
        }
      })

      const flush = Effect.gen(function* () {
        const open = yield* workspace.current
        if (open !== undefined) yield* inStore(open)(transaction(flushActions(yield* Clock.currentTimeMillis)))
        yield* wake
      })

      yield* Effect.forkScoped(Stream.runForEach(workspace.changes, () => wake))
      yield* Effect.forkScoped(Stream.runForEach(link.caughtUps, () => flush))
      yield* Effect.forkScoped(loop)
      return ActionWorker.of({ wake })
    }),
  )
}

const backoff = (attempts: number): number => Math.min(1000 * 2 ** attempts, MAX_BACKOFF_MILLIS)
