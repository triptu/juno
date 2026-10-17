/**
 * The deterministic provider for tests and `JUNO_AI=fake`: word rules per
 * task. Outputs pass the same validation as the
 * real provider's, so a broken rule shows up as no decision, never as a crash.
 * `delayMillis` makes every answer that late, and like the real provider it
 * gives up at the task's timeout, so tests can watch a slow model.
 * Input that holds `::refuse::` is refused under the model's policy, as a
 * live model may refuse it; the `fallback` model then answers it, except for
 * art, which the live provider does not send to a fallback either.
 */
import type { Static, TSchema } from '@earendil-works/pi-ai'
import { Effect, Layer } from 'effect'
import { modelMaker } from '@juno/ai-failure'
import type { Admission, Tier } from '../config'
import { MAX_TOKENS, upperUsd } from '../pi/provider'
import { AiProvider, type AiCallMeta, type AiProviderShape, type Decision } from '../provider'
import { cleanText, validateOutput, type StructuredTask, type TextTask } from '../task'
import type { TitleTopicInput } from '../tasks/titleTopic'
import type { TopicArtInput } from '../tasks/topicArt'
import { fakeGrammarCheck } from './grammar'
import { fakeAutomatedChannel, fakeFollowUps, fakeHomeTitle, fakeParseCommand, fakeRouteCheck, fakeSettledScore, fakeTitle, fakeTopicArt, fakeUrgencyGate } from './rules'

export const FAKE_MODEL = 'fake'
/** In a task's input, the fake's main model refuses it under its policy. */
export const FAKE_REFUSE = '::refuse::'
/** The refusal's text, shaped like the one Anthropic sends through OpenRouter. */
const REFUSAL = 'This request triggered restrictions on prohibited content and was blocked under the usage policy of the model.'
/** The fake's price per million tokens, so cost shows in the AI activity log and the ledger as it would live. */
const FAKE_INPUT_USD = 1
const FAKE_OUTPUT_USD = 4
const FAKE_COST = { input: FAKE_INPUT_USD, output: FAKE_OUTPUT_USD, cacheRead: FAKE_INPUT_USD, cacheWrite: FAKE_INPUT_USD }

/** About four characters a token, as the live models count English. */
const tokens = (text: string): number => Math.max(1, Math.ceil(text.length / 4))

/** The meta of an answer: the input the task renders and the output it gave, priced at the fake's rates. */
const metaOf = (base: AiCallMeta, rendered: string, output: unknown): AiCallMeta => {
  const inputTokens = tokens(rendered)
  const outputTokens = tokens(typeof output === 'string' ? output : JSON.stringify(output) ?? '')
  return { ...base, inputTokens, outputTokens, costUsd: (inputTokens * FAKE_INPUT_USD + outputTokens * FAKE_OUTPUT_USD) / 1_000_000 }
}

const structuredRules: Record<string, (input: never) => unknown> = {
  routeCheck: fakeRouteCheck,
  grammarCheck: fakeGrammarCheck,
  settledScore: fakeSettledScore,
  urgencyGate: fakeUrgencyGate,
  parseCommand: fakeParseCommand,
  followUps: fakeFollowUps,
  homeTitle: fakeHomeTitle,
  automatedChannel: fakeAutomatedChannel,
}

const textRules: Record<string, (input: never) => string> = {
  titleTopic: fakeTitle as (input: TitleTopicInput) => string,
  topicArt: fakeTopicArt as (input: TopicArtInput) => string,
}

export interface FakeAiOptions {
  /** How long every answer takes. Past the task's timeout the answer is `timeout`. */
  readonly delayMillis?: number
  /**
   * Asked before every answer with its upper cost at the fake's prices,
   * worked out as the real provider does (`upperUsd`). Blocked gives `budget`.
   */
  readonly admit?: (upperUsd: number) => Effect.Effect<Admission>
  /** The fallback model's slug, read on every refusal; undefined or '' is none. */
  readonly fallback?: Effect.Effect<string | undefined>
}

export class FakeAiProvider extends AiProvider {
  static readonly layer: Layer.Layer<AiProvider> = Layer.succeed(AiProvider, makeFakeAiProvider())
  static readonly layerWith = (options: FakeAiOptions): Layer.Layer<AiProvider> => Layer.succeed(AiProvider, makeFakeAiProvider(options))
}

