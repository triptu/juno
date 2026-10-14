// The scripted model through pi-ai's own Models API, as the guard and providers call it.
import { expect, it } from 'vitest'
import { fauxToolCall, type AssistantMessage, type AssistantMessageEvent, type Context } from '@earendil-works/pi-ai'
import { compactionTask, start } from '@juno/agent-memory'
import { fakeProvider, lostStream, rateLimited, rejectedKey, reply, serverError, type FakeProvider } from '../src/index'

const ask = (text: string): Context => ({ messages: [{ role: 'user', content: text, timestamp: 0 }] })
const text = (m: AssistantMessage) => m.content.map((c) => (c.type === 'text' ? c.text : '')).join('')

async function events(fake: FakeProvider, model: string, context: Context) {
  const seen: AssistantMessageEvent[] = []
  for await (const event of fake.models.streamSimple(fake.model(model), context)) seen.push(event)
  return seen
}

it('answers each request with the next scripted step', async () => {
  const fake = fakeProvider()
  fake.script([reply('Hello.'), reply([fauxToolCall('find_tools', { query: 'notion' }, { id: 'call-1' })])])
  const sonnet = fake.model('anthropic/claude-sonnet-5.5')

  const first = await fake.models.completeSimple(sonnet, ask('hi'))
  expect(first.content).toEqual([{ type: 'text', text: 'Hello.' }])
  expect(first.stopReason).toBe('stop')
  const second = await fake.models.completeSimple(sonnet, ask('find it'))
  expect(second.stopReason).toBe('toolUse')
  expect(second.content).toEqual([{ type: 'toolCall', id: 'call-1', name: 'find_tools', arguments: { query: 'notion' } }])

  const third = await fake.models.completeSimple(sonnet, ask('again'))
  expect(third.stopReason).toBe('error')
  expect(third.errorMessage).toBe('No more faux responses queued')
  expect(fake.requests).toHaveLength(3)
})

it('reports the scripted usage, priced at the model rate', async () => {
  const fake = fakeProvider()
  fake.script([reply('ok', { usage: { input: 1_000_000, output: 100_000 } })])
  const message = await fake.models.completeSimple(fake.model('anthropic/claude-sonnet-5.5'), ask('hi'))
  expect(message.usage).toMatchObject({ input: 1_000_000, output: 100_000, cacheRead: 0, cacheWrite: 0, totalTokens: 1_100_000 })
  // $2 per million in, $10 per million out.
  expect(message.usage.cost.total).toBeCloseTo(3)
})

it('drops a lost stream part way, with no usage', async () => {
  const answer = 'The launch moved to Tuesday because the review ran late.'
  const fake = fakeProvider()
  fake.script([lostStream(answer, { afterChars: 10 })])
  const seen = await events(fake, 'anthropic/claude-sonnet-5.5', ask('why?'))
  expect(seen[0]?.type).toBe('start')
  expect(seen.some((e) => e.type === 'done')).toBe(false)
  const last = seen.at(-1)!
  if (last.type !== 'error') throw new Error('expected an error event')
  expect(last.error.errorMessage).toBe('terminated')
  expect(last.error.usage.totalTokens).toBe(0)
  expect(text(last.error).length).toBeGreaterThan(0)
  expect(text(last.error).length).toBeLessThan(answer.length)
})

it('fails before streaming with the status pi-ai reports for 5xx, a rejected key and a rate limit', async () => {
  const fake = fakeProvider()
  fake.script([serverError(503), rejectedKey(), rateLimited()])
  const messages: string[] = []
  for (let i = 0; i < 3; i++) {
    const seen = await events(fake, 'x-ai/grok-4.7', ask('hi'))
    expect(seen.map((e) => e.type)).toEqual(['error'])
    const only = seen[0]!
    if (only.type !== 'error') throw new Error('expected an error event')
    expect(only.error.usage.totalTokens).toBe(0)
    messages.push(only.error.errorMessage!)
  }
  expect(messages).toEqual([
    '503: {"error":{"message":"Service unavailable","code":503}}',
    '401: {"error":{"message":"User not found.","code":401}}',
    '429: {"error":{"message":"Rate limit exceeded","code":429}}',
  ])
})

it('answers compaction tasks deterministically, outside the chat script', async () => {
  const fake = fakeProvider({ compactor: { oversizedAnswers: 1 } })
  fake.script([reply('chat')])
  const source = { id: 7, version: 1, kind: 'user' as const, text: `The owner moved the launch to Tuesday. ${'More detail here. '.repeat(60)}`, removed: false }
  const job = start({ a: 7, w: 1, v: 1 }, { kind: 'leaf', source }, [])
  if (job.kind !== 'retry') throw new Error('expected a compaction job')
  const task: Context = { messages: compactionTask(job.state).map((part) => ({ role: 'user' as const, content: part, timestamp: 0 })) }
  const haiku = fake.model('anthropic/claude-haiku-5.5')

  const oversized = text(await fake.models.completeSimple(haiku, task))
  const first = await fake.models.completeSimple(haiku, task)
  const second = text(await fake.models.completeSimple(haiku, task))
  expect(Buffer.byteLength(oversized)).toBeGreaterThan(512)
  expect(text(first)).toMatch(/^Summary of messages 7–7: user: The owner moved the launch to Tuesday\. More detail here\./)
  expect(Buffer.byteLength(text(first))).toBeLessThanOrEqual(512)
  expect(second).toBe(text(first))
  expect(first.content.some((c) => c.type === 'toolCall')).toBe(false)
  expect(fake.pending()).toBe(1)
})
