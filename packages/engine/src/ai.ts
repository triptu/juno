/**
 * The `AiProvider` the engine runs (ADR 0006, architecture 10). The config
 * says which: the deterministic fake for tests and `JUNO_AI=fake`, or pi-ai
 * over OpenRouter with the key main handed over in memory (`AiCredentials`).
 * The live provider reads its config on every call, so a model slug changed
 * in preferences (`aiModels` in the open workspace's user.db) or a new key
 * applies at once. Every live call first reserves its upper cost in the
 * agent's daily cap (`AiSpend`); a key change or removal cancels calls under
 * way. `fakeAiRequiresKey` puts the fake behind the same key and cap.
 *
 * A top-level module, like `workspace.ts`: the art job uses it now and the
 * assistant features will, and feature folders do not import each other.
 */
import { Effect, Layer, Stream } from 'effect'
import { AiProvider, FakeAiProvider, PiAiProvider, type AiConfig, type Decision, type ModelPrefs } from '@juno/ai'
import { prefs } from '@juno/store'
import { EngineConfig } from './config'
import { Workspace } from './workspace'
import { AiCredentials } from './aiCredentials'
import { AiSpend } from './aiSpend'
import { HostLink } from './protocol/host'

/** The `prefs` key holding `Partial<ModelPrefs>`: the slug per tier the owner changed. */
export const AI_MODELS_PREF = 'aiModels'
/** The `prefs` key of the global AI assist switch (SPEC section 15). Absent means on. */
export const AI_ASSIST_PREF = 'aiAssist'

export const AiProviderLive: Layer.Layer<AiProvider, never, EngineConfig | Workspace | AiCredentials | AiSpend | HostLink> = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* EngineConfig
    const credentials = yield* AiCredentials
    const spend = yield* AiSpend
    const host = yield* HostLink
    const workspace = yield* Workspace
    const readConfig: Effect.Effect<AiConfig> = Effect.gen(function* () {
      const open = yield* workspace.current
      const models =
        open === undefined
          ? undefined
          : yield* prefs.get<unknown>(AI_MODELS_PREF).pipe(
              Effect.provide(open.context),
              Effect.map((value) => (typeof value === 'object' && value !== null ? (value as Partial<ModelPrefs>) : undefined)),
              Effect.catch(() => Effect.succeed(undefined)),
            )
      const apiKey = yield* credentials.key
      return { ...(apiKey === undefined ? {} : { apiKey }), ...(models === undefined ? {} : { models }), admit: spend.admit }
    })
    const gated = config.ai === 'live' || config.fakeAiRequiresKey === true
    const implementation = config.ai === 'fake'
      ? FakeAiProvider.layerWith({ delayMillis: config.fakeAiDelayMillis ?? 0, ...(gated ? { admit: () => spend.admit(0) } : {}) })
      : PiAiProvider.layer(readConfig)
    return Layer.effect(AiProvider, Effect.gen(function* () {
      const provider = yield* AiProvider
      const missing: Decision<never> = { _tag: 'NoDecision', reason: 'missing-key', meta: { model: '', latencyMillis: 0, attempts: 0 } }
      const run = <A>(task: string, request: Effect.Effect<Decision<A>>): Effect.Effect<Decision<A>> => Effect.gen(function* () {
        // Tests count the calls that reached the fake model; one the cap blocked made no attempt.
        const call = config.e2e && config.ai === 'fake'
          ? request.pipe(Effect.tap((decision) => (decision.meta.attempts > 0 ? host.send({ _tag: 'aiCall', task }) : Effect.void)))
          : request
        if (!gated) return yield* call
        const revision = yield* credentials.revision
        if (!(yield* credentials.key)) return missing
        // A replacement or removal interrupts the request, including its AbortSignal.
        const changed = credentials.revisions.pipe(Stream.filter(value => value !== revision), Stream.runHead, Effect.as(missing))
        return yield* Effect.raceFirst(call, changed)
      })
      return AiProvider.of({
        decide: (task, input) => run(task.name, provider.decide(task, input)),
        generate: (task, input) => run(task.name, provider.generate(task, input)),
      })
    })).pipe(Layer.provide(implementation))
  }),
)

/** Whether AI assist is on in the open workspace. Reads the pref on the given store context. */
export const aiAssistOn = prefs.get<unknown>(AI_ASSIST_PREF).pipe(
  Effect.map((value) => value !== false),
  Effect.catch(() => Effect.succeed(true)),
)
