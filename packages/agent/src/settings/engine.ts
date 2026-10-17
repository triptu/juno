/**
 * Tells the host which fallback model the engine's AI jobs ask
 * (`host.ai.fallback`): the slug Settings › Juno resolves to, or '' for none.
 * Sent on every change of the page and every presence the host sends, which
 * follows each new host port, so an engine that restarted hears it again.
 * A lost port is followed again after a second, for as long as the agent runs.
 */
import { Effect, Queue, Stream } from 'effect'
import { AgentHost } from '../host/client'
import type { ModelPicker } from '../providers/picker'
import type { Store } from '../store/store'
import type { JunoSettings } from './settings'
import { fallbackSlug } from './store'

export const tellFallback = (settings: JunoSettings, store: Store, picker: ModelPicker, presence: Stream.Stream<unknown>): Effect.Effect<void, never, AgentHost> =>
  Effect.gen(function* () {
    const client = yield* AgentHost
    const changes = Stream.callback<void>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => settings.subscribe(() => void Queue.offerUnsafe(queue, undefined))),
        (unsubscribe) => Effect.sync(unsubscribe),
      ),
    )
    yield* Stream.merge(changes, presence).pipe(
      Stream.map(() => fallbackSlug(store, picker)),
      Stream.buffer({ capacity: 1, strategy: 'sliding' }),
      Stream.runForEach((model) => client['host.ai.fallback']({ model })),
    )
  }).pipe(Effect.ignore, Effect.andThen(Effect.sleep('1 second')), Effect.forever)
