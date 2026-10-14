// Turns as the owner sees them (plan v3 §5, §8, §13.2): one owner message is one run, steering,
// Stop, every ending, the budget, compaction beside a run, and pins. In-process, through the
// engine's public API, with the scripted fake provider behind the provider guard.
import { afterEach, expect, it } from 'vitest'
import { fakeCatalogue, lostStream, rateLimited, rejectedKey, reply, serverError } from '@juno/agent-testing'
import { dollars } from '../src/index'
import { answer, deferred, fakeHost, HAIKU, textOf, turnsHarness } from './turns-harness'

let h: Awaited<ReturnType<typeof turnsHarness>> | undefined
afterEach(async () => {
  await h?.close()
  h = undefined
})

it('one owner message is one run: dots, the reply streams into one bubble, and the archive and memory hold it', async () => {
  h = await turnsHarness()
  h.fake.script([reply('Morning. Two meetings today.')])
  const op = h.send('what is on today?')
  const ended = await h.ended(op)

  expect(ended.ending).toEqual({ _tag: 'complete' })
  const run = await h.started(op)
  expect(run.origin).toBe('owner')
  // The status bubble shows dots (no status line) until the first token replaces it.
  const tags = h.tags(run.runId)
  expect(tags[0]).toBe('started')
  expect(tags).not.toContain('status')
  expect(tags.at(-1)).toBe('ended')
  const texts = h.events.filter((e) => e._tag === 'text' && e.runId === run.runId)
  expect(texts.at(-1)).toMatchObject({ text: 'Morning. Two meetings today.' })
  expect(h.turns.run()).toBeUndefined()
  expect(h.turns.op(op)?.state).toBe('done')

  // The archive holds the turn once, and the request carried memory before the owner's words.
  expect(h.turns.messages().map((m) => [m.kind, m.text, m.opId])).toEqual([
    ['user', 'what is on today?', op],
    ['juno', 'Morning. Two meetings today.', op],
  ])
  const sent = h.chatRequests()[0]!.context.messages.filter((m) => m.role !== 'system').map(textOf)
  expect(sent[0]).toContain('<remembered>')
  expect(sent.at(-1)).toBe('what is on today?')

  // After the run, the compactor summarizes it into the published view.
  await h.turns.compaction.idle()
  expect(h.turns.memory().covered).toBe(2)
})

it('a steer while the reply is in flight is queued, then joins the same run at its next boundary', async () => {
  h = await turnsHarness()
  const inFlight = deferred()
  const release = deferred()
  h.fake.script([
    reply(async () => {
      inFlight.resolve()
      await release.promise
      return answer('Here is the plan.')
    }),
    reply('Lunch at 1 is in.'),
  ])
  const first = h.send('plan my day')
  await inFlight.promise
  const steer = h.send('also lunch at 1')
  const run = await h.started(first)
  expect(await h.next((e): e is never => e._tag === 'queued')).toMatchObject({ runId: run.runId, opId: steer })
  release.resolve()

  expect((await h.ended(first)).ending).toEqual({ _tag: 'complete' })
  expect(h.events.filter((e) => e._tag === 'started')).toHaveLength(1)
  expect(h.tags(run.runId)).toContain('steered')
  expect(h.turns.op(steer)?.state).toBe('done')
  // pi placed the steer after the first answer, and the second request saw it.
  const second = h.chatRequests()[1]!.context.messages.map(textOf)
  expect(second.slice(-2)).toEqual(['Here is the plan.', 'also lunch at 1'])
  expect(h.events.filter((e) => e._tag === 'text').at(-1)).toMatchObject({ text: 'Here is the plan.\n\nLunch at 1 is in.' })
  expect(h.turns.messages().map((m) => m.text)).toEqual(['plan my day', 'Here is the plan.', 'also lunch at 1', 'Lunch at 1 is in.'])
})

it('Stop ends the run with nothing new started, and a queued steer starts a fresh run', async () => {
  h = await turnsHarness()
  const inFlight = deferred()
  h.fake.script([
    reply((_context, options) => {
      inFlight.resolve()
      return new Promise((_, reject) => options?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))
    }),
    reply('Done with the steer.'),
  ])
  const first = h.send('write a long report')
  await inFlight.promise
  const run = await h.started(first)
  const steer = h.send('and keep it short')
  await h.next((e): e is never => e._tag === 'queued')

  await h.turns.stop(run.runId)
  expect((await h.ended(first)).ending).toEqual({ _tag: 'stopped' })
  expect(h.turns.op(first)?.state).toBe('stopped')

  const fresh = await h.started(steer)
  expect(fresh.runId).not.toBe(run.runId)
  expect((await h.ended(steer)).ending).toEqual({ _tag: 'complete' })
  expect(h.turns.op(steer)?.state).toBe('done')
  expect(h.turns.messages().map((m) => [m.kind, m.text])).toEqual([
    ['user', 'write a long report'],
    ['user', 'and keep it short'],
    ['juno', 'Done with the steer.'],
  ])
})

