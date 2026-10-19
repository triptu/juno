/**
 * PiAiProvider against pi-ai's scripted faux provider: no network, real
 * request assembly, validation, retry and timeout paths.
 */
import { createModels, createProvider, fauxAssistantMessage, fauxProvider, fauxToolCall, type ClassifierAnswer, type ClassifierContext, type FauxResponseStep } from '@earendil-works/pi-ai'
import { createFauxCore } from '@earendil-works/pi-ai/providers/faux'
import { Effect, Fiber } from 'effect'
import { describe, expect, it } from 'vitest'
import { OPENROUTER, defineStructuredTask, defineTextTask, isFinal, makePiAiProvider, tasks, type AiConfig, type Decision } from '../src/index'
import { NOW, postgres, stagingBill } from './fixtures'

const DECISION = 'test/decider'
const GENERATION = 'test/writer'
const CLASSIFIER = 'test/classifier'
/** From another maker than the two above, so it may stand in for them. */
const FALLBACK = 'other/writer'
const FAUX = { provider: OPENROUTER, api: 'openai-completions', models: [{ id: DECISION }, { id: GENERATION }, { id: FALLBACK }], tokensPerSecond: 1_000_000 }

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

  it('never retries a grammar request with invalid output', async () => {
    const { provider, faux } = scripted([fauxAssistantMessage(fauxToolCall('grammar', { prose: 'rewrite it' }))])
    const decision = await Effect.runPromise(provider.decide(tasks.grammarCheck, { draft: 'its broken' }))
    expect(noDecision(decision)).toEqual({ reason: 'invalid-output', attempts: 1 })
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
    if (process.env.JUNO_PERF === '1') expect(Date.now() - started).toBeLessThan(1000)
  })

  it('gives no decision without a key, and makes no request', async () => {
    const { provider, faux } = scripted([fauxAssistantMessage(fauxToolCall('route', { replyTo: null, confidence: 1 }))], { apiKey: undefined, models: { decision: DECISION } })
    const decision = await Effect.runPromise(provider.decide(tasks.routeCheck, routeInput))
    expect(noDecision(decision)).toEqual({ reason: 'missing-key', attempts: 0 })
    expect(faux.state.callCount).toBe(0)
  })

  it('reserves before the request and settles the reported cost; at the cap it makes no request', async () => {
    const asked: number[] = []
    const settled: Array<number | undefined> = []
    let open = true
    const admit = (upper: number) => Effect.sync(() => {
      asked.push(upper)
      return open ? { _tag: 'Admitted' as const, settle: (usd: number | undefined) => Effect.sync(() => { settled.push(usd) }) } : { _tag: 'Blocked' as const }
    })
    const { provider, faux } = scripted([fauxAssistantMessage(fauxToolCall('route', { replyTo: null, confidence: 1 }))], { ...chatConfig, admit })
    const decision = await Effect.runPromise(provider.decide(tasks.routeCheck, routeInput))
    expect(decision).toMatchObject({ _tag: 'Decided' })
    expect(asked).toHaveLength(1)
    expect(asked[0]).toBeGreaterThanOrEqual(decision.meta.costUsd ?? 0)
    expect(settled).toEqual([decision.meta.costUsd])
    open = false
    expect(noDecision(await Effect.runPromise(provider.decide(tasks.routeCheck, routeInput)))).toEqual({ reason: 'budget', attempts: 0 })
    expect(faux.state.callCount).toBe(1)
    expect(settled).toHaveLength(1)
  })

  it('settles a timeout in the first attempt at that attempt\'s bound: the retry was never sent', async () => {
    const asked: number[] = []
    const settled: Array<number | undefined> = []
    const admit = (upper: number) => Effect.sync(() => {
      asked.push(upper)
      return { _tag: 'Admitted' as const, settle: (usd: number | undefined) => Effect.sync(() => { settled.push(usd) }) }
    })
    const quick = defineStructuredTask({ ...tasks.routeCheck, timeoutMillis: 40 })
    const { provider } = scripted([() => new Promise(() => {})], { ...chatConfig, admit })
    expect(noDecision(await Effect.runPromise(provider.decide(quick, routeInput)))).toEqual({ reason: 'timeout', attempts: 1 })
    // Settled as known, not kept whole: at most the first attempt, under half the reservation.
    expect(settled).toHaveLength(1)
    expect(settled[0]).toBeTypeOf('number')
    expect(settled[0]).toBeLessThanOrEqual(asked[0]! / 2)
  })

  it('settles a call stopped in its first attempt at that attempt\'s bound, not the whole reservation', async () => {
    const asked: number[] = []
    const settled: Array<number | undefined> = []
    const admit = (upper: number) => Effect.sync(() => {
      asked.push(upper)
      return { _tag: 'Admitted' as const, settle: (usd: number | undefined) => Effect.sync(() => { settled.push(usd) }) }
    })
    const { provider } = scripted([() => new Promise(() => {})], { ...chatConfig, admit })
    // A job restarted while the request was out: the call is interrupted, not timed out.
    const fiber = Effect.runFork(provider.decide(tasks.routeCheck, routeInput))
    await new Promise((resolve) => setTimeout(resolve, 20))
    await Effect.runPromise(Fiber.interrupt(fiber))
    expect(settled).toHaveLength(1)
    expect(settled[0]).toBeTypeOf('number')
    expect(settled[0]).toBeLessThanOrEqual(asked[0]! / 2)
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

  it('maps the main choice to no topic, and a reason choice to the notification decision', async () => {
    const { provider } = scriptedWithClassifier(
      [],
      [() => ({ replyTo: { type: 'choice', choice: 'main', probabilities: { main: 0.7 }, confidence: 0.7 } }), () => ({ decision: { type: 'choice', choice: 'incident', probabilities: { incident: 0.9 }, confidence: 0.9 } })],
    )
    expect(await Effect.runPromise(provider.decide(tasks.routeCheck, routeInput))).toMatchObject({ _tag: 'Decided', value: { replyTo: null, confidence: 0.7 } })
    const gate = { messageTs: '1', channel: '#eng', channelKind: 'public' as const, sender: 'Jonas', text: 'Checkout is down', mentionsMe: false, now: NOW }
    expect(await Effect.runPromise(provider.decide(tasks.urgencyGate, gate))).toMatchObject({ _tag: 'Decided', value: { notify: true, reason: 'An incident or customer problem needs you now' } })
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

describe('PiAiProvider on errors that trying again cannot change', () => {
  const REFUSAL = "This request triggered restrictions on violative cyber content and was blocked under Anthropic's Usage Policy."
  const titleInput = { topicId: postgres.id, channel: '#eng', messages: postgres.recent }
  const withFallback = (fallback: string): AiConfig => ({ ...chatConfig, models: { ...chatConfig.models, fallback } })

  it('does not retry a policy refusal, and gives a final answer when there is no fallback', async () => {
    const { provider, faux } = scripted([fauxAssistantMessage('', { stopReason: 'error', errorMessage: REFUSAL }), fauxAssistantMessage('Postgres migration plan')], withFallback(''))
    const decision = await Effect.runPromise(provider.generate(tasks.titleTopic, titleInput))
    expect(decision).toMatchObject({ _tag: 'NoDecision', reason: 'provider-error', kind: 'policy', meta: { model: GENERATION, attempts: 1 } })
    expect(isFinal(decision)).toBe(true)
    expect(faux.state.callCount).toBe(1)
  })

  it('does not retry a bad request or a context too long', async () => {
    for (const errorMessage of ['400 {"error":{"code":400,"message":"tools.0: invalid schema"}}', "400 {\"error\":{\"code\":400,\"message\":\"This endpoint's maximum context length is 128000 tokens.\"}}"]) {
      const { provider, faux } = scripted([fauxAssistantMessage('', { stopReason: 'error', errorMessage }), fauxAssistantMessage(fauxToolCall('route', { replyTo: null, confidence: 1 }))])
      const decision = await Effect.runPromise(provider.decide(tasks.routeCheck, routeInput))
      expect(noDecision(decision)).toEqual({ reason: 'provider-error', attempts: 1 })
      expect(faux.state.callCount).toBe(1)
    }
  })

  it('asks the fallback model once after a policy refusal, and says which model answered', async () => {
    const asked: string[] = []
    const reply = (message: ReturnType<typeof fauxAssistantMessage>): FauxResponseStep => (_context, _options, _state, model) => {
      asked.push(model.id)
      return message
    }
    const { provider } = scripted([reply(fauxAssistantMessage('', { stopReason: 'error', errorMessage: REFUSAL })), reply(fauxAssistantMessage('Postgres migration plan'))], withFallback(FALLBACK))
    const decision = await Effect.runPromise(provider.generate(tasks.titleTopic, titleInput))
    expect(decision).toMatchObject({ _tag: 'Decided', value: 'Postgres migration plan', meta: { model: FALLBACK, attempts: 1, fallbackFor: { kind: 'policy', detail: REFUSAL, meta: { model: GENERATION, attempts: 1 } } } })
    expect(asked).toEqual([GENERATION, FALLBACK])
  })

  it('reserves and settles the fallback on its own, in the same ledger', async () => {
    const settled: Array<number | undefined> = []
    const admit = (_upper: number) => Effect.succeed({ _tag: 'Admitted' as const, settle: (usd: number | undefined) => Effect.sync(() => { settled.push(usd) }) })
    const { provider } = scripted([fauxAssistantMessage('', { stopReason: 'error', errorMessage: `403 {"error":{"code":403,"message":"Input was flagged by moderation"}}` }), fauxAssistantMessage('Postgres migration plan')], { ...withFallback(FALLBACK), admit })
    const decision = await Effect.runPromise(provider.generate(tasks.titleTopic, titleInput))
    expect(decision._tag).toBe('Decided')
    // The refusal came before any output, so it settles at nothing; the fallback at what it reported.
    expect(settled).toHaveLength(2)
    expect(settled[0]).toBe(0)
  })

  it('does not ask a fallback from the same maker, or for a request error', async () => {
    const same = scripted([fauxAssistantMessage('', { stopReason: 'error', errorMessage: REFUSAL }), fauxAssistantMessage('Postgres migration plan')], withFallback(DECISION))
    expect(await Effect.runPromise(same.provider.generate(tasks.titleTopic, titleInput))).toMatchObject({ _tag: 'NoDecision', kind: 'policy' })
    expect(same.faux.state.callCount).toBe(1)
    const bad = scripted([fauxAssistantMessage('', { stopReason: 'error', errorMessage: '402 {"error":{"code":402,"message":"Insufficient credits"}}' }), fauxAssistantMessage('Postgres migration plan')], withFallback(FALLBACK))
    expect(await Effect.runPromise(bad.provider.generate(tasks.titleTopic, titleInput))).toMatchObject({ _tag: 'NoDecision', kind: 'credits' })
    expect(bad.faux.state.callCount).toBe(1)
  })

  it('still retries an error that may pass, and asks the fallback when the model stays unavailable', async () => {
    const down = '502 {"error":{"code":502,"message":"Upstream error from Anthropic: Overloaded"}}'
    const { provider, faux } = scripted([fauxAssistantMessage('', { stopReason: 'error', errorMessage: down }), fauxAssistantMessage('', { stopReason: 'error', errorMessage: down }), fauxAssistantMessage('Postgres migration plan')], withFallback(FALLBACK))
    const decision = await Effect.runPromise(provider.generate(tasks.titleTopic, titleInput))
    expect(decision).toMatchObject({ _tag: 'Decided', meta: { model: FALLBACK, fallbackFor: { kind: 'unavailable', meta: { attempts: 2 } } } })
    expect(faux.state.callCount).toBe(3)
    expect(isFinal(decision)).toBe(false)
  })
})
