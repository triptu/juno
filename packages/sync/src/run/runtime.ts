import { quietDaysOf } from '@juno/domain'
import { prefs } from '@juno/store'
import { SlackAuthRequired, SlackSession, SlackSocket } from '@juno/slack'
import { Cause, Deferred, Effect, Exit, FiberSet, Queue, Semaphore } from 'effect'
import type { BootState, Phase } from '../boot'
import { makeMarkerCandidates } from '../markerCandidates'
import { SyncConfig } from '../config'
import type { FileFetch, RootFetch, SyncContext } from '../context'
import { syncEmoji } from '../emoji'
import { syncUsergroups } from '../usergroups'

import type { RunSyncOptions, SyncStepName } from '../sync'

export const isNotAuth = <E extends { readonly _tag: string }>(error: E): error is Exclude<E, SlackAuthRequired> => error._tag !== 'SlackAuthRequired'

/** A failure as one short line: the error's tag and code or message. */
const causeLine = (cause: Cause.Cause<unknown>): string => {
  const found = Cause.findErrorOption(cause)
  if (found._tag === 'None') return 'defect'
  const error = found.value as { readonly _tag?: unknown; readonly error?: unknown; readonly message?: unknown }
  const detail = typeof error.error === 'string' ? error.error : typeof error.message === 'string' ? error.message : ''
  return [typeof error._tag === 'string' ? error._tag : 'Error', detail].filter((part) => part !== '').join(': ')
}

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
    conversationLookups: yield* Queue.unbounded<string>(),
    fileFetches: yield* Queue.unbounded<FileFetch>(),
    missingUsers: new Map(),
    usersWanted: yield* Queue.sliding<void>(1),
    usersOnBackground: false,
    onSelfPresence: options.onSelfPresence ?? (() => Effect.void),
    onHistory: options.onHistory ?? (() => Effect.void),
    onListed: options.onListed ?? Effect.void,
    unknownUsers: new Set(),
    usergroupTopics: new Set(),
    photoless: new Set(),
    lateReactions: new Map(),
    fetchesInFlight: new Set(),
    usersInFlight: new Map(),
    metadata: new Set(),
    socket: { connected: false, epoch: 0 },
    liveRoots: new Set(),
  }
  const state = {
    bootRetry: undefined as Deferred.Deferred<void> | undefined,
    connected: false,
    markerCandidates: makeMarkerCandidates(),
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
  /** Tells `onStep` when `effect` starts and how it ended. */
  const step = <A, E, R>(name: SyncStepName, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => {
    const onStep = options.onStep
    if (onStep === undefined) return effect
    return Effect.suspend(() => {
      const start = performance.now()
      onStep({ name, event: 'started' })
      return effect.pipe(Effect.onExit((exit) => Effect.sync(() => {
        const durationMs = performance.now() - start
        if (Exit.isSuccess(exit)) onStep({ name, event: 'finished', durationMs })
        else if (Cause.hasInterruptsOnly(exit.cause)) onStep({ name, event: 'interrupted', durationMs })
        else onStep({ name, event: 'failed', durationMs, cause: causeLine(exit.cause) })
      })))
    })
  }
  const settle = () => phase(state.connected ? { _tag: 'live' } : { _tag: 'offline' })
  // Each says whether it finished; a failure other than an expired session is logged.
  const refreshEmoji = syncEmoji().pipe(
    Effect.as(true),
    Effect.catchIf(isNotAuth, (error) => Effect.as(Effect.logWarning('sync: emoji refresh failed', { cause: error }), false)),
  )
  const refreshUsergroups = syncUsergroups(ctx).pipe(
    Effect.as(true),
    Effect.catchIf(isNotAuth, (error) => Effect.as(Effect.logWarning('sync: user groups refresh failed', { cause: error }), false)),
  )
  const reportBoot: Phase = phase
  // Catch-ups and reboots run in the background; joining the set below is what lets their auth failures end the sync.
  const background = yield* FiberSet.make<void, SlackAuthRequired>()
  return { socket, ctx, state, work, phase, cycle, step, settle, refreshEmoji, refreshUsergroups, reportBoot, background, config, options }
})

export type SyncRuntime = Effect.Success<ReturnType<typeof makeSyncRuntime>>