it('ends a run whose provider call fails with the fixed ending for the cause, and Try again where it applies', async () => {
  h = await turnsHarness({ compaction: false })
  // `billed`: the provider may have done work, so the reservation stays as unknown spend.
  // A refused key or a rate limit did no work, and nothing stays reserved for them.
  const cases = [
    [serverError(503), { _tag: 'failed', reason: 'provider' }, true],
    [rateLimited(), { _tag: 'failed', reason: 'provider' }, false],
    [rejectedKey(), { _tag: 'failed', reason: 'keyRejected' }, false],
    [reply(async () => { throw new Error('fetch failed') }), { _tag: 'failed', reason: 'offline' }, true],
  ] as const
  for (const [step, ending, billed] of cases) {
    const unknown = h.turns.guard.spend.snapshot().unknown
    h.fake.script([step])
    const op = h.send('hello')
    expect((await h.ended(op)).ending).toEqual({ ...ending, retry: op })
    expect(h.turns.op(op)?.state).toBe('failed')
    expect(h.turns.guard.spend.snapshot().unknown > unknown).toBe(billed)
  }
  expect(h.turns.guard.spend.snapshot().reserved).toBe(h.turns.guard.spend.snapshot().unknown)
  // No ending writes model text.
  expect(h.events.filter((e) => e._tag === 'text')).toEqual([])
})

it('blocks a request too large for the model before any provider call', async () => {
  const tiny = { id: 'test/tiny', contextWindow: 16_500, maxTokens: 4_000, cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } }
  h = await turnsHarness({ compaction: false, model: { provider: 'openrouter', modelId: tiny.id }, fake: { catalogue: [...fakeCatalogue, tiny] } })
  h.fake.script([reply('never')])
  const op = h.send('hello')
  expect((await h.ended(op)).ending).toEqual({ _tag: 'blocked', reason: 'tooLarge' })
  expect(h.fake.requests).toHaveLength(0)
  expect(h.turns.op(op)?.state).toBe('failed')
})

it('ends a run blocked by the budget when the cap is reached mid-run, after showing what it did', async () => {
  const slack = fakeHost()
  h = await turnsHarness({ compaction: false, host: slack.host })
  // The first request costs the whole day: the provider counts a million input tokens.
  h.fake.script([
    reply({ type: 'toolCall', id: 'call-1', name: 'slack_topics', arguments: {} }, { usage: { input: 1_000_000, output: 10 } }),
    reply('never sent'),
  ])
  const op = h.send('what topics are open?')
  const ended = await h.ended(op)
  expect(ended.ending).toEqual({ _tag: 'blocked', reason: 'budget' })
  expect(h.turns.op(op)?.state).toBe('failed')
  // The tool round ran and the bubble said so; the second request never reached the provider.
  const run = await h.started(op)
  expect(h.events.filter((e) => e._tag === 'status' && e.runId === run.runId)).toEqual([{ _tag: 'status', runId: run.runId, text: 'Reading topics' }])
  expect(slack.calls()).toBe(1)
  expect(h.fake.pending()).toBe(1)
  const spend = h.turns.guard.spend.snapshot()
  expect(spend.actual).toBeGreaterThanOrEqual(dollars(2))

  // A new run is blocked at once, with no provider call.
  const next = h.send('and now?')
  expect((await h.ended(next)).ending).toEqual({ _tag: 'blocked', reason: 'budget' })
  expect(h.fake.pending()).toBe(1)
})

it('ends a run whose stream was lost as interrupted, keeps its spend as unknown, and Try again runs it once more', async () => {
  h = await turnsHarness({ compaction: false })
  h.fake.script([lostStream('Partial answer that never finished.', { afterChars: 8 }), reply('The full answer.')])
  const op = h.send('explain the outage')
  expect((await h.ended(op)).ending).toEqual({ _tag: 'interrupted', retry: op })
  expect(h.turns.op(op)?.state).toBe('interrupted')
  expect(h.events.some((e) => e._tag === 'text' && e.text.startsWith('Partial'))).toBe(true)
  expect(h.turns.guard.spend.snapshot().unknown).toBeGreaterThan(0)

  expect(h.turns.retry({ opId: 'op-retry', interruptedOpId: op })._tag).toBe('accepted')
  expect((await h.ended('op-retry')).ending).toEqual({ _tag: 'complete' })
  expect(h.turns.messages().filter((m) => m.kind === 'user').map((m) => [m.text, m.opId])).toEqual([
    ['explain the outage', op],
    ['explain the outage', 'op-retry'],
  ])
  // A retry is only for an interrupted or failed owner send.
  expect(h.turns.retry({ opId: 'op-again', interruptedOpId: 'op-retry' })).toEqual({ _tag: 'refused', reason: 'notRetryable' })
})

