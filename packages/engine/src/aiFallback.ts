/**
 * The fallback model the engine's calls use when the main model refuses a
 * request under its policy or is unavailable (`@juno/ai` `fallbackFor`). The
 * owner picks it in Settings › Juno, which the agent serves, so the agent
 * says which slug it resolved to over `host.ai.fallback`, at start and on
 * every change; '' is none. Until it does, the default in `defaultModelPrefs`
 * applies.
 */
import { Context, Effect, Layer, Ref } from 'effect'

export class AiFallback extends Context.Service<AiFallback, {
  /** The slug the agent sent, '' for none, or undefined before it sent one. */
  readonly current: Effect.Effect<string | undefined>
  readonly set: (model: string) => Effect.Effect<void>
}>()('juno/engine/AiFallback') {
  static readonly layer = Layer.effect(AiFallback, Effect.gen(function* () {
    const slug = yield* Ref.make<string | undefined>(undefined)
    return AiFallback.of({ current: Ref.get(slug), set: (model) => Ref.set(slug, model.trim()) })
  }))
}
