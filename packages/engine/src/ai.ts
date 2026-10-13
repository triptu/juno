/**
 * The `AiProvider` the engine runs (ADR 0006, architecture 10). The config
 * says which: the deterministic fake for tests and `JUNO_AI=fake`, or pi-ai
 * over OpenRouter with the key main handed over in memory. The live
 * provider reads its config on every call, so a model slug changed in
 * preferences (`aiModels` in the open workspace's user.db) applies at once.
 *
 * A top-level module, like `workspace.ts`: the art job uses it now and the
 * assistant features will, and feature folders do not import each other.
 */
import { Effect, Layer } from 'effect'
import { AiProvider, FakeAiProvider, PiAiProvider, type AiConfig, type ModelPrefs } from '@juno/ai'
import { prefs } from '@juno/store'
import { EngineConfig } from './config'
import { Workspace } from './workspace'

/** The `prefs` key holding `Partial<ModelPrefs>`: the slug per tier the owner changed. */
export const AI_MODELS_PREF = 'aiModels'
/** The `prefs` key of the global AI assist switch (SPEC section 15). Absent means on. */
export const AI_ASSIST_PREF = 'aiAssist'

export const AiProviderLive: Layer.Layer<AiProvider, never, EngineConfig | Workspace> = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* EngineConfig
    if (config.ai === 'fake') return FakeAiProvider.layer
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
      return { ...(config.openRouterApiKey === undefined ? {} : { apiKey: config.openRouterApiKey }), ...(models === undefined ? {} : { models }) }
    })
    return PiAiProvider.layer(readConfig)
  }),
)

/** Whether AI assist is on in the open workspace. Reads the pref on the given store context. */
export const aiAssistOn = prefs.get<unknown>(AI_ASSIST_PREF).pipe(
  Effect.map((value) => value !== false),
  Effect.catch(() => Effect.succeed(true)),
)
