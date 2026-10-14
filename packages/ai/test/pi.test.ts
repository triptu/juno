/**
 * PiAiProvider against pi-ai's scripted faux provider: no network, real
 * request assembly, validation, retry and timeout paths.
 */
import { createModels, createProvider, fauxAssistantMessage, fauxProvider, fauxToolCall, type ClassifierAnswer, type ClassifierContext, type FauxResponseStep } from '@earendil-works/pi-ai'
import { createFauxCore } from '@earendil-works/pi-ai/providers/faux'
import { Effect, Stream } from 'effect'
import { describe, expect, it } from 'vitest'
import { OPENROUTER, chatTools, defineStructuredTask, defineTextTask, makePiAiProvider, tasks, type AiConfig, type Decision } from '../src/index'
import { NOW, postgres, stagingBill } from './fixtures'

const DECISION = 'test/decider'
const GENERATION = 'test/writer'
const CLASSIFIER = 'test/classifier'
const FAUX = { provider: OPENROUTER, api: 'openai-completions', models: [{ id: DECISION }, { id: GENERATION }], tokensPerSecond: 1_000_000 }

/** Chat models only: the classifier slug is empty, so every decision is a tool call. */
const chatConfig: AiConfig = { apiKey: 'test-key', models: { classifier: '', decision: DECISION, generation: GENERATION } }

function scripted(responses: FauxResponseStep[], config: AiConfig = chatConfig) {
  const faux = fauxProvider(FAUX)
  faux.setResponses(responses)
  const models = createModels()
  models.setProvider(faux.provider)
  return { provider: makePiAiProvider(Effect.succeed(config), models), faux }
}

type ClassifierScript = (context: ClassifierContext) => Record<string, ClassifierAnswer>

