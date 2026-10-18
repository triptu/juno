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
 * (`AiAudit`) with what it was for (`AiPurpose`), never its text; a call a
 * fallback model answered is two rows, the main model's failure and the
 * fallback's answer. An input a model refused for good (`isFinal`) is kept in
 * `ai_refusals` and not sent again until it changes: the same task, key and
 * input hash get that refusal back at once, with no call and no row.
 *
 * A top-level module, like `workspace.ts`: the art job uses it now and the
 * assistant features will, and feature folders do not import each other.
 */
import { Clock, Context, Effect, Exit, Layer, Stream } from 'effect'
import type { HostAiCall } from '@juno/agent-contract'
import { AiProvider, cacheKeyOf, FAKE_MODEL, FakeAiProvider, fallbackFor, isFinal, modelFor, PiAiProvider, type AiConfig, type AiFailureKind, type Decision, type ModelPrefs, type Task, type Tier } from '@juno/ai'
import { parseTopicId } from '@juno/domain'
import { prefs, StoreReader, StoreWriter, transaction, type Invalidation } from '@juno/store'
import { EngineConfig } from './config'
import { Workspace } from './workspace'
import { AiCredentials } from './aiCredentials'
import { AiBackground, AiSpend } from './aiSpend'
import { AiAudit } from './aiAudit'
import { AiFallback } from './aiFallback'
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
  if (task === 'grammarCheck' && typeof value === 'object' && value !== null && 'edits' in value && Array.isArray(value.edits)) {
    return value.edits.length === 0 ? 'No fixes' : `${value.edits.length} ${value.edits.length === 1 ? 'fix' : 'fixes'}`
  }
  if (typeof value === 'object' && value !== null) return `answer with ${Object.keys(value).join(', ')}`.slice(0, 80)
  return ''
}

/** The log's outcome for a decision: blocked when nothing was sent, else what came back. An answer from the fallback model is `ok` of kind `fallback`. */
const outcomeOf = (decision: Decision<unknown>): Pick<HostAiCall, 'outcome' | 'kind' | 'message'> => {
  if (decision._tag === 'Decided') return { outcome: 'ok', kind: decision.meta.fallbackFor === undefined ? '' : 'fallback', message: '' }
  switch (decision.reason) {
    case 'missing-key':
      return { outcome: 'blocked', kind: 'no-key', message: '' }
    case 'budget':
      return { outcome: 'blocked', kind: decision.detail ?? 'cap', message: '' }
    case 'timeout':
      return { outcome: 'timeout', kind: 'timeout', message: '' }
    case 'provider-error':
      return { outcome: 'error', kind: decision.kind ?? decision.reason, message: decision.detail ?? '' }
    default:
      return { outcome: 'error', kind: decision.reason, message: decision.detail ?? '' }
  }
}

/** What the log and the refusal record need of a task. */
interface TaskInfo {
  readonly name: string
  readonly version: number
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
      // The main model's failure, before the fallback that answered it: its own row, newest below the fallback's.
      const failed = meta.fallbackFor
      if (failed !== undefined) {
        yield* audit.record({
          ...base,
          durationMs: failed.meta.latencyMillis,
          model: failed.meta.model,
          outcome: 'error',
          kind: `${failed.kind}.fallback`,
          message: failed.detail ?? '',
          inputTokens: failed.meta.inputTokens ?? null,
          outputTokens: failed.meta.outputTokens ?? null,
          costUsd: failed.meta.costUsd ?? null,
          summary: '',
        })
      }
      yield* audit.record({
        ...base,
        ...(failed === undefined ? {} : { at: base.at + failed.meta.latencyMillis, durationMs: Math.max(0, durationMs - failed.meta.latencyMillis) }),
        model,
        ...outcomeOf(decision),
        inputTokens: meta.inputTokens ?? null,
        outputTokens: meta.outputTokens ?? null,
        costUsd: meta.costUsd ?? null,
        summary: decision._tag === 'Decided' ? summaryOf(task.name, decision.value) : '',
      })
      return decision
    }).pipe(Effect.uninterruptible)

/** The refusal kept for a task's key, if any (`ai_refusals`). */
interface Refusal {
  readonly input_hash: string
  readonly kind: string
}

/**
 * The refused inputs of the open workspace. Reads and writes that fail, or
 * run with no workspace open, do nothing: at worst an input is sent again.
 */
