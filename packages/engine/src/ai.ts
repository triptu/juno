/**
 * The `AiProvider` the engine runs (ADR 0006, architecture 10). The config
 * says which: the deterministic fake for tests and `JUNO_AI=fake`, or pi-ai
 * over OpenRouter with the key main handed over in memory (`AiCredentials`).
 * The live provider reads its config on every call, so a model slug changed
 * in preferences (`aiModels` in the open workspace's user.db) or a new key
 * applies at once. Every live call first reserves its upper cost in the
 * agent's daily cap (`AiSpend`); a key change or removal cancels calls under
 * way. `fakeAiRequiresKey` puts the fake behind the same key and cap.
 * Every call, and every one refused, goes to the AI activity log
 * (`AiAudit`) with what it was for (`AiPurpose`), never its text.
 *
 * A top-level module, like `workspace.ts`: the art job uses it now and the
 * assistant features will, and feature folders do not import each other.
 */
import { Clock, Context, Effect, Exit, Layer, Stream } from 'effect'
import type { HostAiCall } from '@juno/agent-contract'
import { AiProvider, FAKE_MODEL, FakeAiProvider, modelFor, PiAiProvider, type AiConfig, type Decision, type ModelPrefs, type Tier } from '@juno/ai'
import { parseTopicId } from '@juno/domain'
import { prefs } from '@juno/store'
import { EngineConfig } from './config'
import { Workspace } from './workspace'
import { AiCredentials } from './aiCredentials'
import { AiBackground, AiSpend } from './aiSpend'
import { AiAudit } from './aiAudit'
import { HostLink } from './protocol/host'

/** The `prefs` key holding `Partial<ModelPrefs>`: the slug per tier the owner changed. */
export const AI_MODELS_PREF = 'aiModels'
/** The `prefs` key of the global AI assist switch (SPEC section 15). Absent means on. */
export const AI_ASSIST_PREF = 'aiAssist'

/**
 * What a call is for, when the task's name does not say it all: Redraw sets
 * `topicArt.redraw` around its call so the log tells it from the job's.
 */
export const AiPurpose = Context.Reference<string | undefined>('juno/engine/AiPurpose', { defaultValue: () => undefined })

/** A short shape of an answer for the log: never its words. */
const summaryOf = (task: string, value: unknown): string => {
  if (typeof value === 'string') {
    if (task === 'topicArt') return `drawing, ${value.length} characters`
    const words = value.trim().split(/\s+/).filter((word) => word !== '').length
    return `${task === 'titleTopic' || task === 'homeTitle' ? 'title' : 'text'}, ${words} ${words === 1 ? 'word' : 'words'}`
  }
  if (typeof value === 'object' && value !== null) return `answer with ${Object.keys(value).join(', ')}`.slice(0, 80)
  return ''
}

/** The log's outcome for a decision: blocked when nothing was sent, else what came back. */
const outcomeOf = (decision: Decision<unknown>): Pick<HostAiCall, 'outcome' | 'kind' | 'message'> => {
  if (decision._tag === 'Decided') return { outcome: 'ok', kind: '', message: '' }
  switch (decision.reason) {
    case 'missing-key':
      return { outcome: 'blocked', kind: 'no-key', message: '' }
    case 'budget':
      return { outcome: 'blocked', kind: decision.detail ?? 'cap', message: '' }
    case 'timeout':
      return { outcome: 'timeout', kind: 'timeout', message: '' }
    default:
      return { outcome: 'error', kind: decision.reason, message: decision.detail ?? '' }
  }
}

/** What the log needs of a task. */
interface TaskInfo {
  readonly name: string
  readonly tier: Tier
  readonly key: (input: never) => string
}

const subjectOf = (key: string): Pick<HostAiCall, 'subjectKind' | 'subjectId'> =>
  key === '' ? { subjectKind: '', subjectId: '' } : { subjectKind: parseTopicId(key) === undefined ? 'channel' : 'topic', subjectId: key }

/** Tasks that are always backlog work for the spend cap (`AiBackground`). Grammar starts on typing pauses, most never sent. */
const BACKGROUND_TASKS = new Set(['settledScore', 'followUps', 'homeTitle', 'automatedChannel', 'grammarCheck'])

const MISSING: Decision<never> = { _tag: 'NoDecision', reason: 'missing-key', meta: { model: '', latencyMillis: 0, attempts: 0 } }
/** A key change cut the call short: to the job it is `missing-key`, to the log it was cancelled. */
const KEY_CHANGED: Decision<never> = { _tag: 'NoDecision', reason: 'missing-key', meta: { model: '', latencyMillis: 0, attempts: 0 } }

/**
 * Runs a call and logs it however it ends. The record goes on the log's
 * queue after the answer is back, so it never holds the call up.
 */
