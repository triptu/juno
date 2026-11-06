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
        ctx.socket.connected = true
        return Clock.currentTimeMillis.pipe(
          Effect.tap((now) => Effect.sync(() => { ctx.socket.since ??= now })),
          Effect.andThen(options.onConnection?.(true) ?? Effect.void),
          Effect.andThen(state.booted ? FiberSet.run(background, reconcile).pipe(Effect.asVoid) : Effect.void),
        )
      case 'Disconnected': {
        // The socket also says so after an attempt that never connected: only a drop opens a gap.
        const dropped = state.connected
        state.connected = false
        // Before anything yields: a page that lands from now on cannot write a live tail.
        ctx.socket.connected = false
        ctx.socket.since = undefined
        ctx.socket.epoch += 1
        ctx.liveRoots.clear()
        state.markerCandidates.drop()
        const ended = transaction(endEventCoverage.pipe(Effect.flatMap((topics) => reindexTopics(topics, reindexOptions(ctx))))).pipe(
          Effect.catchCause((cause) => Effect.logError('sync: coverage not reset', { cause })),
        )
        // The gap is kept until a catch-up rechecks it; during a boot that is the catch-up the boot runs once it ends.
        return Clock.currentTimeMillis.pipe(
          Effect.tap((now) => Effect.sync(() => { if (dropped) state.droppedAt ??= now })),
          Effect.andThen(options.onConnection?.(false) ?? Effect.void),
          Effect.andThen(ended),
          Effect.andThen(state.booted ? phase({ _tag: 'offline' }) : Effect.void),
        )
      }
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
