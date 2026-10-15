// Turns as the owner sees them (plan v3 §5, §8, §13.2): one owner message is one run, messages
// that join a run at its next step, every ending, the budget, compaction beside a run, and pins. In-process, through the
// engine's public API, with the scripted fake provider behind the provider guard.
import { afterEach, expect, it } from 'vitest'
import { fakeCatalogue, lostStream, rateLimited, rejectedKey, reply, serverError } from '@juno/agent-testing'
import type { BubbleId } from '@juno/agent-contract'
import { dollars, type HostReads } from '../src/index'
import { answer, deferred, fakeHost, HAIKU, say, textOf, toolCall, turnsHarness } from './turns-harness'

let h: Awaited<ReturnType<typeof turnsHarness>> | undefined
afterEach(async () => {
  await h?.close()
  h = undefined
})

it('one owner message is one run: dots, then the bubble whole, and the archive and memory hold what the model read and wrote', async () => {
  h = await turnsHarness()
  h.fake.script([reply(say('Morning. Two meetings today.'))])
  const op = h.send('what is on today?')
  const ended = await h.ended(op)

  expect(ended.ending).toEqual({ _tag: 'complete' })
  const run = await h.started(op)
  expect(run.origin).toBe('owner')
  // The status bubble shows dots (no status line) until the bubble takes its place.
  const tags = h.tags(run.runId)
  expect(tags[0]).toBe('started')
  expect(tags).not.toContain('status')
  expect(tags.at(-1)).toBe('ended')
  expect(h.bubbles()).toEqual([['Morning. Two meetings today.']])
  expect(h.events.find((e) => e._tag === 'bubble')).toMatchObject({ runId: run.runId, id: `${run.runId}:0` })
  expect(h.turns.run()).toBeUndefined()
  expect(h.turns.op(op)?.state).toBe('done')

  // The archive holds the turn once, and the request carried memory before the owner's words.
  expect(h.turns.messages().map((m) => [m.kind, m.text, m.opId])).toEqual([
    ['user', '<message id="n1">what is on today?</message>', op],
    ['juno', '<say>Morning. Two meetings today.</say>', op],
  ])
  const sent = h.chatRequests()[0]!.context.messages.filter((m) => m.role !== 'system').map(textOf)
  expect(sent[0]).toContain('<remembered>')
  expect(sent.at(-1)).toBe('<message id="n1">what is on today?</message>')

  // After the run, the compactor summarizes it into the published view.
  await h.turns.compaction.idle()
  expect(h.turns.memory().covered).toBe(2)
})

it('a message sent while Juno is answering joins the same run at its next step, and the reply acknowledges it', async () => {
  h = await turnsHarness()
  const inFlight = deferred()
  const release = deferred()
  h.fake.script([
    reply(async () => {
      inFlight.resolve()
      await release.promise
      return answer(say('Here is the plan.'))
    }),
    reply(say('Lunch at 1 is in.')),
  ])
  const first = h.send('plan my day')
  await inFlight.promise
  const steer = h.send('also lunch at 1')
  const run = await h.started(first)
  release.resolve()

  expect((await h.ended(first)).ending).toEqual({ _tag: 'complete' })
  expect(h.events.filter((e) => e._tag === 'started')).toHaveLength(1)
  expect(await h.next((e): e is never => e._tag === 'steered')).toMatchObject({ runId: run.runId, opId: steer })
  expect(h.turns.op(steer)?.state).toBe('done')
  // pi placed the message after the first answer, and the second request saw it.
  const second = h.chatRequests()[1]!.context.messages.map(textOf)
  expect(second.slice(-2)).toEqual([say('Here is the plan.'), '<message id="n2">also lunch at 1</message>'])
  expect(h.bubbles()).toEqual([['Here is the plan.'], ['Lunch at 1 is in.']])
})

