/**
 * The `Huddle` service: one user's call (specs/huddle.qnt, "Implementation
 * notes" in specs/README.md).
 *
 * - `lifecycle.ts`: the model's actions as pure rules.
 * - `core.ts`: the state, the lock, and the I/O the rules call for.
 * - `attach.ts`: a sync's session, and its end.
 * - `reads.ts`: running huddles from room frames and `huddles/info`.
 * - `slack.ts`: the requests, in the official client's shape.
 */
import { Context, Data, Effect, Layer, Scope, Stream, SubscriptionRef } from 'effect'
import type { HuddleCall, HuddleError, HuddleMediaEvent, HuddleStartResult, RunningHuddles } from '@juno/contract'
import type { SlackApi, SlackEdge, SocketEvent } from '@juno/slack'
import { attach } from './attach'
import { leave, makeCore, media, start } from './core'
import type { Identity } from './lifecycle'

/** The stored record failed to write: the credentials stay private and the attendee is left. */
export class HuddleStoreError extends Data.TaggedError('HuddleStoreError')<{ readonly cause: unknown }> {}

/** Where the pending leaves of the session's workspace are stored. `write` replaces the whole list. */
export interface LeaveStore {
  readonly read: Effect.Effect<ReadonlyArray<Identity>>
  readonly write: (records: ReadonlyArray<Identity>) => Effect.Effect<void, HuddleStoreError>
}

export interface HuddleSession {
  /** The session's Slack client. */
  readonly slack: Context.Context<SlackApi | SlackEdge>
  readonly leaves: LeaveStore
  /** The conversations to read running huddles for after a gap: the ones the user is in. */
  readonly channels: Effect.Effect<ReadonlyArray<string>>
}

/** A socket event, or the `SocketEvents` marker for events dropped while the subscriber fell behind. */
export type HuddleInput = SocketEvent | { readonly _tag: 'Overflowed' }

export type HuddleListener = (input: HuddleInput) => Effect.Effect<void>

export class Huddle extends Context.Service<Huddle, {
  /** The current call: at subscribe time, then every change. */
  readonly call: Stream.Stream<HuddleCall>
  /** Running huddles by channel: at subscribe time, then every change. */
  readonly running: Stream.Stream<RunningHuddles>
  /** Start or join the huddle in `channelId`, leaving the current call first. Answers with the credentials once the leave is stored. */
  readonly start: (channelId: string, region: string | null) => Effect.Effect<HuddleStartResult, HuddleError>
  readonly leave: Effect.Effect<void>
  /** The renderer's report about its media session. */
  readonly media: (event: HuddleMediaEvent) => Effect.Effect<void>
  /** Gives the service a session until the calling scope closes, and returns the listener for its socket. */
  readonly attach: (session: HuddleSession) => Effect.Effect<HuddleListener, never, Scope.Scope>
}>()('juno/huddle/Huddle') {
  static readonly layer = Layer.effect(Huddle, Effect.gen(function* () {
    const core = yield* makeCore
    return Huddle.of({
      call: SubscriptionRef.changes(core.callRef),
      running: SubscriptionRef.changes(core.runningRef),
      start: (channelId, region) => start(core, channelId, region),
      leave: leave(core),
      media: (event) => media(core, event),
      attach: (session) => attach(core, session),
    })
  }))
}
