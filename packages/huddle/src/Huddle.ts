/**
 * The `Huddle` service: one user's call (specs/huddle.qnt, "Implementation
 * notes" in specs/README.md).
 *
 * - `lifecycle.ts`: the model's actions as pure rules.
 * - `media.ts`: the pages' media, as current state.
 * - `core.ts`: the state, the lock, and the I/O the rules call for.
 * - `attach.ts`: a sync's session, and its end.
 * - `boot.ts`: every workspace's stored leaves, read at boot.
 * - `reads.ts`: running huddles from room frames and `huddles/info`.
 * - `slack.ts`: the requests, in the official client's shape.
 * - `status.ts`: the "In a huddle" status while the call is live.
 */
import { Context, Data, Effect, Layer, Scope, Stream, SubscriptionRef } from 'effect'
import type { HuddleCall, HuddleError, HuddlePageReport, HuddleStartResult, RunningHuddles } from '@juno/contract'
import type { SlackApi, SlackEdge, SocketEvent } from '@juno/slack'
import { attach } from './attach'
import { boot, type BootStores } from './boot'
import { leave, makeCore, pages, report, start } from './core'
import type { Stored } from './lifecycle'

/** The store of pending leaves failed: a failed write keeps the credentials private and leaves at once; a failed read holds joins back. */
export class HuddleStoreError extends Data.TaggedError('HuddleStoreError')<{ readonly cause: unknown }> {}

/**
 * Where the pending leaves of the session's workspace are stored. `read`
 * fails when the store cannot say (not for an empty list); `write` replaces
 * the whole list.
 */
export interface LeaveStore {
  readonly read: Effect.Effect<ReadonlyArray<Stored>, HuddleStoreError>
  readonly write: (records: ReadonlyArray<Stored>) => Effect.Effect<void, HuddleStoreError>
}

export interface HuddleSession {
  /** Which workspace's store `leaves` is: its leaves go out only through its own session. */
  readonly workspace: string
  /** The session's Slack client. */
  readonly slack: Context.Context<SlackApi | SlackEdge>
  readonly leaves: LeaveStore
  /** The conversations to read running huddles for after a gap: the ones the user is in. */
  readonly channels: Effect.Effect<ReadonlyArray<string>>
  /** Tests only: how often the huddle status is renewed (`status.ts`; the app: 240 s). */
  readonly statusRenewMillis?: number
}

/** A socket event, or the `SocketEvents` marker for events dropped while the subscriber fell behind. */
export type HuddleInput = SocketEvent | { readonly _tag: 'Overflowed' }

export type HuddleListener = (input: HuddleInput) => Effect.Effect<void>

export class Huddle extends Context.Service<Huddle, {
  /** The current call: at subscribe time, then every change. */
  readonly call: Stream.Stream<HuddleCall>
  /** Running huddles by channel: at subscribe time, then every change. */
  readonly running: Stream.Stream<RunningHuddles>
  /**
   * Start or join the huddle in `channelId`, leaving the current call first.
   * Answers page `generation`, on engine connection `connection`, with the
   * credentials once the leave is stored.
   */
  readonly start: (channelId: string, region: string | null, generation: number, connection: number) => Effect.Effect<HuddleStartResult, HuddleError>
  readonly leave: Effect.Effect<void>
  /** A renderer page's whole media state, and the engine connection it came on. */
  readonly report: (report: HuddlePageReport, connection: number) => Effect.Effect<void>
  /** Main's report of the live renderer page generations and the highest it gave out. */
  readonly pages: (live: ReadonlyArray<number>, maxIssued: number) => Effect.Effect<void>
  /** Reads every workspace's stored leaves; joins wait until it is done. Run once, at boot. */
  readonly boot: (stores: BootStores) => Effect.Effect<void>
  /** Gives the service a session until the calling scope closes, and returns the listener for its socket. */
  readonly attach: (session: HuddleSession) => Effect.Effect<HuddleListener, never, Scope.Scope>
}>()('juno/huddle/Huddle') {
  static readonly layer = Layer.effect(Huddle, Effect.gen(function* () {
    const core = yield* makeCore
    return Huddle.of({
      call: SubscriptionRef.changes(core.callRef),
      running: SubscriptionRef.changes(core.runningRef),
      start: (channelId, region, generation, connection) => start(core, channelId, region, generation, connection),
      leave: leave(core),
      report: (next, connection) => report(core, next, connection),
      pages: (live, maxIssued) => pages(core, live, maxIssued),
      boot: (stores) => boot(core, stores),
      attach: (session) => attach(core, session),
    })
  }))
}
