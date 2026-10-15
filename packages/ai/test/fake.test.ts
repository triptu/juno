/** Behaviour through the AiProvider interface with the fake, the way the assistant will use it. */
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { AiProvider, FakeAiProvider, tasks, type Decision } from '../src/index'
import { NOW, T, channels, msg, people, postgres, stagingBill } from './fixtures'

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


  it('gates an outage as urgent and a joke as chatter', async () => {
    const base = { channel: '#incidents', channelKind: 'public' as const, mentionsMe: false, now: NOW }
    const outage = decided(await run((p) => p.decide(tasks.urgencyGate, { ...base, messageTs: '1', sender: 'Jonas Weber', text: 'Checkout is down for 20% of requests, production incident.' })))
    expect(outage.notify).toBe(true)
    const joke = decided(await run((p) => p.decide(tasks.urgencyGate, { ...base, messageTs: '2', sender: 'Priya Raman', text: 'haha the cake was great' })))
    expect(joke.notify).toBe(false)
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

})

describe('FakeAiProvider generation', () => {
  it('titles a thread from its first message in sentence case, within the limit', async () => {
    const title = decided(await run((p) => p.generate(tasks.titleTopic, { topicId: stagingBill.id, channel: '#eng', messages: stagingBill.recent })))
    expect(title).toBe('Staging bill doubled since August')
    expect(title.length).toBeLessThanOrEqual(tasks.titleTopic.maxChars)
  })

  it('draws a thread as a recipe in the vocabulary, with the hue and object following the words', async () => {
    const recipe = decided(
      await run((p) =>
        p.generate(tasks.topicArt, {
          kind: 'thread',
          topicId: stagingBill.id,
          title: stagingBill.title,
          channel: '#eng',
          first: stagingBill.recent[0]!.text,
          last: stagingBill.recent[1]!.text,
        }),
      ),
    )
    expect(recipe).toMatch(/^<svg viewBox="0 0 40 40" data-hue="(coral|amber|olive|sage|teal|sky|periwinkle|plum)">\n/)
    expect(recipe).not.toContain('data-confident')
    expect(recipe).toContain('fill="soft"')
    expect(recipe).toContain('fill="accent"')
  })

  it('draws a channel Main from its recent messages and marks a topic with nothing in it as not confident', async () => {
    const main = decided(await run((p) => p.generate(tasks.topicArt, { kind: 'main', topicId: T('m:C0HIRING'), channel: '#hiring', topic: 'Open roles and candidates', recent: ['Rina finished the onsite.'] })))
    expect(main).not.toContain('data-confident')
    const nothing = decided(await run((p) => p.generate(tasks.topicArt, { kind: 'thread', topicId: T('t:C0SOCIAL:1.000001'), title: 'hmm', channel: '#social', first: 'hmm', last: 'yeah' })))
    expect(nothing).toContain('data-confident="false"')
  })

  it('redraws with another hue and another object when told what to avoid', async () => {
    const input = { kind: 'thread' as const, topicId: stagingBill.id, title: stagingBill.title, channel: '#eng', first: stagingBill.recent[0]!.text, last: stagingBill.recent[1]!.text }
    const first = decided(await run((p) => p.generate(tasks.topicArt, input)))
    const hue = /data-hue="(\w+)"/.exec(first)![1]!
    const second = decided(await run((p) => p.generate(tasks.topicArt, { ...input, avoid: { hue, summary: 'coins' } })))
    expect(second).not.toBe(first)
    expect(second).not.toContain(`data-hue="${hue}"`)
  })

  it('answers no decision, not a drawing, when the fake is asked to draw outside the vocabulary', async () => {
    const decision = await run((p) => p.generate(tasks.topicArt, { kind: 'thread', topicId: T('t:C0ENG:1.000002'), title: 'Broken ::invalid-art::', channel: '#eng', first: 'x', last: 'y' }))
    expect(decision).toMatchObject({ _tag: 'NoDecision', reason: 'invalid-output', detail: 'element <text> is not allowed' })
  })

})