/** The faux chat models plus a scripted System One classifier under the same provider id, as OpenRouter serves both. */
function scriptedWithClassifier(chat: FauxResponseStep[], answers: ClassifierScript[], config: AiConfig = { ...chatConfig, models: { ...chatConfig.models, classifier: CLASSIFIER } }) {
  const core = createFauxCore(FAUX)
  core.setResponses(chat)
  const asked: ClassifierContext[] = []
  const provider = createProvider({
    id: OPENROUTER,
    auth: { apiKey: { name: 'test', resolve: async () => ({ auth: {} }) } },
    models: [
      ...core.models,
      { type: 'classifier', id: CLASSIFIER, name: CLASSIFIER, api: 'typesafe-system-one', provider: OPENROUTER, baseUrl: 'http://test', input: ['text'], cost: { input: 0.04, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32_000 },
    ],
    api: { stream: core.stream, streamSimple: core.streamSimple, fetchDeferred: core.fetchDeferred, cancelDeferred: core.cancelDeferred },
    classifiers: {
      'typesafe-system-one': {
        classify: async (model, context) => {
          asked.push(context)
          const next = answers.shift()
          if (!next) throw new Error('no scripted answer')
          return { api: model.api, provider: model.provider, model: model.id, answers: next(context), stopReason: 'stop', timestamp: Date.now() }
        },
      },
    },
  })
  const models = createModels()
  models.setProvider(provider)
  return { provider: makePiAiProvider(Effect.succeed(config), models), asked, chat: core.state }
}

const routeInput = { draft: 'Jonas scaled it down', channel: '#eng', topics: [stagingBill, postgres] }
/** A structured task on the generation tier. */
const writtenRoute = defineStructuredTask({ ...tasks.routeCheck, tier: 'generation' })
const noDecision = (d: Decision<unknown>) => (d._tag === 'NoDecision' ? { reason: d.reason, attempts: d.meta.attempts } : d)

describe('PiAiProvider decisions', () => {
  it('returns the validated tool arguments when the model calls the tool', async () => {
    const { provider, faux } = scripted([fauxAssistantMessage(fauxToolCall('route', { replyTo: stagingBill.id, confidence: 0.8 }))])
    const decision = await Effect.runPromise(provider.decide(tasks.routeCheck, routeInput))
    expect(decision).toMatchObject({ _tag: 'Decided', value: { replyTo: stagingBill.id, confidence: 0.8 }, meta: { model: DECISION, attempts: 1 } })
    expect(faux.state.callCount).toBe(1)
  })

  it('retries once on invalid tool output, then takes the valid answer', async () => {
    const { provider, faux } = scripted([
      fauxAssistantMessage(fauxToolCall('route', { replyTo: 'not-a-topic', confidence: 0.8 })),
      fauxAssistantMessage(fauxToolCall('route', { replyTo: null, confidence: 0.9 })),
    ])
    const decision = await Effect.runPromise(provider.decide(tasks.routeCheck, routeInput))
    expect(decision).toMatchObject({ _tag: 'Decided', value: { replyTo: null, confidence: 0.9 }, meta: { attempts: 2 } })
    expect(faux.state.callCount).toBe(2)
  })

  it('gives no decision after two invalid outputs: wrong shape, then prose instead of a tool call', async () => {
    const { provider, faux } = scripted([
      fauxAssistantMessage(fauxToolCall('route', { replyTo: null, confidence: 'high' })),
      fauxAssistantMessage('I think it belongs in Main.'),
    ])
    const decision = await Effect.runPromise(provider.decide(tasks.routeCheck, routeInput))
    expect(noDecision(decision)).toEqual({ reason: 'invalid-output', attempts: 2 })
    expect(faux.state.callCount).toBe(2)
  })

  it('gives no decision on a provider error, after one retry', async () => {
    const { provider } = scripted([
      fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'HTTP 502' }),
      fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'HTTP 502' }),
    ])
    const decision = await Effect.runPromise(provider.decide(tasks.routeCheck, routeInput))
    expect(noDecision(decision)).toEqual({ reason: 'provider-error', attempts: 2 })
  })

  it('gives no decision when the task timeout passes, without waiting for the model', async () => {
    const quick = defineStructuredTask({ ...tasks.routeCheck, timeoutMillis: 40 })
    const { provider } = scripted([() => new Promise(() => {})])
    const started = Date.now()
    const decision = await Effect.runPromise(provider.decide(quick, routeInput))
    expect(noDecision(decision)).toEqual({ reason: 'timeout', attempts: 1 })
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('gives no decision without a key, and makes no request', async () => {
    const { provider, faux } = scripted([fauxAssistantMessage(fauxToolCall('route', { replyTo: null, confidence: 1 }))], { apiKey: undefined, models: { decision: DECISION } })
    const decision = await Effect.runPromise(provider.decide(tasks.routeCheck, routeInput))
    expect(noDecision(decision)).toEqual({ reason: 'missing-key', attempts: 0 })
    expect(faux.state.callCount).toBe(0)
  })

  it('uses the tier model from the config, and reports a cost only for a priced model', async () => {
    const { provider } = scripted([fauxAssistantMessage(fauxToolCall('route', { replyTo: null, confidence: 1 }))])
    const decision = await Effect.runPromise(provider.decide(writtenRoute, routeInput))
    expect(decision).toMatchObject({ _tag: 'Decided', value: { replyTo: null, confidence: 1 }, meta: { model: GENERATION } })
    expect(decision.meta.costUsd).toBeTypeOf('number')
  })

  it('forces the tool on the decision tier and asks with tool choice auto on the generation tier', async () => {
    const choices: unknown[] = []
    const record = (reply: ReturnType<typeof fauxAssistantMessage>): FauxResponseStep => (_ctx, options) => {
      choices.push(options?.toolChoice)
      return reply
    }
    const { provider } = scripted([record(fauxAssistantMessage(fauxToolCall('route', { replyTo: null, confidence: 1 }))), record(fauxAssistantMessage(fauxToolCall('route', { replyTo: null, confidence: 1 })))])
    await Effect.runPromise(provider.decide(tasks.routeCheck, routeInput))
    await Effect.runPromise(provider.decide(writtenRoute, routeInput))
    expect(choices).toEqual([{ type: 'function', function: { name: 'route' } }, 'auto'])
  })

  it('retries with tool choice auto when the model rejects a forced tool choice', async () => {
    const choices: unknown[] = []
    const { provider } = scripted([
      fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'tool_choice: type "tool" and "any" are not supported for this model' }),
      (_ctx, options) => {
        choices.push(options?.toolChoice)
        return fauxAssistantMessage(fauxToolCall('route', { replyTo: null, confidence: 0.9 }))
      },
    ])
    const decision = await Effect.runPromise(provider.decide(tasks.routeCheck, routeInput))
    expect(decision).toMatchObject({ _tag: 'Decided', value: { replyTo: null, confidence: 0.9 }, meta: { attempts: 2 } })
    expect(choices).toEqual(['auto'])
  })
})

