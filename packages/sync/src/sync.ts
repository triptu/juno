/**
 * `runSync`: the whole sync for one session, running until interrupted.
 *
 * It opens the socket first (so nothing during backfill is lost), then boots
 * cold or warm, then stays live: every socket event is one transaction, a
 * reconnect runs the catch-up of architecture 5.8, and a discovery sweep
 * runs every `sweepIntervalMillis`. With a catch-up or sweep, at most every
 * `followPassMillis` after the last boot or pass, the pass over the
 * followed threads of the window runs (`followPass`). Boot, catch-up, sweep
 * and that pass share one permit so two never interleave; events never wait
 * for them.
 *
 * Failures: a fatal auth condition from the socket or from any call, boot,
 * catch-up, sweep or root fetch included, fails the effect with
 * `SlackAuthRequired` and the engine ends the session. Any other boot
 * failure is logged and retried after `bootRetryMillis` with the phase at
 * `offline`; `force_reload` cuts that wait short. Any other catch-up failure
 * is logged, the phase settles, and the catch-up runs again after the rate
 * limit that stopped it or after `bootRetryMillis`. A store error is a bug; it is logged per event so one bad frame does not
 * end the sync, and surfaces in the engine log.
 */
import { SlackApi, SlackAuthRequired, SlackEdge, SlackSession, SlackSocket, type SocketEvent } from '@juno/slack'
import { Invalidation, StoreReader, StoreWriter, transaction, type SqlError } from '@juno/store'
import { Effect, FiberSet, Scope, Stream } from 'effect'
import { upgradeIndex } from './upgrade'
import { applyOpened, applySent, type Acted } from './events'
import type { FetchReport, OpenError } from './open'
import { makeBootLoop } from './run/boot'
import { makeTopicFetcher } from './run/fetcher'
import { fetchRoots, lookUpReads } from './run/lookups'
import { refreshFiles } from './run/files'
import { makeReconcile } from './run/reconcile'
import { watchWindow } from './run/window'
import { makeSyncRuntime } from './run/runtime'
import { handleSocketEvent } from './run/socket'
import { nameUsers } from './users'
import { clearPendingFollows } from './write'

/** `first`: the cold boot of an empty store, the first sync the user waits through. */
export type SyncPhase =
  | { readonly _tag: 'booting'; readonly first?: boolean }
  | { readonly _tag: 'catching-up'; readonly done: number; readonly total: number; readonly first?: boolean }
  | { readonly _tag: 'live' }
  | { readonly _tag: 'offline' }

export interface RunSyncOptions {
  /** Observer after event application. Must enqueue work without blocking the socket. */
  readonly onEvent?: (event: SocketEvent, me: import('@juno/domain').Me) => Effect.Effect<void>
  /** Brackets each boot, reboot or reconciliation, including its background follow pass. */
  readonly onCycle?: (event: 'started' | 'finished') => Effect.Effect<void>
  /** Called with the user's own presence as `client.userBoot` reports it (`self.manual_presence`), at every workspace refresh. */
  readonly onSelfPresence?: (presence: 'active' | 'away') => Effect.Effect<void>
  /** Called on every phase change. */
  readonly onPhase: (phase: SyncPhase) => Effect.Effect<void>
  /** Called when the socket says hello (true) and when it drops (false): whether Slack can be reached now. */
  readonly onConnection?: (connected: boolean) => Effect.Effect<void>
  /** Called once, before the sync connects, with the fetcher the engine's topic commands use while this sync runs. */
  readonly onFetcher?: (fetcher: TopicFetcher) => Effect.Effect<void>
  /** The topics open in a tab the user can see. They are fetched again after a reconnect and with each sweep (architecture 5.8). */
  readonly openTopics?: Effect.Effect<ReadonlyArray<string>>
  /**
   * Runs after each boot has stored its state and before the phase settles,
   * for work that should be done by the time the sync reports live (the
   * engine sorts clear bot channels into Automated here). It must not fail.
   */
  readonly onBooted?: Effect.Effect<void>
  /**
   * Runs after the cold boot stored one conversation's history page, while
   * the sidebar already shows rows (the engine sorts that conversation into
   * Automated when it is clearly a bot channel). It must not fail.
   */
  readonly onHistory?: (channel: string) => Effect.Effect<void>
  /**
   * Runs once the cold boot has listed the conversations and named the
   * people of the DMs, before the quick start lets the sidebar show rows
   * (the engine holds the channels Automated's rules have not decided yet
   * out of All). It must not fail.
   */
  readonly onListed?: Effect.Effect<void>
}

/**
 * Fetches for opened topics (`open.ts`), run in the sync's context so they
 * share its queues: stub roots get fetched and unknown senders named, both
 * in the background. On the interactive lane; when Slack rate-limits the
 * call, the same fetch is queued on the background lane and the error is
 * returned, so the caller shows what the store has.
 */
export interface TopicFetcher {
  readonly open: (topicId: string) => Effect.Effect<FetchReport, OpenError>
  readonly older: (topicId: string, before: string) => Effect.Effect<FetchReport, OpenError>
  /** Stores a DM-open answer through the running metadata fence. */
  readonly opened: (channel: Parameters<typeof applyOpened>[1]) => Effect.Effect<void, SqlError>
  /** Stores what Juno's own send got back, in the sync's context (`applySent`). */
  readonly sent: (sent: Parameters<typeof applySent>[1]) => Effect.Effect<void, SqlError>
  /** Stores an edit, delete or reaction Slack accepted, with `alongside` in the same transaction (`applyActed`). */
  readonly acted: (acted: Acted, alongside: Effect.Effect<unknown, SqlError, StoreWriter | Invalidation>) => Effect.Effect<void, SqlError>
}

export type SyncServices = SlackApi | SlackEdge | SlackSocket | SlackSession | StoreWriter | StoreReader | Invalidation

export const runSync = (options: RunSyncOptions): Effect.Effect<never, SlackAuthRequired, SyncServices | Scope.Scope> =>
  Effect.gen(function* () {
    const runtime = yield* makeSyncRuntime(options)
    const { ctx, background, socket } = runtime
    const fetcher = yield* makeTopicFetcher(runtime)
    if (options.onFetcher !== undefined) yield* options.onFetcher(fetcher)

    // No command is in flight before the sync runs; `follow` outbox rows are left over from a crash.
    yield* transaction(clearPendingFollows).pipe(Effect.catchCause((cause) => Effect.logError('sync: pending follows not cleared', { cause })))
    const events = yield* socket.events
    const reconcile = makeReconcile(runtime)
    const sweep = makeReconcile(runtime)
    const { reboot, bootLoop } = makeBootLoop(runtime, sweep)
    const handle = handleSocketEvent(runtime, reconcile, reboot)
    const consumer = Stream.runForEach(events, (event) => handle(event).pipe(Effect.andThen(options.onEvent?.(event, ctx.me) ?? Effect.void)))

    // Stored index rows from an older Juno take the current meaning from local messages, alongside the boot.
    const upgrade = upgradeIndex(ctx).pipe(Effect.catchCause((cause) => Effect.logError('sync: index upgrade failed', { cause })))
    yield* Effect.all([consumer, bootLoop, upgrade, watchWindow(runtime), fetchRoots(ctx), lookUpReads(ctx), refreshFiles(ctx), nameUsers(ctx), FiberSet.join(background)], { concurrency: 'unbounded', discard: true })
    return yield* Effect.never
  })
