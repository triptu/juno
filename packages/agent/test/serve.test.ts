// The chat as the renderer sees it (plan v3 §12, §13): the agent's renderer RPCs over a port, on the
// real turn engine with the scripted fake provider (`serve-harness.ts`).
import { expect, it } from 'vitest'
import { Effect, Stream } from 'effect'
import { rateLimited, reply } from '@juno/agent-testing'
import { Digest, Revision } from '@juno/agent-cards'
import type { CardId, ChatItem, ChatPage, OpId } from '@juno/agent-contract'
import { ONLINE, run, served as chat } from './serve-harness'
import { deferred, say } from './turns-harness'

const of = <T extends ChatItem['_tag']>(page: ChatPage, tag: T) => page.items.filter((item): item is Extract<ChatItem, { _tag: T }> => item._tag === tag)

it('a sent message shows as the owner bubble, then Juno answers it, and reading it clears the count', async () => {
  const { h, client, pageWhere } = await chat()
  h.fake.script([reply(say('Morning.') + say('Two meetings today.'))])

  const sent = await run(client['agent.chat.send']({ opId: 'op-1' as OpId, text: 'what is on today?' }))
  expect(sent).toMatchObject({ _tag: 'Success', success: { opId: 'op-1' } })

  const answered = await pageWhere((p) => of(p, 'juno').length === 2 && of(p, 'status').length === 0, 'two bubbles and no status')
  expect(answered.banner).toEqual({ _tag: 'none' })
  expect(answered.composerEnabled).toBe(true)
  expect(answered.items.map((item) => item._tag)).toEqual(['day', 'owner', 'newDivider', 'juno', 'juno'])
  expect(of(answered, 'owner')[0]).toMatchObject({ opId: 'op-1', text: 'what is on today?', delivery: { _tag: 'sent' }, group: 'single' })
  expect(of(answered, 'newDivider')[0]).toEqual({ _tag: 'newDivider', count: 2 })
  const [first, second] = of(answered, 'juno')
  expect(first).toMatchObject({ body: [{ _tag: 'text', text: 'Morning.' }], origin: { _tag: 'owner' }, group: 'first', unread: true })
  expect(second).toMatchObject({ body: [{ _tag: 'text', text: 'Two meetings today.' }], group: 'last', unread: true })

  const summary = await Effect.runPromise(client['agent.chat.summary']().pipe(Stream.take(1), Stream.runCollect))
  expect(summary).toEqual([{ unread: 2, busy: false }])

  await run(client['agent.chat.read']({ through: second!.id }))
  const read = await pageWhere((p) => of(p, 'juno').every((item) => !item.unread), 'every bubble read')
  expect(of(read, 'newDivider')).toEqual([])
  const after = await Effect.runPromise(client['agent.chat.summary']().pipe(Stream.take(1), Stream.runCollect))
  expect(after).toEqual([{ unread: 0, busy: false }])
})

it('a reaction shows on its bubble, and a reply quotes what it answers', async () => {
  const { h, client, pageWhere } = await chat()
  h.fake.script([reply(say('The deploy is green.')), reply('<say reply-to="n2">The one on staging.</say>')])
  await run(client['agent.chat.send']({ opId: 'op-1' as OpId, text: 'how is the deploy?' }))
  const answered = await pageWhere((p) => of(p, 'juno').length === 1 && of(p, 'status').length === 0, 'the answer')
  const bubble = of(answered, 'juno')[0]!

  await run(client['agent.chat.react']({ opId: 'op-2' as OpId, target: { _tag: 'bubble', id: bubble.id }, emoji: '👍' }))
  await pageWhere((p) => of(p, 'juno')[0]?.reactions.some((r) => r.by === 'owner' && r.emoji === '👍') === true, 'the thumbs up')

  await run(client['agent.chat.send']({ opId: 'op-3' as OpId, text: 'which deploy?', replyTo: { _tag: 'bubble', id: bubble.id } }))
  const replied = await pageWhere((p) => of(p, 'juno').length === 2 && of(p, 'status').length === 0, 'the second answer')
  expect(of(replied, 'owner')[1]).toMatchObject({ text: 'which deploy?', replyTo: { target: { _tag: 'bubble', id: bubble.id }, preview: 'The deploy is green.' } })
  expect(of(replied, 'juno')[1]).toMatchObject({ body: [{ text: 'The one on staging.' }], replyTo: { target: { _tag: 'owner', opId: 'op-3' }, preview: 'which deploy?' } })
})

it('a failed run shows its ending line, and Try again sends the same message without a second bubble', async () => {
  const { h, client, pageWhere } = await chat()
  h.fake.script([rateLimited(), reply(say('Here it is.'))])
  await run(client['agent.chat.send']({ opId: 'op-1' as OpId, text: 'summarise #eng' }))
  const failed = await pageWhere((p) => of(p, 'ending').length === 1, 'the ending line')
  expect(of(failed, 'ending')[0]).toMatchObject({ ending: { _tag: 'failed', reason: 'provider', retry: 'op-1' } })

  const retried = await run(client['agent.chat.retry']({ opId: 'op-2' as OpId, interruptedOpId: 'op-1' as OpId }))
  expect(retried).toMatchObject({ _tag: 'Success', success: { opId: 'op-2' } })
  // A second click on Try again names the same retry; the message is not sent twice.
  const twice = await run(client['agent.chat.retry']({ opId: 'op-2b' as OpId, interruptedOpId: 'op-1' as OpId }))
  expect(twice).toMatchObject({ _tag: 'Success', success: { opId: 'op-2' } })
  const answered = await pageWhere((p) => of(p, 'juno').length === 1 && of(p, 'status').length === 0, 'the answer')
  expect(of(answered, 'owner').map((item) => item.text)).toEqual(['summarise #eng'])
  expect(answered.items.map((item) => item._tag)).toEqual(['day', 'owner', 'ending', 'newDivider', 'juno'])

  const again = await run(client['agent.chat.retry']({ opId: 'op-3' as OpId, interruptedOpId: 'op-2' as OpId }))
  expect(again).toMatchObject({ _tag: 'Failure', failure: { _tag: 'AgentCommandError', reason: 'invalid' } })
})

