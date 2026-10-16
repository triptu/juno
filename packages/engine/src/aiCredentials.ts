/** OpenRouter credentials live only in memory. Revisions wake jobs without exposing the key. */
import { Context, Effect, Layer, Stream, SubscriptionRef } from 'effect'
import { EngineConfig } from './config'
import { HostLink } from './protocol/host'

export class AiCredentials extends Context.Service<AiCredentials, {
  readonly key: Effect.Effect<string | undefined>
  readonly revisions: Stream.Stream<number>
  readonly revision: Effect.Effect<number>
}>()('juno/engine/AiCredentials') {
  static readonly layer = Layer.effect(AiCredentials, Effect.gen(function* () {
    const config = yield* EngineConfig
    const host = yield* HostLink
    let key = config.openRouterApiKey
    const revision = yield* SubscriptionRef.make(0)
    const messages = yield* host.messages
    yield* Effect.forkScoped(Stream.runForEach(messages, message => {
      if (message._tag !== 'aiKey') return Effect.void
      const next = message.key?.trim() || undefined
      if (next === key) return Effect.void
      key = next
      return SubscriptionRef.update(revision, value => value + 1)
    }))
    return {
      key: Effect.sync(() => key),
      revision: SubscriptionRef.get(revision),
      revisions: SubscriptionRef.changes(revision),
    }
  }))
}