it('messages sent during a tool call join right after it, together, before Juno writes its answer', async () => {
  const searched = deferred()
  const release = deferred()
  const page = { messages: [] as never[] }
  const host: HostReads = {
    search: async () => {
      searched.resolve()
      await release.promise
      return page
    },
    history: async () => page,
    replies: async () => page,
    topics: async () => ({ topics: [] }),
    person: async (id) => ({ id, name: 'maya', displayName: 'Maya' }),
  }
  h = await turnsHarness({ host })
  h.fake.script([reply(toolCall('slack_search', { query: 'lunch' })), reply(say('Two vegetarian places near the office, both open at 1.'))])
  const first = h.send('find lunch')
  await searched.promise
  const steers = [h.send('only vegetarian'), h.send('near the office')]
  release.resolve()

  expect((await h.ended(first)).ending).toEqual({ _tag: 'complete' })
  expect(h.events.filter((e) => e._tag === 'started')).toHaveLength(1)
  expect(steers.map((op) => h!.turns.op(op)?.state)).toEqual(['done', 'done'])
  // One request after the tool round, and it carried the result and both messages.
  expect(h.chatRequests()).toHaveLength(2)
  const second = h.chatRequests()[1]!.context.messages
  expect(second.slice(-3).map((m) => m.role)).toEqual(['toolResult', 'user', 'user'])
  expect(second.slice(-2).map(textOf)).toEqual(['<message id="n2">only vegetarian</message>', '<message id="n3">near the office</message>'])
  expect(h.bubbles()).toEqual([['Two vegetarian places near the office, both open at 1.']])
})

it('gives each Slack message a run reads one handle, and resolves only those handles in a bubble', async () => {
  const review = { channelId: 'C0ENG', ts: '1.000001', senderId: 'U0MAYA', senderName: 'Maya Chen', channelName: '#eng', text: 'Review moved to Thursday.' }
  const room = { channelId: 'C0ENG', ts: '1.000002', senderId: 'U0SAM', text: 'Room 4 is booked.' }
  let searches = 0
  const host: HostReads = {
    search: async () => ({ messages: (++searches === 1 ? [review] : [room, review]) as never }),
    history: async () => ({ messages: [] }),
    replies: async () => ({ messages: [] }),
    topics: async () => ({ topics: [] }),
    person: async (id) => ({ id, name: 'maya', displayName: 'Maya' }),
  }
  h = await turnsHarness({ compaction: false, host })
  h.fake.script([
    reply({ type: 'toolCall', id: 'call-1', name: 'slack_search', arguments: { query: 'review' } }),
    reply({ type: 'toolCall', id: 'call-2', name: 'slack_search', arguments: { query: 'room' } }),
    reply('<say>It moved to <src m="m1">Thursday</src>, in <src m="m2">room 4</src>, says <src m="m9">Maya</src>.</say>'),
  ])
  const op = h.send('when is the review?')
  expect((await h.ended(op)).ending).toEqual({ _tag: 'complete' })

  const results = h.chatRequests()[2]!.context.messages.filter((m) => m.role === 'toolResult').map(textOf)
  expect(results).toEqual([
    'm1 #eng (C0ENG) ts 1.000001, Maya Chen: Review moved to Thursday.',
    'm2 C0ENG ts 1.000002, U0SAM: Room 4 is booked.\nm1 #eng (C0ENG) ts 1.000001, Maya Chen: Review moved to Thursday.',
  ])
  const bubble = h.events.find((e) => e._tag === 'bubble')
  expect(bubble).toMatchObject({
    text: 'It moved to Thursday, in room 4, says Maya.',
    body: [
      { text: 'It moved to ' },
      { text: 'Thursday', source: { channelId: 'C0ENG', ts: '1.000001', place: '#eng' } },
      { text: ', in ' },
      { text: 'room 4', source: { channelId: 'C0ENG', ts: '1.000002' } },
      { text: ', says ' },
      { text: 'Maya' },
      { text: '.' },
    ],
  })
})

it('"stop" is a message like any other: Juno reads it at its next step and the run ends normally', async () => {
  h = await turnsHarness()
  const inFlight = deferred()
  const release = deferred()
  h.fake.script([
    reply(async () => {
      inFlight.resolve()
      await release.promise
      return answer('Outlining the report first.')
    }),
    reply(say('Stopped there. I had the outline.')),
  ])
  const first = h.send('write a long report')
  await inFlight.promise
  const stop = h.send('stop')
  release.resolve()

  expect((await h.ended(first)).ending).toEqual({ _tag: 'complete' })
  expect(h.events.filter((e) => e._tag === 'started')).toHaveLength(1)
  expect(h.turns.op(stop)?.state).toBe('done')
  expect(h.chatRequests()[1]!.context.messages.map(textOf).at(-1)).toBe('<message id="n2">stop</message>')
  expect(h.bubbles()).toEqual([['Stopped there. I had the outline.']])
})

