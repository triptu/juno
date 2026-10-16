import { quietDaysOf } from '@juno/domain'
import { prefs } from '@juno/store'
import { SlackAuthRequired, SlackSession, SlackSocket } from '@juno/slack'
import { Deferred, Effect, FiberSet, Queue, Semaphore } from 'effect'
import type { BootState, Phase } from '../boot'
import { SyncConfig } from '../config'
import type { FileFetch, RootFetch, SyncContext } from '../context'
import { syncEmoji } from '../emoji'
import { syncUsergroups } from '../usergroups'

import type { RunSyncOptions } from '../sync'

export const isNotAuth = <E extends { readonly _tag: string }>(error: E): error is Exclude<E, SlackAuthRequired> => error._tag !== 'SlackAuthRequired'

export const makeSyncRuntime = (options: RunSyncOptions) => Effect.gen(function* () {
  const config = yield* SyncConfig
  const saved = yield* prefs.get<unknown>('quietDays').pipe(Effect.orDie)
  const quietDays = quietDaysOf({ now: 0, quietDays: typeof saved === 'number' ? saved : config.quietDays })
  const session = yield* SlackSession
  const socket = yield* SlackSocket
  const ctx: SyncContext = {
    me: { userId: session.userId as SyncContext['me']['userId'] },
    config: { ...config, quietDays },
    rootFetches: yield* Queue.unbounded<RootFetch>(),
    readLookups: yield* Queue.unbounded<string>(),
    fileFetches: yield* Queue.unbounded<FileFetch>(),
    missingUsers: new Map(),
    usersWanted: yield* Queue.sliding<void>(1),
    usersOnBackground: false,
    onSelfPresence: options.onSelfPresence ?? (() => Effect.void),
    onHistory: options.onHistory ?? (() => Effect.void),
    unknownUsers: new Set(),
    usergroupTopics: new Set(),
    photoless: new Set(),
    lateReactions: new Map(),
    fetchesInFlight: new Set(),
    metadata: new Set(),
  }
  const state = {
    bootRetry: undefined as Deferred.Deferred<void> | undefined,
    connected: false,
    booted: false,
    lastBoot: undefined as BootState | undefined,
    lastFollowPass: undefined as number | undefined,
    /** When the socket dropped, until a catch-up has rechecked the gap. */
    droppedAt: undefined as number | undefined,
  }
  const work = yield* Semaphore.make(1)
  const phase = options.onPhase
  const cycle = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    (options.onCycle?.('started') ?? Effect.void).pipe(
      Effect.andThen(effect),
      Effect.ensuring(options.onCycle?.('finished') ?? Effect.void),
    )
  const settle = () => phase(state.connected ? { _tag: 'live' } : { _tag: 'offline' })
  const refreshEmoji = syncEmoji().pipe(Effect.catchIf(isNotAuth, (error) => Effect.logWarning('sync: emoji refresh failed', { tag: error._tag })))
  const refreshUsergroups = syncUsergroups(ctx).pipe(Effect.catchIf(isNotAuth, (error) => Effect.logWarning('sync: user groups refresh failed', { tag: error._tag })))
  const reportBoot: Phase = phase
  // Catch-ups and reboots run in the background; joining the set below is what lets their auth failures end the sync.
  const background = yield* FiberSet.make<void, SlackAuthRequired>()
  return { socket, ctx, state, work, phase, cycle, settle, refreshEmoji, refreshUsergroups, reportBoot, background, config, options }
})

export type SyncRuntime = Effect.Success<ReturnType<typeof makeSyncRuntime>>