const refusalsOf = (workspace: Workspace['Service']) => {
  const inOpen = <A>(effect: Effect.Effect<A, unknown, StoreReader | StoreWriter | Invalidation>, otherwise: A): Effect.Effect<A> => Effect.gen(function* () {
    const open = yield* workspace.current
    if (open === undefined) return otherwise
    return yield* effect.pipe(Effect.provide(open.context), Effect.catch(() => Effect.succeed(otherwise)))
  })
  return {
    find: (task: string, key: string) => inOpen(Effect.gen(function* () {
      const sql = yield* StoreReader
      return (yield* sql<Refusal>`SELECT input_hash, kind FROM ai_refusals WHERE task = ${task} AND key = ${key}`)[0]
    }), undefined),
    remember: (task: string, key: string, hash: string, kind: AiFailureKind, at: number) => inOpen(transaction(Effect.gen(function* () {
      const sql = yield* StoreWriter
      yield* sql`INSERT INTO ai_refusals (task, key, input_hash, kind, at) VALUES (${task}, ${key}, ${hash}, ${kind}, ${at})
        ON CONFLICT (task, key) DO UPDATE SET input_hash = excluded.input_hash, kind = excluded.kind, at = excluded.at`
    })), undefined),
    forget: (task: string, key: string) => inOpen(transaction(Effect.gen(function* () {
      const sql = yield* StoreWriter
      yield* sql`DELETE FROM ai_refusals WHERE task = ${task} AND key = ${key}`
    })), undefined),
  }
}

/** The answer for an input refused before: the same refusal, with no call made. */
const refusedBefore = (refusal: Refusal): Decision<never> => ({
  _tag: 'NoDecision',
  reason: 'provider-error',
  kind: refusal.kind as AiFailureKind,
  detail: 'refused before; not sent again until the input changes',
  meta: { model: '', latencyMillis: 0, attempts: 0 },
})

export const AiProviderLive: Layer.Layer<AiProvider, never, EngineConfig | Workspace | AiCredentials | AiSpend | AiAudit | AiFallback | HostLink> = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* EngineConfig
    const audit = yield* AiAudit
    const credentials = yield* AiCredentials
    const spend = yield* AiSpend
    const host = yield* HostLink
    const workspace = yield* Workspace
    const fallback = yield* AiFallback
    const refusals = refusalsOf(workspace)
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
      // The agent's word on the fallback (Settings › Juno) wins over a slug in the preference.
      const chosen = yield* fallback.current
      const all = chosen === undefined ? models : { ...models, fallback: chosen }
      return { ...(apiKey === undefined ? {} : { apiKey }), ...(all === undefined ? {} : { models: all }), admit: spend.admit }
    })
    const gated = config.ai === 'live' || config.fakeAiRequiresKey === true
    const implementation = config.ai === 'fake'
      ? FakeAiProvider.layerWith({
          delayMillis: config.fakeAiDelayMillis ?? 0,
          ...(gated ? { admit: spend.admit } : {}),
          fallback: readConfig.pipe(Effect.map((current) => fallbackFor(current, FAKE_MODEL))),
        })
      : PiAiProvider.layer(readConfig)
    return Layer.effect(AiProvider, Effect.gen(function* () {
      const provider = yield* AiProvider
      const providerName = config.ai === 'fake' ? 'fake' : 'openrouter'
      const modelOf = (tier: Tier): Effect.Effect<string> =>
        config.ai === 'fake' ? Effect.succeed(FAKE_MODEL) : readConfig.pipe(Effect.map((current) => modelFor(tier, current)))
      const logged = audited(audit, providerName, modelOf)
      /** Sends the input unless it was refused for good before; keeps a new final refusal, and forgets one after an answer. */
      const remembered = <A>(task: TaskInfo, input: unknown, request: Effect.Effect<Decision<A>>): Effect.Effect<Decision<A>> => Effect.gen(function* () {
        const key = task.key(input as never)
        const hash = cacheKeyOf(task as Task, input).inputHash
        const known = yield* refusals.find(task.name, key)
        if (known !== undefined && known.input_hash === hash) return refusedBefore(known) as Decision<A>
        const decision = yield* request
        if (decision._tag === 'NoDecision' && decision.kind !== undefined && decision.meta.attempts > 0 && isFinal(decision)) {
          yield* refusals.remember(task.name, key, hash, decision.kind, yield* Clock.currentTimeMillis)
        } else if (decision._tag === 'Decided' && known !== undefined) yield* refusals.forget(task.name, key)
        return decision
      })
      const run = <A>(task: TaskInfo, input: unknown, request: Effect.Effect<Decision<A>>): Effect.Effect<Decision<A>> => remembered(task, input, logged(task, input, Effect.gen(function* () {
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
      })))
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
