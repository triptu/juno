// The chat as the renderer sees it (plan v3 §12, §13): the agent's renderer RPCs over a port, on the
// real turn engine with the scripted fake provider, read through an RPC client of `AgentRpcs` on a
// Node MessageChannel, the same structured-clone port main brokers.
import { MessageChannel, type MessagePort } from 'node:worker_threads'
import { afterEach, expect, it } from 'vitest'
import { Effect, Exit, Layer, Scope, Stream, SubscriptionRef } from 'effect'
import { RpcClient, type RpcClientError, type RpcGroup } from 'effect/rpc'
import { fakeActionHost, rateLimited, reply, TEST_CHANNEL } from '@juno/agent-testing'
import { Digest, Revision } from '@juno/agent-cards'
import { AgentRpcs, type CardId, type ChatItem, type ChatPage, type HostPresence, type OpId } from '@juno/agent-contract'
import { CHAT_MIGRATIONS, hostProtocol, rendererPorts, type ActionsOptions, type HostPort } from '../src/index'
import { rendererServer } from '../src/serve/server'
import { deferred, say, turnsHarness } from './turns-harness'

type Client = RpcClient.RpcClient<RpcGroup.Rpcs<typeof AgentRpcs>, RpcClientError.RpcClientError>
type Presence = typeof HostPresence.Type

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) await cleanup()
})

const nodePort = (port: MessagePort): HostPort => ({
  postMessage: (message) => port.postMessage(message),
  onMessage: (f) => {
    port.on('message', f)
  },
  onClose: (f) => {
    port.on('close', f)
  },
  close: () => port.close(),
})

const ONLINE: Presence = { online: true, aiEnabled: true, quietHours: false, ownerActive: true, accountId: null, thisTopic: null }

/** The engine, served to one renderer client. */
async function chat(options: { readonly actions?: ActionsOptions } = {}) {
  const h = await turnsHarness({ compaction: false, migrations: [CHAT_MIGRATIONS], ...options })
  cleanups.push(h.close)
  const presence = await Effect.runPromise(SubscriptionRef.make<Presence | undefined>(ONLINE))
  let current: Presence | undefined = ONLINE
  const setPresence = (next: Presence) => {
    current = next
    return Effect.runPromise(SubscriptionRef.set(presence, next))
  }
  const transport = rendererPorts()
  const scope = Effect.runSync(Scope.make())
  cleanups.push(() => Effect.runPromise(Scope.close(scope, Exit.void)))
  await Effect.runPromise(
    Layer.buildWithScope(rendererServer(transport, { turns: h.turns, presence: () => current, presenceChanges: SubscriptionRef.changes(presence) }), scope),
  )
  const client = (await Effect.runPromise(
    Effect.gen(function* () {
      const context = yield* Layer.buildWithScope(
        hostProtocol({
          acquire: async () => {
            const { port1, port2 } = new MessageChannel()
            transport.add(nodePort(port2))
            return nodePort(port1)
          },
        }),
        scope,
      )
      return yield* RpcClient.make(AgentRpcs).pipe(Effect.provide(context), Scope.provide(scope))
    }),
  )) as unknown as Client

  // The latest page, followed for the whole test.
  let page: ChatPage | undefined
  const waiters = new Set<() => void>()
  Effect.runFork(
    client['agent.chat.page']({ window: { _tag: 'latest', limit: 50 } }).pipe(
      Stream.runForEach((snapshot) =>
        Effect.sync(() => {
          page = snapshot.page
          for (const wake of waiters) wake()
        }),
      ),
      Effect.ignore,
      Scope.provide(scope),
    ),
  )
  /** The first page that passes `test`. */
  const pageWhere = (test: (page: ChatPage) => boolean, what: string) =>
    new Promise<ChatPage>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no page with ${what}; last: ${JSON.stringify(page?.items)}`)), 15_000)
      const check = () => {
        if (page === undefined || !test(page)) return
        clearTimeout(timer)
        waiters.delete(check)
        resolve(page)
      }
      waiters.add(check)
      check()
    })

  return { h, client, run, pageWhere, setPresence }
}

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(Effect.result(effect))

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

it('a card through the renderer: listed under its run with its binding, one click sends once, and it says Sent', async () => {
  const slack = fakeActionHost()
  const { h, client, pageWhere } = await chat({ actions: { host: slack.host } })
  h.fake.script([
    reply({ type: 'toolCall', id: 'call-send', name: 'send_message', arguments: { messages: [{ topic: `m:${TEST_CHANNEL}`, text: 'On my way.' }] } }),
    reply(say('Here is a draft.')),
  ])
  await run(client['agent.chat.send']({ opId: 'op-1' as OpId, text: 'tell them I am coming' }))
  await h.ended('op-1')
  const [snapshot] = await Effect.runPromise(client['agent.chat.page']({ window: { _tag: 'latest', limit: 50 } }).pipe(Stream.take(1), Stream.runCollect))
  const item = of(snapshot!.page, 'card')[0]!
  expect(item.card).toMatchObject({ _tag: 'sendMessage', status: { _tag: 'open' }, messages: [{ text: 'On my way.', result: { _tag: 'pending' } }] })
  expect(item.unread).toBe(true)
  const [binding] = snapshot!.cards
  expect(binding!.identity.cardId).toBe(item.card.id)

  // A click with another revision is stale, and a dismissal of a card that does not exist is invalid.
  expect(await run(client['agent.cards.approve']({ opId: 'op-2' as OpId, identity: { ...binding!.identity, revision: Revision.make(2) }, children: binding!.children as never })))
    .toMatchObject({ _tag: 'Failure', failure: { reason: 'stale' } })
  const missing = { cardId: 'c1' as CardId, revision: Revision.make(1), digest: Digest.make('0'.repeat(64)) }
  expect(await run(client['agent.cards.dismiss']({ opId: 'op-3' as OpId, identity: missing }))).toMatchObject({ _tag: 'Failure', failure: { reason: 'invalid' } })

  expect(await run(client['agent.cards.approve']({ opId: 'op-4' as OpId, identity: binding!.identity, children: binding!.children as never })))
    .toMatchObject({ _tag: 'Success', success: { opId: 'op-4' } })
  const sent = await pageWhere((p) => of(p, 'card')[0]?.card._tag === 'sendMessage' && 'status' in of(p, 'card')[0]!.card && (of(p, 'card')[0]!.card as { status: { _tag: string } }).status._tag === 'done', 'the card sent')
  expect(of(sent, 'card')[0]!.card).toMatchObject({ status: { _tag: 'done', line: 'Sent' }, messages: [{ result: { _tag: 'sent' } }] })
  expect(slack.messages().map((m) => m.text)).toEqual(['On my way.'])
  // A second click is refused; nothing is sent again.
  expect(await run(client['agent.cards.approve']({ opId: 'op-5' as OpId, identity: binding!.identity, children: binding!.children as never })))
    .toMatchObject({ _tag: 'Failure', failure: { reason: 'stale' } })
  expect(slack.calls).toHaveLength(1)
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
