/**
 * PiAiProvider against pi-ai's scripted faux provider: no network, real
 * request assembly, validation, retry and timeout paths.
 */
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall, type FauxResponseStep } from '@earendil-works/pi-ai'
import { Effect, Stream } from 'effect'
import { describe, expect, it } from 'vitest'
import { OPENROUTER, chatTools, defineStructuredTask, defineTextTask, makePiAiProvider, tasks, type AiConfig, type Decision } from '../src/index'
import { NOW, postgres, stagingBill } from './fixtures'

const DECISION = 'test/decider'
const GENERATION = 'test/writer'

function scripted(responses: FauxResponseStep[], config: AiConfig = { apiKey: 'test-key', models: { decision: DECISION, generation: GENERATION } }) {
  const faux = fauxProvider({ provider: OPENROUTER, api: 'openai-completions', models: [{ id: DECISION }, { id: GENERATION }], tokensPerSecond: 1_000_000 })
  faux.setResponses(responses)
  const models = createModels()
  models.setProvider(faux.provider)
  return { provider: makePiAiProvider(Effect.succeed(config), models), faux }
}

const routeInput = { draft: 'Jonas scaled it down', channel: '#eng', topics: [stagingBill, postgres] }
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
    const { provider } = scripted([fauxAssistantMessage(fauxToolCall('cards', { cards: [] }))])
    const decision = await Effect.runPromise(provider.decide(tasks.forYou, { me: 'Tushar', now: NOW, topics: [] }))
    expect(decision).toMatchObject({ _tag: 'Decided', value: { cards: [] }, meta: { model: GENERATION } })
    expect(decision.meta.costUsd).toBeTypeOf('number')
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
