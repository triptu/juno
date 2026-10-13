/** Behaviour through the AiProvider interface with the fake, the way the assistant will use it. */
import { Effect, Stream } from 'effect'
import { describe, expect, it } from 'vitest'
import { AiProvider, FakeAiProvider, chatTools, tasks, type ChatEvent, type Decision } from '../src/index'
import { C, NOW, channels, msg, people, postgres, stagingBill } from './fixtures'

const run = <A>(f: (p: typeof AiProvider.Service) => Effect.Effect<A>) =>
  Effect.runPromise(Effect.gen(function* () {
    const provider = yield* AiProvider
    return yield* f(provider)
  }).pipe(Effect.provide(FakeAiProvider.layer)))

function decided<A>(decision: Decision<A>): A {
  expect(decision._tag).toBe('Decided')
  if (decision._tag !== 'Decided') throw new Error('unreachable')
  return decision.value
}

describe('FakeAiProvider decisions', () => {
  it('routes a draft that continues a topic to that topic, and leaves a new subject in Main', async () => {
    const topics = [stagingBill, postgres]
    const reply = decided(await run((p) => p.decide(tasks.routeCheck, { draft: 'Jonas scaled the perf cluster down, the staging bill should drop', channel: '#eng', topics })))
    expect(reply.replyTo).toBe(stagingBill.id)
    expect(reply.confidence).toBeGreaterThan(0.5)

    const fresh = decided(await run((p) => p.decide(tasks.routeCheck, { draft: 'Out tomorrow afternoon for a dentist appointment', channel: '#eng', topics })))
    expect(fresh.replyTo).toBeNull()
  })

  it('scores a topic that ends with thanks as settled and an open question as not', async () => {
    const base = { topicId: stagingBill.id, title: stagingBill.title, channel: '#eng', now: NOW }
    const closed = decided(await run((p) => p.decide(tasks.settledScore, { ...base, messages: [...stagingBill.recent, msg('Leo Park', 'Perfect, thanks!', 10)] })))
    expect(closed.score).toBeGreaterThanOrEqual(0.8)
    const open = decided(await run((p) => p.decide(tasks.settledScore, { ...base, messages: [...stagingBill.recent, msg('Leo Park', 'Can we add a budget alert?', 10)] })))
    expect(open.score).toBeLessThan(0.3)
  })

  it('groups three related Main messages and skips the unrelated one', async () => {
    const out = decided(
      await run((p) =>
        p.decide(tasks.groupRun, {
          channelId: C('C0ENG'),
          channel: '#eng',
          messages: [
            { ...msg('Sam Okafor', 'Anyone seeing slow queries on the reports page since the deploy?', 35), ts: '1.000100' },
            { ...msg('Dev Patel', 'Reports page is slow for me too, queries take two seconds.', 33), ts: '1.000200' },
            { ...msg('Priya Raman', 'Lunch at 12:30?', 32), ts: '1.000300' },
            { ...msg('Leo Park', 'The deploy dropped an index, reports queries should be fast again now.', 30), ts: '1.000400' },
          ],
        }),
      ),
    )
    expect(out.group).not.toBeNull()
    expect(out.group!.messageTs).toEqual(['1.000100', '1.000200', '1.000400'])
    expect(out.group!.title.length).toBeGreaterThan(0)
    expect(out.group!.title.length).toBeLessThanOrEqual(60)
  })

  it('gates an outage as urgent and a joke as chatter', async () => {
    const base = { channel: '#incidents', channelKind: 'public' as const, mentionsMe: false, now: NOW }
    const outage = decided(await run((p) => p.decide(tasks.urgencyGate, { ...base, messageTs: '1', sender: 'Jonas Weber', text: 'Checkout is down for 20% of requests, production incident.' })))
    expect(outage.urgent).toBeGreaterThan(0.8)
    const joke = decided(await run((p) => p.decide(tasks.urgencyGate, { ...base, messageTs: '2', sender: 'Priya Raman', text: 'haha the cake was great' })))
    expect(joke.chatter).toBeGreaterThan(0.8)
  })

  it('parses "let maya know …" as a send and a bare search word as no command', async () => {
    const base = { people, channels, topics: [{ id: postgres.id, title: postgres.title, channel: '#eng' }] }
    const send = decided(await run((p) => p.decide(tasks.parseCommand, { ...base, text: 'let maya know the wednesday slot works' })))
    expect(send.command).toEqual({ kind: 'send_dm', userId: 'U0MAYA', text: 'the wednesday slot works' })
    const close = decided(await run((p) => p.decide(tasks.parseCommand, { ...base, text: 'close the postgres thread' })))
    expect(close.command).toEqual({ kind: 'resolve', topicId: postgres.id })
    const search = decided(await run((p) => p.decide(tasks.parseCommand, { ...base, text: 'postgres' })))
    expect(search.command).toBeNull()
  })

  it('builds a waiting-on-you card for an unanswered question and points it at the topic', async () => {
    const out = decided(
      await run((p) =>
        p.decide(tasks.forYou, {
          me: 'Tushar',
          now: NOW,
          topics: [{ id: postgres.id, title: postgres.title, channel: '#eng', unread: 1, messages: [...postgres.recent, msg('Sam Okafor', 'Can you be on call Saturday?', 5)] }],
        }),
      ),
    )
    expect(out.cards).toHaveLength(1)
    expect(out.cards[0]).toMatchObject({ type: 'waiting_on_you', topicId: postgres.id })
    expect(out.cards[0]!.options!.length).toBeGreaterThan(0)
  })
})

