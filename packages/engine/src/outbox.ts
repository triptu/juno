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
 * A top-level module, like `workspace.ts`, because feature folders do not
 * import each other: the session owns the Slack client and the topic
 * commands need it.
 */
import { Context, Effect, Layer } from 'effect'
import { NotSignedIn, Offline, RateLimited, Rejected } from '@juno/contract'
import { SlackApi, type SlackApiError, type SlackApiShape } from '@juno/slack'
import { Session } from './session/Session'

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
  }
>()('juno/engine/Outbox') {
  static readonly layer: Layer.Layer<Outbox, never, Session> = Layer.effect(
    Outbox,
    Effect.gen(function* () {
      const session = yield* Session
      const send = <A>(call: (api: SlackApiShape) => Effect.Effect<A, SlackApiError>) =>
        Effect.gen(function* () {
          const active = yield* session.active
          const api = Context.get(active.context, SlackApi)
          const onSendLane: SlackApiShape = { call: (method, args, options) => api.call(method, args, { ...options, lane: 'send' }) }
          return yield* call(onSendLane).pipe(Effect.catch(mapSlackError))
        })
      return Outbox.of({ send })
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
