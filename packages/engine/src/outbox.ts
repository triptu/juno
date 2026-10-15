/**
 * The seam between a command's local change and Slack (architecture 5.7).
 *
 * A command writes its local change in one transaction, then mirrors it to
 * Slack through `Outbox.send`. Today `send` calls the method at once on the
 * `send` lane of the ready session and maps the client's errors to the
 * contract's (architecture 2.6); after a failure the caller asks Slack
 * (`lookup`) what it has, since a lost answer does not mean Slack refused.
 * The full outbox (persisted rows, retry with backoff, coalescing, revert on
 * final failure) is a later milestone and replaces this module without
 * touching the commands' shape: local transaction, mirror, settle.
 *
 * `sendOnce` is the single-attempt mode for the agent's sends (plan v3
 * §6.3): one exchange on the `send` lane and no retry, so a call is
 * submitted at most once. `Offline` then means the answer is unknown, since
 * Slack may have run the call before the answer was lost; an answer that
 * does not decode is unknown in the same way.
 *
 * `exclusive(key)` runs commands on the same target one at a time, so their
 * outcomes never interleave on the same thread. `background(effect)` runs
 * work that outlives a command, such as asking Slack again after a lookup
 * failed; it ends with the engine.
 *
 * A top-level module, like `workspace.ts`. It reaches Slack through the
 * top-level `SessionClient`, so it imports no feature folder.
 */
import { Context, Effect, FiberSet, Layer, Semaphore } from 'effect'
import { NotSignedIn, Offline, RateLimited, Rejected } from '@juno/contract'
import type { SlackApiError, SlackApiShape } from '@juno/slack'
import { SessionClient } from './sessionClient'

/** What a mirror call can fail with, as the contract names it. */
export type MirrorError = NotSignedIn | Offline | RateLimited | Rejected

export class Outbox extends Context.Service<
  Outbox,
  {
    /**
     * Runs `call` against the ready session's client, every call on the
     * `send` lane. Fails with `NotSignedIn` when there is no session.
     */
    readonly send: <A>(call: (api: SlackApiShape) => Effect.Effect<A, SlackApiError>) => Effect.Effect<A, MirrorError>
    /** Like `send`, but one exchange and no retry. `Offline` means Slack may have run it. */
    readonly sendOnce: <A>(call: (api: SlackApiShape) => Effect.Effect<A, SlackApiError>) => Effect.Effect<A, MirrorError>
    /** Like `send`, on the `interactive` lane: an authoritative lookup after a change, such as a thread's root. */
    readonly lookup: <A>(call: (api: SlackApiShape) => Effect.Effect<A, SlackApiError>) => Effect.Effect<A, MirrorError>
    /** Runs `effect` after every earlier `exclusive` effect with the same key has finished. */
    readonly exclusive: (key: string) => <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
    /** Waits for the background command recoveries already scheduled to finish. */
    readonly idle: Effect.Effect<void>
    /** Starts `effect` and returns at once. Its failures are ignored; it is interrupted when the engine stops. */
    readonly background: <A, E>(effect: Effect.Effect<A, E>) => Effect.Effect<void>
  }
>()('juno/engine/Outbox') {
  static readonly layer: Layer.Layer<Outbox, never, SessionClient> = Layer.effect(
    Outbox,
    Effect.gen(function* () {
      const client = yield* SessionClient
      const onLane =
        (lane: 'send' | 'interactive', singleAttempt = false) =>
        <A>(call: (api: SlackApiShape) => Effect.Effect<A, SlackApiError>) =>
          Effect.gen(function* () {
            const api = yield* client.api
            const laned: SlackApiShape = { call: (method, args, options) => api.call(method, args, { ...options, lane, singleAttempt }), upload: api.upload }
            return yield* call(laned).pipe(
              Effect.catch((error) => (singleAttempt && error._tag === 'SlackDecodeError' ? Effect.fail(new Offline()) : mapSlackError(error))),
            )
          })
      const send = onLane('send')
      const sendOnce = onLane('send', true)
      const lookup = onLane('interactive')

      // One permit per key. A key is dropped once nothing holds or waits for it.
      const locks = new Map<string, { readonly semaphore: Semaphore.Semaphore; users: number }>()
      const exclusive =
        (key: string) =>
        <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
          Effect.suspend(() => {
            let lock = locks.get(key)
            if (lock === undefined) {
              lock = { semaphore: Semaphore.makeUnsafe(1), users: 0 }
              locks.set(key, lock)
            }
            const held = lock
            held.users += 1
            return held.semaphore.withPermit(effect).pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  held.users -= 1
                  if (held.users === 0) locks.delete(key)
                }),
              ),
            )
          })

      const recoveries = yield* FiberSet.make<void>()
      const background = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<void> =>
        FiberSet.run(recoveries, Effect.ignore(effect).pipe(Effect.asVoid)).pipe(Effect.asVoid)

      return Outbox.of({ send, sendOnce, lookup, exclusive, background, idle: FiberSet.awaitEmpty(recoveries) })
    }),
  )
}

/** Architecture 2.6, "Error mapping". A decode error is a bug in our schemas and dies. */
const mapSlackError = (error: SlackApiError): Effect.Effect<never, MirrorError> => {
  switch (error._tag) {
    case 'SlackAuthRequired':
      return Effect.fail(new NotSignedIn())
    case 'SlackRateLimited':
      return Effect.fail(new RateLimited({ retryAfterMillis: error.retryAfterMillis }))
    case 'SlackRejected':
      return Effect.fail(new Rejected({ code: error.error }))
    case 'SlackTransportError':
      return Effect.fail(new Offline())
    case 'SlackDecodeError':
      return Effect.die(error)
  }
}