it('compacts in the background without holding up the next turn', async () => {
  const hold = deferred()
  let held = 0
  h = await turnsHarness({
    // Compaction requests wait for `hold`; chat requests go straight through.
    transport: (fake) => ({
      getProviders: () => fake.models.getProviders(),
      getModel: (provider: string, id: string) => fake.models.getModel(provider, id),
      streamSimple: (model: { id: string }, context: unknown, options: unknown) => {
        const inner = () => fake.models.streamSimple(model as never, context as never, options as never)
        if (model.id !== HAIKU.modelId) return inner()
        return { async *[Symbol.asyncIterator]() { held += 1; await hold.promise; yield* inner() } }
      },
    }) as never,
  })
  // A message over the 512-byte node target needs the model, not a copy.
  const long = `Notes from the planning meeting. ${'We agreed to ship the sidebar first and the search after it. '.repeat(40)}`
  h.fake.script([reply('Noted.'), reply('Yes, the sidebar ships first.')])
  const first = h.send(long)
  await h.ended(first)
  await waitUntil(() => held > 0)
  expect(h.turns.compaction.state()).toBe('running')

  const second = h.send('what ships first?')
  expect((await h.ended(second)).ending).toEqual({ _tag: 'complete' })
  expect(h.turns.compaction.state()).toBe('running')
  expect(h.turns.memory().covered).toBe(0)

  hold.resolve()
  await h.turns.compaction.idle()
  expect(h.turns.memory().covered).toBeGreaterThanOrEqual(2)
  expect(h.turns.guard.spend.snapshot().compaction).toBeGreaterThan(0)
})

it('remembers words from this turn only, pins an owner message, checks pin versions, and sends the pins with every request', async () => {
  h = await turnsHarness({ compaction: false })
  h.fake.script([
    reply({ type: 'toolCall', id: 'call-1', name: 'remember', arguments: { quote: 'my sister is called Ada' } }),
    reply('I will remember that.'),
  ])
  const first = h.send('Please remember: my sister is called Ada.')
  const run = await h.started(first)
  await h.ended(first)
  expect(h.events.find((e) => e._tag === 'remembered')).toMatchObject({ runId: run.runId, text: 'my sister is called Ada' })
  const [remembered] = h.turns.pins.active().active
  expect(remembered).toMatchObject({ kind: 'span', text: 'my sister is called Ada', version: 1 })

  // In a later turn the same words are not admitted: they are not from this run's owner messages.
  h.fake.script([
    reply({ type: 'toolCall', id: 'call-2', name: 'remember', arguments: { quote: 'my sister is called Ada' } }),
    reply('Already noted.'),
  ])
  const second = h.send('What do you remember?')
  await h.ended(second)
  expect(h.events.filter((e) => e._tag === 'remembered')).toHaveLength(1)
  const refusal = h.chatRequests().at(-1)!.context.messages.filter((m) => m.role === 'toolResult').map(textOf).at(-1)
  expect(refusal).toMatch(/^Nothing was remembered/)

  // "Remember this" on an owner message, then an edit that names the version it replaces.
  h.fake.script([reply('OK.')])
  const third = h.send('I prefer short answers.')
  await h.ended(third)
  const message = h.turns.messages().find((m) => m.opId === third && m.kind === 'user')!
  const pinned = h.turns.pins.pinMessage({ messageId: message.id })
  expect(pinned).toMatchObject({ _tag: 'changed', pin: { text: 'I prefer short answers.' } })
  const before = h.turns.pins.active().revision
  const edited = h.turns.pins.edit({ id: remembered!.id, version: 1 }, 'My sister is Ada Lovelace.')
  expect(edited).toMatchObject({ _tag: 'changed', pin: { kind: 'owner', text: 'My sister is Ada Lovelace.' } })
  expect(h.turns.pins.active().revision).toBe(before + 1)
  expect(h.turns.pins.edit({ id: remembered!.id, version: 1 }, 'stale')).toEqual({ _tag: 'refused', reason: 'conflict' })

  h.fake.script([reply('Ada.')])
  const fourth = h.send('Who is my sister?')
  await h.ended(fourth)
  const memory = textOf(h.chatRequests().at(-1)!.context.messages.find((m) => m.role !== 'system'))
  expect(memory).toContain('<remembered>\nI prefer short answers.\nMy sister is Ada Lovelace.\n</remembered>')
})

async function waitUntil(test: () => boolean, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (!test()) {
    if (Date.now() > deadline) throw new Error('timed out')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}