const unknownTopic: ClassifierScript = () => ({ replyTo: { type: 'choice', choice: 'not-a-topic', probabilities: {}, confidence: 1 } })

describe('PiAiProvider decisions on a decision model', () => {
  it('asks the classifier the task questions over the input and reads the chosen topic back', async () => {
    const { provider, asked, chat } = scriptedWithClassifier([], [() => ({ replyTo: { type: 'choice', choice: stagingBill.id, probabilities: { [stagingBill.id]: 0.8, main: 0.2 }, confidence: 0.8 } })])
    const decision = await Effect.runPromise(provider.decide(tasks.routeCheck, routeInput))
    expect(decision).toMatchObject({ _tag: 'Decided', value: { replyTo: stagingBill.id, confidence: 0.8 }, meta: { model: CLASSIFIER, attempts: 1 } })
    expect(decision.meta.costUsd).toBeTypeOf('number')
    expect(asked[0]?.state).toMatchObject({ draft: 'Jonas scaled it down', channel: '#eng' })
    const question = asked[0]?.questions.replyTo as { criteria: object } | undefined
    expect(Object.keys(question?.criteria ?? {})).toEqual(['main', stagingBill.id, postgres.id])
    expect(chat.callCount).toBe(0)
  })

  it('maps the main choice to no topic, and two bools to the gate probabilities', async () => {
    const { provider } = scriptedWithClassifier(
      [],
      [() => ({ replyTo: { type: 'choice', choice: 'main', probabilities: { main: 0.7 }, confidence: 0.7 } }), () => ({ urgent: { type: 'bool', probability: 0.9 }, chatter: { type: 'bool', probability: 0.05 } })],
    )
    expect(await Effect.runPromise(provider.decide(tasks.routeCheck, routeInput))).toMatchObject({ _tag: 'Decided', value: { replyTo: null, confidence: 0.7 } })
    const gate = { messageTs: '1', channel: '#eng', channelKind: 'public' as const, sender: 'Jonas', text: 'Checkout is down', mentionsMe: false, now: NOW }
    expect(await Effect.runPromise(provider.decide(tasks.urgencyGate, gate))).toMatchObject({ _tag: 'Decided', value: { urgent: 0.9, chatter: 0.05 } })
  })

  it('gives no decision when the classifier answers a topic that is not in the input, after one retry', async () => {
    const { provider } = scriptedWithClassifier([], [unknownTopic, unknownTopic])
    expect(noDecision(await Effect.runPromise(provider.decide(tasks.routeCheck, routeInput)))).toEqual({ reason: 'invalid-output', attempts: 2 })
  })

  it('reports a provider error when the classifier fails twice', async () => {
    const { provider } = scriptedWithClassifier([], [])
    expect(noDecision(await Effect.runPromise(provider.decide(tasks.routeCheck, routeInput)))).toEqual({ reason: 'provider-error', attempts: 2 })
  })

  it('sends a task without a classifier mapping to the chat model', async () => {
    const search = { text: 'postgres', people: [], channels: [], topics: [] }
    const { provider, asked } = scriptedWithClassifier([fauxAssistantMessage(fauxToolCall('command', { command: null, confidence: 0.9 }))], [])
    expect(await Effect.runPromise(provider.decide(tasks.parseCommand, search))).toMatchObject({ _tag: 'Decided', value: { command: null }, meta: { model: DECISION } })
    expect(asked).toHaveLength(0)
  })

  it('uses the chat model for every decision when the classifier slug is empty', async () => {
    const { provider, asked } = scriptedWithClassifier([fauxAssistantMessage(fauxToolCall('route', { replyTo: null, confidence: 1 }))], [], chatConfig)
    expect(await Effect.runPromise(provider.decide(tasks.routeCheck, routeInput))).toMatchObject({ _tag: 'Decided', meta: { model: DECISION } })
    expect(asked).toHaveLength(0)
  })
})

