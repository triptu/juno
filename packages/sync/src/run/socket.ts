import { SlackAuthRequired, type SocketEvent } from '@juno/slack'
import { transaction } from '@juno/store'
import { Clock, Deferred, Effect, FiberSet, Scope } from 'effect'
import { applyFrame } from '../events'
import { endEventCoverage } from '../write'
import { reindexOptions } from '../context'
import { reindexTopics } from '../reindex'

import type { SyncServices } from '../sync'
import type { SyncRuntime } from './runtime'

export const handleSocketEvent = (runtime: SyncRuntime, reconcile: Effect.Effect<void, SlackAuthRequired, SyncServices | Scope.Scope>, reboot: Effect.Effect<void, SlackAuthRequired, SyncServices | Scope.Scope>) => {
  const { state, ctx, options, background, phase } = runtime
  return (event: SocketEvent): Effect.Effect<void, never, SyncServices | Scope.Scope> => {
    switch (event._tag) {
      case 'Connected':
        state.connected = true
        return (options.onConnection?.(true) ?? Effect.void).pipe(
          Effect.andThen(state.booted ? FiberSet.run(background, reconcile).pipe(Effect.asVoid) : Effect.void),
        )
      case 'Disconnected':
        state.connected = false
        state.markerCandidates.drop()
        if (!state.booted) return options.onConnection?.(false) ?? Effect.void
        return Clock.currentTimeMillis.pipe(
          Effect.tap((now) => Effect.sync(() => { state.droppedAt ??= now })),
          Effect.andThen(options.onConnection?.(false) ?? Effect.void),
          Effect.andThen(transaction(endEventCoverage.pipe(Effect.flatMap((topics) => reindexTopics(topics, reindexOptions(ctx)))))),
          Effect.catchCause((cause) => Effect.logError('sync: coverage not reset', { cause })),
          Effect.andThen(phase({ _tag: 'offline' })),
        )
      case 'Frame':
        if (event.frame.type === 'pong') state.markerCandidates.pong(event.receivedAt)
        if (event.frame.type === 'force_reload') {
          if (state.bootRetry !== undefined) return Deferred.succeed(state.bootRetry, undefined).pipe(Effect.asVoid)
          return FiberSet.run(background, reboot).pipe(Effect.asVoid)
        }
        return applyFrame(ctx, event.frame).pipe(
          Effect.catchCause((cause) => {
            state.markerCandidates.failed(event.frame)
            return Effect.logError('sync: event not applied', { type: event.frame.type, cause })
          }),
        )
    }
  }

}