it('AI assist off disables the composer and refuses sends; offline makes accepted messages wait', async () => {
  const { h, client, pageWhere, setPresence } = await chat()
  await setPresence({ ...ONLINE, aiEnabled: false })
  const off = await pageWhere((p) => p.banner._tag === 'aiOff', 'the AI off banner')
  expect(off.composerEnabled).toBe(false)
  const refused = await run(client['agent.chat.send']({ opId: 'op-1' as OpId, text: 'hello' }))
  expect(refused).toMatchObject({ _tag: 'Failure', failure: { reason: 'unavailable' } })

  await setPresence({ ...ONLINE, online: false })
  await pageWhere((p) => p.banner._tag === 'offline' && p.composerEnabled, 'the offline banner')

  h.turns.setMode('paused')
  await run(client['agent.chat.send']({ opId: 'op-2' as OpId, text: 'later then' }))
  const waiting = await pageWhere((p) => of(p, 'owner').length === 1, 'the waiting message')
  expect(waiting.banner).toEqual({ _tag: 'paused' })
  expect(of(waiting, 'owner')[0]).toMatchObject({ text: 'later then', delivery: { _tag: 'waiting', for: 'resume' } })
})

it('pages above an anchor and reports what lies on each side', async () => {
  const { h, client, pageWhere } = await chat()
  h.fake.script(Array.from({ length: 3 }, (_, n) => reply(say(`Answer ${n}.`))))
  for (let n = 0; n < 3; n++) {
    await run(client['agent.chat.send']({ opId: `op-${n}` as OpId, text: `question ${n}` }))
    await h.ended(`op-${n}`)
  }
  const full = await pageWhere((p) => of(p, 'juno').length === 3, 'three answers')
  const last = of(full, 'juno')[2]!
  const above = await Effect.runPromise(
    client['agent.chat.page']({ window: { _tag: 'above', anchor: last.id, limit: 2 } }).pipe(Stream.take(1), Stream.runCollect),
  )
  const [snapshot] = above
  expect(snapshot!.page.moreAbove).toBe(true)
  expect(snapshot!.page.moreBelow).toBe(true)
  expect(snapshot!.page.items.map((item) => (item._tag === 'owner' ? item.text : item._tag === 'juno' ? (item.body[0] as { text: string }).text : item._tag))).toEqual([
    'Answer 1.',
    'question 2',
  ])
})

it('answers unavailable for cards, which come with the actions', async () => {
  const { client } = await chat()
  const identity = { cardId: 'c1' as CardId, revision: Revision.make(1), digest: Digest.make('0'.repeat(64)) }
  expect(await run(client['agent.cards.dismiss']({ opId: 'op-1' as OpId, identity }))).toMatchObject({ _tag: 'Failure', failure: { reason: 'unavailable' } })
})

it('a bubble read while its run is live stays read, and in place, when the run ends', async () => {
  const { h, client, pageWhere } = await chat()
  const release = deferred()
  const usage = { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
  h.fake.script([
    // A bubble, then a tool round, so the run goes on after it.
    reply(() => ({
      role: 'assistant', api: 'faux', provider: 'openrouter', model: 'anthropic/claude-sonnet-5.5', usage, stopReason: 'toolUse', timestamp: Date.now(),
      content: [{ type: 'text', text: say('Looking now.') }, { type: 'toolCall', id: 'call-1', name: 'remember', arguments: { text: 'nothing' } }],
    }) as never),
    reply(async () => {
      await release.promise
      return { role: 'assistant', api: 'faux', provider: 'openrouter', model: 'anthropic/claude-sonnet-5.5', usage, stopReason: 'stop', timestamp: Date.now(),
        content: [{ type: 'text', text: say('Done.') }] } as never
    }),
  ])
  await run(client['agent.chat.send']({ opId: 'op-1' as OpId, text: 'check the deploy' }))
  const live = await pageWhere((p) => of(p, 'juno').length === 1 && of(p, 'status').length === 1, 'the first bubble in a live run')
  const first = of(live, 'juno')[0]!
  await run(client['agent.chat.send']({ opId: 'op-2' as OpId, text: 'and staging' }))
  await run(client['agent.chat.read']({ through: first.id }))
  await pageWhere((p) => of(p, 'juno')[0]?.unread === false, 'the first bubble read')

  release.resolve()
  await h.ended('op-1')
  const ended = await pageWhere((p) => of(p, 'juno').length === 2 && of(p, 'status').length === 0, 'the run ended')
  expect(of(ended, 'juno').map((item) => [item.body[0]!.text, item.unread])).toEqual([['Looking now.', false], ['Done.', true]])
  expect(ended.items.filter((item) => item._tag === 'owner' || item._tag === 'juno').map((item) => (item._tag === 'owner' ? item.text : item.body[0]!.text))).toEqual([
    'check the deploy',
    'Looking now.',
    'and staging',
    'Done.',
  ])
})
