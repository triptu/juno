/**
 * The seam between a command's local change and Slack (architecture 5.7).
 *
 * A command writes its local change in one transaction, then mirrors it to
 * Slack through `Outbox.send`. Today `send` calls the method at once on the
 * `send` lane of the ready session and maps the client's errors to the
 * contract's (architecture 2.6); the caller reverts its local change when
 * the call fails. The full outbox (persisted rows, retry with backoff,
 * coalescing, revert on final failure) is a later milestone and replaces
 * this module without touching the commands' shape: local transaction,
 * mirror, revert.
 *
 * `exclusive(key)` runs commands on the same target one at a time, so a
 * revert never interleaves with a later command on the same thread.
 *
 * A top-level module, like `workspace.ts`. It reaches Slack through the
 * top-level `SessionClient`, so it imports no feature folder.
 */
import { Context, Effect, Layer, Semaphore } from 'effect'
import { NotSignedIn, Offline, RateLimited, Rejected } from '@juno/contract'
import type { SlackApiError, SlackApiShape } from '@juno/slack'
import { SessionClient } from './sessionClient'

/** What a mirror call can fail with, as the contract names it. The local change is already reverted when a command returns one. */
export type MirrorError = NotSignedIn | Offline | RateLimited | Rejected

export class Outbox extends Context.Service<
  Outbox,
  {
    /**
     * Runs `call` against the ready session's client, every call on the
     * `send` lane. Fails with `NotSignedIn` when there is no session.
     */
    readonly send: <A>(call: (api: SlackApiShape) => Effect.Effect<A, SlackApiError>) => Effect.Effect<A, MirrorError>
    /** Like `send`, on the `interactive` lane: an authoritative lookup after a change, such as a thread's root. */
    readonly lookup: <A>(call: (api: SlackApiShape) => Effect.Effect<A, SlackApiError>) => Effect.Effect<A, MirrorError>
    /** Runs `effect` after every earlier `exclusive` effect with the same key has finished. */
    readonly exclusive: (key: string) => <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  }
>()('juno/engine/Outbox') {
  static readonly layer: Layer.Layer<Outbox, never, SessionClient> = Layer.effect(
    Outbox,
    Effect.gen(function* () {
      const client = yield* SessionClient
      const onLane =
        (lane: 'send' | 'interactive') =>
        <A>(call: (api: SlackApiShape) => Effect.Effect<A, SlackApiError>) =>
          Effect.gen(function* () {
            const api = yield* client.api
            const laned: SlackApiShape = { call: (method, args, options) => api.call(method, args, { ...options, lane }) }
            return yield* call(laned).pipe(Effect.catch(mapSlackError))
          })
      const send = onLane('send')
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

      return Outbox.of({ send, lookup, exclusive })
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