const audited = (audit: AiAudit['Service'], provider: string, modelOf: (tier: Tier) => Effect.Effect<string>) =>
  <A>(task: TaskInfo, input: unknown, request: Effect.Effect<Decision<A>>): Effect.Effect<Decision<A>> =>
    Effect.gen(function* () {
      const at = yield* Clock.currentTimeMillis
      const exit = yield* Effect.exit(Effect.interruptible(request))
      const durationMs = (yield* Clock.currentTimeMillis) - at
      const base = { at, feature: (yield* AiPurpose) ?? task.name, ...subjectOf(task.key(input as never)), provider, durationMs }
      const empty = { inputTokens: null, outputTokens: null, costUsd: null, summary: '' }
      if (Exit.isFailure(exit)) {
        yield* audit.record({ ...base, model: yield* modelOf(task.tier), outcome: 'cancelled', kind: 'stopped', message: '', ...empty })
        return yield* exit
      }
      const decision = exit.value
      const meta = decision.meta
      const model = meta.model === '' ? yield* modelOf(task.tier) : meta.model
      if (decision === KEY_CHANGED) {
        yield* audit.record({ ...base, model, outcome: 'cancelled', kind: 'key-changed', message: '', ...empty })
        return MISSING as Decision<A>
      }
      yield* audit.record({
        ...base,
        model,
        ...outcomeOf(decision),
        inputTokens: meta.inputTokens ?? null,
        outputTokens: meta.outputTokens ?? null,
        costUsd: meta.costUsd ?? null,
        summary: decision._tag === 'Decided' ? summaryOf(task.name, decision.value) : '',
      })
      return decision
    }).pipe(Effect.uninterruptible)

export const AiProviderLive: Layer.Layer<AiProvider, never, EngineConfig | Workspace | AiCredentials | AiSpend | AiAudit | HostLink> = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* EngineConfig
    const audit = yield* AiAudit
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
      ? FakeAiProvider.layerWith({ delayMillis: config.fakeAiDelayMillis ?? 0, ...(gated ? { admit: spend.admit } : {}) })
      : PiAiProvider.layer(readConfig)
    return Layer.effect(AiProvider, Effect.gen(function* () {
      const provider = yield* AiProvider
      const providerName = config.ai === 'fake' ? 'fake' : 'openrouter'
      const modelOf = (tier: Tier): Effect.Effect<string> =>
        config.ai === 'fake' ? Effect.succeed(FAKE_MODEL) : readConfig.pipe(Effect.map((current) => modelFor(tier, current)))
      const logged = audited(audit, providerName, modelOf)
      const run = <A>(task: TaskInfo, input: unknown, request: Effect.Effect<Decision<A>>): Effect.Effect<Decision<A>> => logged(task, input, Effect.gen(function* () {
        // Home's tasks are backlog work; the art job says per topic.
        const asked = BACKGROUND_TASKS.has(task.name) ? request.pipe(Effect.provideService(AiBackground, true)) : request
        // Tests count the calls that reached the fake model; one the cap blocked made no attempt.
        const call = config.e2e && config.ai === 'fake'
          ? asked.pipe(Effect.tap((decision) => (decision.meta.attempts > 0 ? host.send({ _tag: 'aiCall', task: task.name }) : Effect.void)))
          : asked
        if (!gated) return yield* call
        const revision = yield* credentials.revision
        if (!(yield* credentials.key)) return MISSING
        // A replacement or removal interrupts the request, including its AbortSignal.
        const changed = credentials.revisions.pipe(Stream.filter(value => value !== revision), Stream.runHead, Effect.as(KEY_CHANGED))
        return yield* Effect.raceFirst(call, changed)
      }))
      return AiProvider.of({
        decide: (task, input) => run(task, input, provider.decide(task, input)),
        generate: (task, input) => run(task, input, provider.generate(task, input)),
      })
    })).pipe(Layer.provide(implementation))
  }),
)

/** Whether AI assist is on in the open workspace. Reads the pref on the given store context. */
export const aiAssistOn = prefs.get<unknown>(AI_ASSIST_PREF).pipe(
  Effect.map((value) => value !== false),
  Effect.catch(() => Effect.succeed(true)),
)

/** Whether the background AI jobs may call the model: always in the app; tests turn them off with `aiJobs: false` unless they opt in. */
export const aiJobsOn = Effect.gen(function* () {
  return (yield* EngineConfig).aiJobs !== false
})

/** Availability for decision features, independent of the saved AI assist switch: a key, unless the fake runs ungated. */
export const decisionProviderAvailable = Effect.gen(function* () {
  const config = yield* EngineConfig
  if (config.ai === 'fake' && config.fakeAiRequiresKey !== true) return true
  return (yield* (yield* AiCredentials).key) !== undefined
})