export function makeFakeAiProvider(options: FakeAiOptions = {}): AiProviderShape {
  const meta: AiCallMeta = { model: FAKE_MODEL, latencyMillis: 0, costUsd: 0, attempts: 1 }
  const delay = options.delayMillis ?? 0
  const admit = options.admit

  type TaskInfo = { readonly timeoutMillis: number; readonly tier: Tier; readonly prompt: string }

  /** The main model's answer, or its refusal and then the fallback's answer. */
  const late = <A>(task: TaskInfo, rendered: string, answer: Effect.Effect<Decision<A>>): Effect.Effect<Decision<A>> => {
    if (!rendered.includes(FAKE_REFUSE)) return admitted(task, rendered, answer)
    const refused: Decision<A> = { _tag: 'NoDecision', reason: 'provider-error', kind: 'policy', detail: REFUSAL, meta: { ...meta, costUsd: 0 } }
    return Effect.gen(function* () {
      const first: Decision<A> = yield* admitted<A>(task, rendered, Effect.succeed(refused))
      const slug = task.tier === 'art' || options.fallback === undefined ? undefined : yield* options.fallback
      if (first !== refused || slug === undefined || slug === '' || modelMaker(slug) === modelMaker(FAKE_MODEL)) return first
      const second: Decision<A> = yield* admitted<A>(task, rendered, answer)
      const fallbackFor = { meta: first.meta, kind: 'policy' as const, detail: REFUSAL }
      return { ...second, meta: { ...second.meta, model: slug, fallbackFor } } as Decision<A>
    })
  }

  const admitted = <A>(task: TaskInfo, rendered: string, answer: Effect.Effect<Decision<A>>): Effect.Effect<Decision<A>> =>
    admit === undefined ? timed(task.timeoutMillis, answer) : Effect.gen(function* () {
      const admission = yield* admit(upperUsd(FAKE_COST, true, task.prompt + rendered, MAX_TOKENS[task.tier]))
      if (admission._tag === 'Blocked') return { _tag: 'NoDecision', reason: 'budget', detail: admission.reason ?? 'cap', meta: { ...meta, attempts: 0 } } as Decision<A>
      return yield* timed(task.timeoutMillis, answer).pipe(Effect.onExit((exit) => admission.settle(exit._tag === 'Success' ? exit.value.meta.costUsd ?? 0 : 0)))
    })

  const timed = <A>(timeoutMillis: number, answer: Effect.Effect<Decision<A>>): Effect.Effect<Decision<A>> =>
    delay <= 0
      ? answer
      : Effect.sleep(delay).pipe(
          Effect.andThen(answer),
          Effect.timeoutOption(timeoutMillis),
          Effect.map((outcome): Decision<A> => (outcome._tag === 'Some' ? outcome.value : { _tag: 'NoDecision', reason: 'timeout', meta: { ...meta, latencyMillis: timeoutMillis } })),
        )

  const decide = <I, S extends TSchema>(task: StructuredTask<I, S>, input: I): Effect.Effect<Decision<Static<S>>> =>
    late(task, task.render(input), Effect.sync(() => {
      const rule = structuredRules[task.name]
      if (!rule) return { _tag: 'NoDecision', reason: 'invalid-output', detail: `no fake rule for ${task.name}`, meta }
      const output = rule(input as never)
      const checked = validateOutput(task, input, output)
      const spent = metaOf(meta, task.render(input), output)
      return checked.ok ? { _tag: 'Decided', value: checked.value, meta: spent } : { _tag: 'NoDecision', reason: 'invalid-output', detail: checked.message, meta: spent }
    }))

  const generate = <I>(task: TextTask<I>, input: I): Effect.Effect<Decision<string>> =>
    late(task, task.render(input), Effect.sync(() => {
      const rule = textRules[task.name]
      if (!rule) return { _tag: 'NoDecision', reason: 'invalid-output', detail: `no fake rule for ${task.name}`, meta }
      const raw = rule(input as never)
      const spent = metaOf(meta, task.render(input), raw)
      const text = cleanText(task, raw)
      if (text === undefined) return { _tag: 'NoDecision', reason: 'invalid-output', detail: 'empty answer', meta: spent }
      if (task.check === undefined) return { _tag: 'Decided', value: text, meta: spent }
      const checked = task.check(text, input)
      return checked.ok ? { _tag: 'Decided', value: checked.value, meta: spent } : { _tag: 'NoDecision', reason: 'invalid-output', detail: checked.message, meta: spent }
    }))

  return { decide, generate }
}
