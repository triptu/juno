/**
 * The deterministic provider for tests and `JUNO_AI=fake`: word rules per task
 * and a fixture of canned chat turns. Outputs pass the same validation as the
 * real provider's, so a broken rule shows up as no decision, never as a crash.
 */
import { validateToolCall, type Static, type TSchema, type Tool } from '@earendil-works/pi-ai'
import { Effect, Layer, Stream } from 'effect'
import { AiProvider, type AiCallMeta, type AiProviderShape, type ChatEvent, type ChatToolCall, type Decision } from '../provider'
import { cleanText, validateOutput, type StructuredTask, type TextTask } from '../task'
import type { CatchUpInput } from '../tasks/catchUp'
import type { TitleTopicInput } from '../tasks/titleTopic'
import type { TopicArtInput } from '../tasks/topicArt'
import { fakeChatTurn } from './replies'
import { fakeCatchUp, fakeForYou, fakeGroupRun, fakeParseCommand, fakeRouteCheck, fakeSettledScore, fakeTitle, fakeTopicArt, fakeUrgencyGate } from './rules'

export const FAKE_MODEL = 'fake'

const structuredRules: Record<string, (input: never) => unknown> = {
  routeCheck: fakeRouteCheck,
  settledScore: fakeSettledScore,
  groupRun: fakeGroupRun,
  urgencyGate: fakeUrgencyGate,
  parseCommand: fakeParseCommand,
  forYou: fakeForYou,
}

const textRules: Record<string, (input: never) => string> = {
  titleTopic: fakeTitle as (input: TitleTopicInput) => string,
  catchUp: fakeCatchUp as (input: CatchUpInput) => string,
  topicArt: fakeTopicArt as (input: TopicArtInput) => string,
}

export class FakeAiProvider extends AiProvider {
  static readonly layer: Layer.Layer<AiProvider> = Layer.succeed(AiProvider, makeFakeAiProvider())
}

export function makeFakeAiProvider(): AiProviderShape {
  const meta: AiCallMeta = { model: FAKE_MODEL, latencyMillis: 0, costUsd: 0, attempts: 1 }

  const decide = <I, S extends TSchema>(task: StructuredTask<I, S>, input: I): Effect.Effect<Decision<Static<S>>> =>
    Effect.sync(() => {
      const rule = structuredRules[task.name]
      if (!rule) return { _tag: 'NoDecision', reason: 'invalid-output', detail: `no fake rule for ${task.name}`, meta }
      const checked = validateOutput(task, input, rule(input as never))
      return checked.ok ? { _tag: 'Decided', value: checked.value, meta } : { _tag: 'NoDecision', reason: 'invalid-output', detail: checked.message, meta }
    })

  const generate = <I>(task: TextTask<I>, input: I): Effect.Effect<Decision<string>> =>
    Effect.sync(() => {
      const rule = textRules[task.name]
      if (!rule) return { _tag: 'NoDecision', reason: 'invalid-output', detail: `no fake rule for ${task.name}`, meta }
      const text = cleanText(task, rule(input as never))
      if (text === undefined) return { _tag: 'NoDecision', reason: 'invalid-output', detail: 'empty answer', meta }
      if (task.check === undefined) return { _tag: 'Decided', value: text, meta }
      const checked = task.check(text, input)
      return checked.ok ? { _tag: 'Decided', value: checked.value, meta } : { _tag: 'NoDecision', reason: 'invalid-output', detail: checked.message, meta }
    })

  const chat: AiProviderShape['chat'] = (context, tools) =>
    Stream.suspend(() => {
      const turn = fakeChatTurn(context)
      const piTools: Tool[] = tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }))
      const events: ChatEvent[] = []
      // Stream the text in word-sized deltas so consumers see the same shape as the real provider.
      for (const delta of turn.text.split(/(?<=\s)/)) if (delta) events.push({ type: 'text', delta })
      const accepted: ChatToolCall[] = []
      for (const call of turn.toolCalls) {
        try {
          validateToolCall(piTools, { type: 'toolCall', id: call.id, name: call.name, arguments: call.arguments as never })
        } catch (error) {
          events.push({ type: 'failed', reason: 'invalid-output', detail: error instanceof Error ? error.message : String(error), meta })
          return Stream.fromIterable(events)
        }
        accepted.push(call)
        events.push({ type: 'toolCall', call })
      }
      events.push({ type: 'done', text: turn.text, toolCalls: accepted, meta })
      return Stream.fromIterable(events)
    })

  return { decide, generate, chat }
}
