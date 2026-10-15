import { Effect, Layer, Stream } from 'effect'
import { keys, liveQuery } from '@juno/store'
import { aiAssistOn } from './ai'
import { EngineConfig } from './config'
import { HostLink } from './protocol/host'
import { Workspace } from './workspace'

/** One unbilled request in the decision process, after the window has painted. */
export const AiWarmup = Layer.effectDiscard(Effect.gen(function* () {
  const config = yield* EngineConfig
  if (config.ai === 'fake' || !config.openRouterApiKey) return
  const workspace = yield* Workspace
  const host = yield* HostLink
  let painted = false
  let enabled = false
  let warmed = false
  const warm = Effect.suspend(() => {
    if (!painted || !enabled || warmed) return Effect.void
    warmed = true
    return Effect.tryPromise(async (signal) => {
      const response = await fetch('https://openrouter.ai/api/v1/models', { method: 'HEAD', signal })
      await response.body?.cancel()
    }).pipe(Effect.timeoutOption('5 seconds'), Effect.ignore)
  })
  const messages = yield* host.messages
  yield* Effect.forkScoped(Stream.runForEach(messages, message => {
    if (message._tag !== 'painted') return Effect.void
    painted = true
    return warm
  }))
  yield* Effect.forkScoped(workspace.changes.pipe(
    Stream.switchMap(open => open === undefined ? Stream.succeed(false) : liveQuery(keys.prefs, aiAssistOn).pipe(Stream.map(result => result._tag === 'Success' && result.success), Stream.provide(open.context))),
    Stream.runForEach(on => {
      enabled = on
      return warm
    }),
  ))
}))