it('a message sent while a request fails starts the next run instead of waiting for another message', async () => {
  h = await turnsHarness({ compaction: false })
  const inFlight = deferred()
  const release = deferred()
  h.fake.script([
    reply(async () => {
      inFlight.resolve()
      await release.promise
      throw new Error('fetch failed')
    }),
    reply(say('Here is the short version.')),
  ])
  const first = h.send('write a long report')
  await inFlight.promise
  const run = await h.started(first)
  const second = h.send('keep it short')
  release.resolve()

  expect((await h.ended(first)).ending).toEqual({ _tag: 'failed', reason: 'offline', retry: first })
  const fresh = await h.started(second)
  expect(fresh.runId).not.toBe(run.runId)
  expect((await h.ended(second)).ending).toEqual({ _tag: 'complete' })
  expect(h.turns.messages().map((m) => m.kind)).toEqual(['user', 'user', 'juno'])
  expect(h.bubbles()).toEqual([['Here is the short version.']])
})

it('only text the model marks reaches the chat: bubbles whole and in order, a reply, a reaction, and nothing else', async () => {
  h = await turnsHarness()
  h.fake.script([
    reply('The owner wants two things. I will answer both.<say>Lunch is at 1.</say>Checking the second.'
      + '<say reply-to="n1">And the deploy is green.</say><react to="n1">👌</react> Done.'),
  ])
  const op = h.send('when is lunch, and is the deploy green?')
  expect((await h.ended(op)).ending).toEqual({ _tag: 'complete' })

  expect(h.bubbles()).toEqual([['Lunch is at 1.'], ['And the deploy is green.', op]])
  expect(h.events.filter((e) => e._tag === 'reaction')).toEqual([
    { _tag: 'reaction', target: { kind: 'owner', id: op }, by: 'juno', emoji: '👌' },
  ])
  // Nothing outside the blocks left the agent.
  const shown = JSON.stringify(h.events.filter((e) => e._tag !== 'ended'))
  for (const hidden of ['The owner wants', 'Checking the second', 'Done.']) expect(shown).not.toContain(hidden)
})

it('a reply to a Juno bubble carries that bubble to the model in full', async () => {
  h = await turnsHarness()
  h.fake.script([reply(say('The deploy is green on staging. Production goes at 4.')), reply(say('The staging deploy from this morning.'))])
  const first = h.send('status?')
  const run = await h.started(first)
  await h.ended(first)

  const second = h.send('which deploy?', { replyTo: { _tag: 'bubble', id: `${run.runId}:0` as BubbleId } })
  await h.ended(second)
  expect(h.chatRequests()[1]!.context.messages.map(textOf).at(-1)).toBe(
    '<message id="n2"><quote from="juno">The deploy is green on staging. Production goes at 4.</quote>which deploy?</message>',
  )
  // The owner's own words are what a pin takes, not the quote.
  const message = h.turns.messages().find((m) => m.opId === second && m.kind === 'user')!
  expect(h.turns.pins.pinMessage({ messageId: message.id })).toMatchObject({ _tag: 'changed', pin: { text: 'which deploy?' } })
})

it('a message sent beside a topic names the topic and the selection, taints its run, and a pin takes only the words', async () => {
  h = await turnsHarness()
  h.fake.script([reply(say('It is settled.')), reply(say('Maya runs it.'))])
  const eng = { channelId: 'C1', name: 'eng', kindLabel: 'Public channel', tint: 'public' } as const
  const panel = h.send('is this settled?', {
    context: { _tag: 'topic', topicId: 'T1', title: 'Postgres "16" plan', place: eng, kind: 'thread', visible: { from: '1.1', to: '1.9' }, selection: { text: 'ship <it> Monday', sender: 'Maya Chen' } },
  })
  await h.ended(panel)
  expect(h.chatRequests()[0]!.context.messages.map(textOf).at(-1)).toBe(
    '<message id="n1"><about topic="T1" title="Postgres &quot;16&quot; plan" channel="#eng" channel-id="C1" kind="thread" visible="1.1..1.9">' +
      '<selection from="Maya Chen">ship &lt;it&gt; Monday</selection></about>is this settled?</message>',
  )
  const person = h.send('who is she?', { context: { _tag: 'person', userId: 'U7', name: 'Maya Chen' } })
  await h.ended(person)
  expect(h.chatRequests()[1]!.context.messages.map(textOf).at(-1)).toBe('<message id="n2"><about person="U7" name="Maya Chen"/>who is she?</message>')

  const clean = h.turns.store.db.prepare('SELECT op_id AS opId, clean FROM runs ORDER BY started_at').all()
  expect(clean).toEqual([
    { opId: panel, clean: 0 },
    { opId: person, clean: 1 },
  ])
  const message = h.turns.messages().find((m) => m.opId === panel && m.kind === 'user')!
  expect(h.turns.pins.pinMessage({ messageId: message.id })).toMatchObject({ _tag: 'changed', pin: { text: 'is this settled?' } })
})