describe('PiAiProvider generation', () => {
  it('returns the model text, trimmed to the task limit', async () => {
    const short = defineTextTask({ ...tasks.titleTopic, maxChars: 20 })
    const { provider } = scripted([fauxAssistantMessage('  Staging bill doubled since August  ')])
    const decision = await Effect.runPromise(provider.generate(short, { topicId: stagingBill.id, channel: '#eng', messages: stagingBill.recent }))
    expect(decision).toMatchObject({ _tag: 'Decided', value: 'Staging bill doubled' })
  })

  it('treats an empty answer as invalid output and retries once', async () => {
    const { provider } = scripted([fauxAssistantMessage('   '), fauxAssistantMessage('Postgres 16 migration plan')])
    const decision = await Effect.runPromise(provider.generate(tasks.titleTopic, { topicId: postgres.id, channel: '#eng', messages: postgres.recent }))
    expect(decision).toMatchObject({ _tag: 'Decided', value: 'Postgres 16 migration plan', meta: { attempts: 2 } })
  })

  it('gives no decision without a key', async () => {
    const { provider } = scripted([], {})
    const decision = await Effect.runPromise(provider.generate(tasks.titleTopic, { topicId: postgres.id, channel: '#eng', messages: postgres.recent }))
    expect(noDecision(decision)).toEqual({ reason: 'missing-key', attempts: 0 })
  })

  const artInput = { kind: 'thread' as const, topicId: postgres.id, title: postgres.title, channel: '#eng', first: postgres.recent[0]!.text, last: postgres.recent.at(-1)!.text }
  const artConfig: AiConfig = { ...chatConfig, models: { ...chatConfig.models, art: GENERATION } }

  it('checks a drawing against the vocabulary and stores the canonical recipe, not the reply', async () => {
    const reply = 'Here you go:\n```svg\n<svg viewBox="0 0 40 40" data-hue="teal"><circle cx="20" cy="20" r="10" fill="soft"/>\n<circle cx="26" cy="14" r="2" fill="accent" stroke="none" detail="1"/></svg>\n```'
    const { provider } = scripted([fauxAssistantMessage(reply)], artConfig)
    const decision = await Effect.runPromise(provider.generate(tasks.topicArt, artInput))
    expect(decision).toMatchObject({ _tag: 'Decided', value: '<svg viewBox="0 0 40 40" data-hue="teal">\n  <circle cx="20" cy="20" r="10" fill="soft"/>\n  <circle cx="26" cy="14" r="2" fill="accent" stroke="none" detail="1"/>\n</svg>' })
  })

  it('sends the failed drawing and the reason back once, then takes the corrected one', async () => {
    const seen: Array<ReadonlyArray<{ role: string; content: unknown }>> = []
    const { provider } = scripted(
      [
        fauxAssistantMessage('<svg viewBox="0 0 40 40" data-hue="teal"><text x="2" y="2">db</text></svg>'),
        (context) => {
          seen.push(context.messages.map((message) => ({ role: message.role, content: message.content })))
          return fauxAssistantMessage('<svg viewBox="0 0 40 40" data-hue="teal"><rect x="8" y="8" width="24" height="24" rx="4" fill="soft"/></svg>')
        },
      ],
      artConfig,
    )
    const decision = await Effect.runPromise(provider.generate(tasks.topicArt, artInput))
    expect(decision).toMatchObject({ _tag: 'Decided', meta: { attempts: 2 } })
    expect(seen).toHaveLength(1)
    const retry = seen[0]!.filter((message) => message.role !== 'system')
    expect(retry.map((message) => message.role)).toEqual(['user', 'assistant', 'user'])
    const shownBack = retry[1]!.content as ReadonlyArray<{ text?: string }>
    expect(shownBack[0]?.text).toContain('<text x="2" y="2">db</text>')
    expect(retry[2]!.content).toBe('That did not validate: element <text> is not allowed. Reply again with a corrected SVG that follows the format exactly. SVG only.')
  })

  it('gives no decision after two drawings outside the vocabulary', async () => {
    const { provider } = scripted([fauxAssistantMessage('<svg data-hue="teal"><text>a</text></svg>'), fauxAssistantMessage('<svg data-hue="teal"><circle cx="20" cy="20" r="5" fill="#f00"/></svg>')], artConfig)
    const decision = await Effect.runPromise(provider.generate(tasks.topicArt, artInput))
    expect(decision).toMatchObject({ _tag: 'NoDecision', reason: 'invalid-output', detail: 'fill must be one of ink, soft, accent, accent2, none; got "#f00"', meta: { attempts: 2 } })
  })
})

