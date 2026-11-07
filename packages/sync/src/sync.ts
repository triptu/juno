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
 * `offline` when the network failed, else at `failed` with a safe reason;
 * `force_reload` cuts that wait short, and the boot it starts otherwise
 * fails and retries the same way. A socket drop the boot could not hear is
 * caught up once the boot ends. Any other catch-up failure
 * is logged, the phase settles, and the catch-up runs again after the rate
 * limit that stopped it or after `bootRetryMillis`. A store error is a bug; it is logged per event so one bad frame does not
 * end the sync, and surfaces in the engine log.
 */
import { SlackApi, SlackAuthRequired, SlackEdge, SlackSession, SlackSocket, type SocketEvent } from '@juno/slack'
import { Invalidation, StoreReader, StoreWriter, transaction, type SqlError } from '@juno/store'
import { Effect, FiberSet, Scope, Stream } from 'effect'
import { upgradeIndex } from './upgrade'
import { applyOpened, applySent } from './events'
import type { Acted } from './acted'
import type { FetchReport, OpenError } from './open'
import { makeBootLoop } from './run/boot'
import { makeTopicFetcher } from './run/fetcher'
import { fetchRoots, lookUpConversations, lookUpReads } from './run/lookups'
import { refreshFiles } from './run/files'
import { makeReconcile } from './run/reconcile'
import { watchWindow } from './run/window'
import { makeSyncRuntime } from './run/runtime'
import { handleSocketEvent } from './run/socket'
import { nameUsers, refreshStaleUsers } from './users'
import { clearPendingFollows, endEventCoverage } from './write'
import { reindexTopics } from './reindex'
import { reindexOptions } from './context'

/** `first`: the cold boot of an empty store, the first sync the user waits through. */
export type SyncPhase =
  | { readonly _tag: 'booting'; readonly first?: boolean }
  | { readonly _tag: 'catching-up'; readonly done: number; readonly total: number; readonly first?: boolean }
  | { readonly _tag: 'live' }
  | { readonly _tag: 'offline' }
  /** A boot keeps failing for a reason other than the network, for example an answer the schema rejects. Retried like `offline`. */
  | { readonly _tag: 'failed'; readonly reason: SyncFailure }

/**
 * Why a boot failed, safe to show and copy: the error's tag, the Slack
 * method and Slack's error code or the HTTP status. Never a message or content.
 */
export interface SyncFailure {
  readonly error: string
  readonly method?: string
  readonly detail?: string
}

/** The timed steps of a sync, as the developer log shows them. */
export type SyncStepName = 'cold-boot' | 'warm-boot' | 'catch-up' | 'sweep' | 'follow-pass'

export type SyncStep =
  | { readonly name: SyncStepName; readonly event: 'started' }
  | { readonly name: SyncStepName; readonly event: 'finished' | 'failed' | 'interrupted'; readonly durationMs: number; readonly cause?: string }

export interface RunSyncOptions {
  /** Hears each step start and end. Synchronous and cheap; observation only. */
  readonly onStep?: (step: SyncStep) => void
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
 * in the background. An open's first page and a jump run on the interactive
 * lane; older and newer pages and an open's later pages on `paging`, which
 * yields to them. When Slack rate-limits the call, the same fetch is queued
 * on the background lane and the error is returned, so the caller shows
 * what the store has.
 */
export interface TopicFetcher {
  readonly open: (topicId: string) => Effect.Effect<FetchReport, OpenError>
  readonly older: (topicId: string, before: string) => Effect.Effect<FetchReport, OpenError>
  /** The replies after `after` in a thread, when the store cannot prove them (`fetchNewer`). */
  readonly newer: (topicId: string, after: string) => Effect.Effect<FetchReport, OpenError>
  /** Stores the message `ts` in full for a jump to it (`fetchAt`). Concurrent jumps to one message share the read. */
  readonly at: (topicId: string, ts: string) => Effect.Effect<FetchReport, OpenError>
  /** Stores a DM-open or channel-create answer through the running metadata fence. */
  readonly opened: (channel: Parameters<typeof applyOpened>[1]) => Effect.Effect<void, SqlError>
  /** Stores Juno's own channel rename through the running metadata fence (`applyRenamed`). False when `from` no longer matched. */
  readonly renamed: (channel: string, name: string, from?: string) => Effect.Effect<boolean, SqlError>
  /** Stores Juno's own join or leave through the running metadata fence (`applyMembership`). */
  readonly membership: (channel: string, member: boolean) => Effect.Effect<void, SqlError>
  /** Stores what Juno's own send got back, in the sync's context (`applySent`). */
  readonly sent: (sent: Parameters<typeof applySent>[1]) => Effect.Effect<void, SqlError>
  /** Stores an edit, delete, reaction or broadcast Slack accepted, with `alongside` in the same transaction (`applyActed`). */
  readonly acted: (acted: Acted, alongside: Effect.Effect<unknown, SqlError, StoreWriter | Invalidation>) => Effect.Effect<void, SqlError>
  /** Asks `nameUsers` for users the store lacks, as a page that names them would (`wantUsers`). Returns at once; the names land in `users`. */
  readonly wantUsers: (ids: ReadonlyArray<string>) => Effect.Effect<void>
  /** Asks Slack again for stored users whose object is more than a few minutes old, for their status (`refreshUsers`). Returns at once. */
  readonly refreshUsers: (ids: ReadonlyArray<string>) => Effect.Effect<void>
  /** Fetches everyone who reacted to a stored message and stores them (`whoReacted.ts`). Concurrent callers share the read. An undefined snapshot means a concurrent write superseded it; the dialog retries. Not retried on the background lane. */
  readonly reactors: (channel: string, ts: string) => Effect.Effect<string | undefined, OpenError>
  /** Reads the newest `activity.feed` page into `reaction_feed` (`reactionFeed.ts`). Concurrent callers share the read. Returns how many entries were new. */
  readonly reactionFeed: Effect.Effect<number, OpenError>
  /** Stores a Reactions row's message, and a reply's thread root, on the background lane (`fetchFeedMessage`). Fails when Slack's answer is unusable for now; a message Slack no longer has drops its row instead. */
  readonly feedMessage: (channel: string, ts: string) => Effect.Effect<void, OpenError>
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
    // Replies sent while the app was closed reached no socket: the last run's live tails end, as at a drop.
    yield* transaction(endEventCoverage.pipe(Effect.flatMap((topics) => reindexTopics(topics, reindexOptions(ctx))))).pipe(
      Effect.catchCause((cause) => Effect.logError('sync: coverage not reset', { cause })),
    )
    const events = yield* socket.events
    const reconcile = makeReconcile(runtime, 'catch-up')
    const sweep = makeReconcile(runtime, 'sweep')
    const { reboot, bootLoop } = makeBootLoop(runtime, sweep, reconcile)
    const handle = handleSocketEvent(runtime, reconcile, reboot)
    const consumer = Stream.runForEach(events, (event) => handle(event).pipe(Effect.andThen(options.onEvent?.(event, ctx.me) ?? Effect.void)))

    // Stored index rows from an older Juno take the current meaning from local messages, alongside the boot.
    const upgrade = upgradeIndex(ctx).pipe(Effect.catchCause((cause) => Effect.logError('sync: index upgrade failed', { cause })))
    yield* Effect.all([consumer, bootLoop, upgrade, watchWindow(runtime), fetchRoots(ctx), lookUpReads(ctx), lookUpConversations(ctx), refreshFiles(ctx), nameUsers(ctx), refreshStaleUsers(ctx), FiberSet.join(background)], { concurrency: 'unbounded', discard: true })
    return yield* Effect.never
  })