it('a reaction other than a thumbs up reaches the model at its next step, with the bubble it is on', async () => {
  h = await turnsHarness()
  const inFlight = deferred()
  const release = deferred()
  h.fake.script([
    reply(say('Lunch is at 1.')),
    reply(async () => {
      inFlight.resolve()
      await release.promise
      return answer('Looking.')
    }),
    reply(say('Glad that works.')),
  ])
  const first = h.send('when is lunch?')
  const firstRun = await h.started(first)
  await h.ended(first)
  const second = h.send('and the standup?')
  await inFlight.promise
  const reaction = h.react(`${firstRun.runId}:0`, '🎉')
  release.resolve()

  expect((await h.ended(second)).ending).toEqual({ _tag: 'complete' })
  expect(h.events.filter((e) => e._tag === 'started')).toHaveLength(2)
  expect(h.turns.op(reaction)?.state).toBe('done')
  expect(h.chatRequests()[2]!.context.messages.map(textOf).at(-1)).toBe(
    '<reaction id="n3" emoji="🎉"><quote from="juno">Lunch is at 1.</quote></reaction>',
  )
  expect(h.events.find((e) => e._tag === 'reaction')).toEqual({
    _tag: 'reaction', target: { kind: 'bubble', id: `${firstRun.runId}:0` }, by: 'owner', emoji: '🎉',
  })
})

it('a thumbs up is only recorded: it starts no run and the model never sees it', async () => {
  h = await turnsHarness({ compaction: false })
  h.fake.script([reply(say('Lunch is at 1.'))])
  const first = h.send('when is lunch?')
  const run = await h.started(first)
  await h.ended(first)

  const thumbs = h.react(`${run.runId}:0`, '👍')
  await h.turns.idle()
  expect(h.events.filter((e) => e._tag === 'started')).toHaveLength(1)
  expect(h.chatRequests()).toHaveLength(1)
  expect(h.turns.op(thumbs)).toBeUndefined()
  expect(h.events.filter((e) => e._tag === 'reaction').map((e) => e.emoji)).toEqual(['👍'])
  // Removing it is recorded the same way.
  h.react(`${run.runId}:0`, null)
  await h.turns.idle()
  expect(h.chatRequests()).toHaveLength(1)
  expect(h.events.filter((e) => e._tag === 'reaction').map((e) => e.emoji)).toEqual(['👍', null])
})

it('a reaction the model chooses to ignore shows nothing', async () => {
  h = await turnsHarness({ compaction: false })
  h.fake.script([reply(say('Lunch is at 1.')), reply('A smile on a plain answer. Nothing to add.')])
  const first = h.send('when is lunch?')
  const run = await h.started(first)
  await h.ended(first)

  const reaction = h.react(`${run.runId}:0`, '🙂')
  const second = await h.started(reaction)
  expect((await h.ended(reaction)).ending).toEqual({ _tag: 'complete' })
  expect(h.tags(second.runId)).toEqual(['started', 'ended'])
  expect(h.bubbles()).toEqual([['Lunch is at 1.']])
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
  // No ending writes a bubble.
  expect(h.bubbles()).toEqual([])
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
  h.fake.script([lostStream('<say>Partial answer.</say> and then', { afterChars: 30 }), reply(say('The full answer.'))])
  const op = h.send('explain the outage')
  expect((await h.ended(op)).ending).toEqual({ _tag: 'interrupted', retry: op })
  expect(h.turns.op(op)?.state).toBe('interrupted')
  // A bubble closed before the stream was lost was shown.
  expect(h.bubbles()).toEqual([['Partial answer.']])
  expect(h.turns.guard.spend.snapshot().unknown).toBeGreaterThan(0)

  expect(h.turns.retry({ opId: 'op-retry', interruptedOpId: op })._tag).toBe('accepted')
  expect((await h.ended('op-retry')).ending).toEqual({ _tag: 'complete' })
  expect(h.turns.messages().filter((m) => m.kind === 'user').map((m) => [m.text, m.opId])).toEqual([
    ['<message id="n1">explain the outage</message>', op],
    ['<message id="n2">explain the outage</message>', 'op-retry'],
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