describe('PiAiProvider chat', () => {
  const context = { now: NOW, viewing: { id: postgres.id, title: postgres.title, channel: '#eng' }, messages: [{ role: 'user' as const, text: 'summarize this' }] }

  it('streams text deltas and validated tool calls, then done with the whole text', async () => {
    const { provider } = scripted([fauxAssistantMessage(['Reading it now.', fauxToolCall('read_topic', { topicId: postgres.id })].map((c) => (typeof c === 'string' ? { type: 'text', text: c } : c)))])
    const events = await Effect.runPromise(Stream.runCollect(provider.chat(context, chatTools)))
    const text = events.filter((e) => e.type === 'text').map((e) => e.delta).join('')
    expect(text).toBe('Reading it now.')
    expect(events.filter((e) => e.type === 'toolCall')).toMatchObject([{ call: { name: 'read_topic', arguments: { topicId: postgres.id } } }])
    expect(events.at(-1)).toMatchObject({ type: 'done', text: 'Reading it now.', toolCalls: [{ name: 'read_topic' }] })
  })

  it('fails the turn on a tool call that does not match the tools', async () => {
    const { provider } = scripted([fauxAssistantMessage(fauxToolCall('read_topic', { limit: 'all' }))])
    const events = await Effect.runPromise(Stream.runCollect(provider.chat(context, chatTools)))
    expect(events.at(-1)).toMatchObject({ type: 'failed', reason: 'invalid-output' })
  })

  it('fails the turn without a key', async () => {
    const { provider } = scripted([], {})
    const events = await Effect.runPromise(Stream.runCollect(provider.chat(context, chatTools)))
    expect(events).toMatchObject([{ type: 'failed', reason: 'missing-key' }])
  })

  it('carries earlier assistant turns and tool results into the request', async () => {
    const { provider } = scripted([
      (ctx) => {
        const roles = ctx.messages.map((m) => m.role)
        return fauxAssistantMessage(roles.join(','))
      },
    ])
    const events = await Effect.runPromise(
      Stream.runCollect(
        provider.chat(
          {
            ...context,
            messages: [
              { role: 'user', text: 'summarize this' },
              { role: 'assistant', text: '', toolCalls: [{ id: 'c1', name: 'read_topic', arguments: { topicId: postgres.id } }] },
              { role: 'tool', callId: 'c1', name: 'read_topic', result: 'Dev: draft is in the doc.' },
            ],
          },
          chatTools,
        ),
      ),
    )
    expect(events.at(-1)).toMatchObject({ type: 'done', text: expect.stringContaining('user,assistant,toolResult') })
  })
})