describe('FakeAiProvider generation', () => {
  it('titles a thread from its first message in sentence case, within the limit', async () => {
    const title = decided(await run((p) => p.generate(tasks.titleTopic, { topicId: stagingBill.id, channel: '#eng', messages: stagingBill.recent })))
    expect(title).toBe('Staging bill doubled since August')
    expect(title.length).toBeLessThanOrEqual(tasks.titleTopic.maxChars)
  })

  it('writes a catch-up that names the senders and the last message', async () => {
    const text = decided(await run((p) => p.generate(tasks.catchUp, { topicId: stagingBill.id, title: stagingBill.title, channel: '#eng', before: [], unread: stagingBill.recent })))
    expect(text).toBe('2 new from Leo and Jonas. Jonas: We left the perf cluster running after the load test.')
  })
})

const collect = (events: Stream.Stream<ChatEvent>) => Stream.runCollect(events)

describe('FakeAiProvider chat', () => {
  it('turns "tell maya …" into a propose_message tool call and ends with done', async () => {
    const events = await run((p) =>
      collect(p.chat({ now: NOW, viewing: { id: postgres.id, title: postgres.title, channel: '#eng' }, messages: [{ role: 'user', text: 'tell maya the wednesday slot works' }] }, chatTools)),
    )
    const calls = events.filter((e) => e.type === 'toolCall')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ call: { name: 'propose_message', arguments: { topicId: postgres.id, text: 'the wednesday slot works' } } })
    const done = events.at(-1)
    expect(done?.type).toBe('done')
    const text = events.filter((e) => e.type === 'text').map((e) => e.delta).join('')
    expect(text).toBe('Ready to send to Maya.')
    expect(text).not.toMatch(/[*#_`]/)
  })

  it('reads a tool result back as the answer on the next turn', async () => {
    const events = await run((p) =>
      collect(
        p.chat(
          {
            now: NOW,
            viewing: { id: postgres.id, title: postgres.title, channel: '#eng' },
            messages: [
              { role: 'user', text: 'summarize this' },
              { role: 'assistant', text: '', toolCalls: [{ id: 'c1', name: 'read_topic', arguments: { topicId: postgres.id } }] },
              { role: 'tool', callId: 'c1', name: 'read_topic', result: 'Dev Patel: Draft of the Postgres 16 migration plan is in the doc.' },
            ],
          },
          chatTools,
        ),
      ),
    )
    const done = events.at(-1)
    expect(done).toMatchObject({ type: 'done', text: 'Short version: Dev Patel: Draft of the Postgres 16 migration plan is in the doc.' })
  })
})
