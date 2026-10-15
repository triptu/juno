/**
 * The deterministic provider for tests and `JUNO_AI=fake`: word rules per
 * task. Outputs pass the same validation as the
 * real provider's, so a broken rule shows up as no decision, never as a crash.
 * `delayMillis` makes every answer that late, and like the real provider it
 * gives up at the task's timeout, so tests can watch a slow model.
 */
import type { Static, TSchema } from '@earendil-works/pi-ai'
import { Effect, Layer } from 'effect'
import { AiProvider, type AiCallMeta, type AiProviderShape, type Decision } from '../provider'
import { cleanText, validateOutput, type StructuredTask, type TextTask } from '../task'
import type { TitleTopicInput } from '../tasks/titleTopic'
import type { TopicArtInput } from '../tasks/topicArt'
import { fakeFollowUps, fakeHomeTitle, fakeParseCommand, fakeRouteCheck, fakeSettledScore, fakeTitle, fakeTopicArt, fakeUrgencyGate } from './rules'

export const FAKE_MODEL = 'fake'

const structuredRules: Record<string, (input: never) => unknown> = {
  routeCheck: fakeRouteCheck,
  settledScore: fakeSettledScore,
  urgencyGate: fakeUrgencyGate,
  parseCommand: fakeParseCommand,
  followUps: fakeFollowUps,
  homeTitle: fakeHomeTitle,
}

const textRules: Record<string, (input: never) => string> = {
  titleTopic: fakeTitle as (input: TitleTopicInput) => string,
  topicArt: fakeTopicArt as (input: TopicArtInput) => string,
}

export interface FakeAiOptions {
  /** How long every answer takes. Past the task's timeout the answer is `timeout`. */
  readonly delayMillis?: number
}

export class FakeAiProvider extends AiProvider {
  static readonly layer: Layer.Layer<AiProvider> = Layer.succeed(AiProvider, makeFakeAiProvider())
  static readonly layerWith = (options: FakeAiOptions): Layer.Layer<AiProvider> => Layer.succeed(AiProvider, makeFakeAiProvider(options))
}

export function makeFakeAiProvider(options: FakeAiOptions = {}): AiProviderShape {
  const meta: AiCallMeta = { model: FAKE_MODEL, latencyMillis: 0, costUsd: 0, attempts: 1 }
  const delay = options.delayMillis ?? 0

  const late = <A>(timeoutMillis: number, answer: Effect.Effect<Decision<A>>): Effect.Effect<Decision<A>> =>
    delay <= 0
      ? answer
      : Effect.sleep(delay).pipe(
          Effect.andThen(answer),
          Effect.timeoutOption(timeoutMillis),
          Effect.map((outcome): Decision<A> => (outcome._tag === 'Some' ? outcome.value : { _tag: 'NoDecision', reason: 'timeout', meta: { ...meta, latencyMillis: timeoutMillis } })),
        )

  const decide = <I, S extends TSchema>(task: StructuredTask<I, S>, input: I): Effect.Effect<Decision<Static<S>>> =>
    late(task.timeoutMillis, Effect.sync(() => {
      const rule = structuredRules[task.name]
      if (!rule) return { _tag: 'NoDecision', reason: 'invalid-output', detail: `no fake rule for ${task.name}`, meta }
      const checked = validateOutput(task, input, rule(input as never))
      return checked.ok ? { _tag: 'Decided', value: checked.value, meta } : { _tag: 'NoDecision', reason: 'invalid-output', detail: checked.message, meta }
    }))

  const generate = <I>(task: TextTask<I>, input: I): Effect.Effect<Decision<string>> =>
    late(task.timeoutMillis, Effect.sync(() => {
      const rule = textRules[task.name]
      if (!rule) return { _tag: 'NoDecision', reason: 'invalid-output', detail: `no fake rule for ${task.name}`, meta }
      const text = cleanText(task, rule(input as never))
      if (text === undefined) return { _tag: 'NoDecision', reason: 'invalid-output', detail: 'empty answer', meta }
      if (task.check === undefined) return { _tag: 'Decided', value: text, meta }
      const checked = task.check(text, input)
      return checked.ok ? { _tag: 'Decided', value: checked.value, meta } : { _tag: 'NoDecision', reason: 'invalid-output', detail: checked.message, meta }
    }))

  return { decide, generate }
}
