/**
 * The AgentHost port end to end (ADR 0012, plan v3 §6.3): the real engine
 * on an in-process fake Slack, and the agent's own port client
 * (`@juno/agent`'s `hostProtocol`) on a Node MessageChannel, the same
 * structured-clone port main brokers between the two utility processes.
 * An agent crash is its port closing; a new agent connects a new port.
 */
import { rm } from 'node:fs/promises'
import { MessageChannel, type MessagePort } from 'node:worker_threads'
import { afterEach, describe, expect, it } from 'bun:test'
import { Effect, Exit, Layer, Schema, Scope, Stream } from 'effect'
import { RpcClient, type RpcClientError, type RpcGroup } from 'effect/rpc'
import { actionDigest, AgentHostRpcs, HostDispatch, HostPresence, HostTopicId, type HostSendState } from '@juno/agent-contract'
import { hostProtocol, startAgent, type HostConnection, type HostPort } from '@juno/agent'
import { forgedSendReceipt, hostileMessages, HOSTILE_USER } from '@juno/agent-testing'
import { SELF_ID } from '@juno/fake-slack'
import { agentWritesApprove, messagesRetry, prefsSet } from '@juno/contract'
import { runCommand, topicAtom } from '@juno/state'
import { memoryTransport, type MessagePortLike } from '../src/protocol/transport'
import { startTestEngine, waitFor, type RunningEngine } from './harness'
import { bootedEngine } from './scenario'

const CHANNEL = 'C0ENG'
const engines: Array<RunningEngine> = []
const agents: Array<{ readonly close: () => Promise<void> }> = []

afterEach(async () => {
  for (const agent of agents.splice(0)) await agent.close()
  for (const engine of engines.splice(0)) await engine.stop()
})

type Client = RpcClient.RpcClient<RpcGroup.Rpcs<typeof AgentHostRpcs>, RpcClientError.RpcClientError>

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

/** An agent: a port client of the full group. `close` is the agent process ending: its port closes. */
async function connectAgent(transport: ReturnType<typeof memoryTransport>) {
  const connection: HostConnection = {
    acquire: async () => {
      const { port1, port2 } = new MessageChannel()
      transport.add(port2 as unknown as MessagePortLike)
      return nodePort(port1)
    },
  }
  const scope = Effect.runSync(Scope.make())
  const client = await Effect.runPromise(
    Effect.gen(function* () {
      const context = yield* Layer.buildWithScope(hostProtocol(connection), scope)
      return yield* RpcClient.make(AgentHostRpcs).pipe(Effect.provide(context), Scope.provide(scope))
    }),
  )
  const agent = { client: client as unknown as Client, close: () => Effect.runPromise(Scope.close(scope, Exit.void)) }
  agents.push(agent)
  return agent
}

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(Effect.result(effect))
const ok = async <A, E>(effect: Effect.Effect<A, E>): Promise<A> => {
  const result = await run(effect)
  if (result._tag === 'Failure') throw new Error(`expected success, got ${JSON.stringify(result.failure)}`)
  return result.success
}
const failure = async <A, E>(effect: Effect.Effect<A, E>): Promise<E> => {
  const result = await run(effect)
  if (result._tag === 'Success') throw new Error(`expected a failure, got ${JSON.stringify(result.success)}`)
  return result.failure
}

/** The first presence that names an account. */
const presence = (client: Client, until: (p: typeof HostPresence.Type) => boolean = (p) => p.accountId !== null) =>
  ok(client['host.presence']().pipe(Stream.filter(until), Stream.take(1), Stream.runHead, Effect.map((p) => p._tag === 'Some' ? p.value : undefined)))

/** The agent itself (`startAgent`) on a new port, without the turn engine. */
async function startRealAgent(transport: ReturnType<typeof memoryTransport>, agentDir: string) {
  const connection: HostConnection = {
    acquire: async () => {
      const { port1, port2 } = new MessageChannel()
      transport.add(port2 as unknown as MessagePortLike)
      return nodePort(port1)
    },
  }
  const handle = await startAgent({ agentDir, e2e: false }, connection)
  agents.push({ close: handle.stop })
  return handle
}

async function hostWithAgent(writes: 'enabled' | 'disabled') {
  const transport = memoryTransport()
  const engine = await bootedEngine(engines, { agent: { transport, writes } })
  const agent = await connectAgent(transport)
  const account = (await presence(agent.client))!.accountId!
  return { engine, transport, agent, account }
}

let sequence = 0
/** A dispatch as the agent's dispatcher makes it after consuming the authorization: the payload and its digest. */
function dispatchOf(n: number, payload: Record<string, unknown>) {
  const hex = n.toString(16).padStart(12, '0')
  const decoded = Schema.decodeUnknownSync(HostDispatch)({
    actionId: `0190a000-0000-7000-8000-${hex}`,
    authorizationId: `auth-${n}`,
    attemptId: `attempt-${n}`,
    digest: '0'.repeat(64),
    mode: 'single-attempt',
    payload,
  })
  return { ...decoded, digest: actionDigest(decoded.payload) }
}

/** A dispatch of one Slack send. */
function send(account: string, text: string, ids: { readonly n?: number } = {}) {
  return dispatchOf(ids.n ?? ++sequence, {
    connection_id: 'slack',
    account_id: account,
    destination_ids: [CHANNEL],
    tool: 'slack_send',
    schema_hash: '1'.repeat(64),
    args: { channelId: CHANNEL, text },
    preconditions: {},
    ops: [],
  })
}

/** The owner's click on these dispatches' actions, as the renderer records it before it tells the agent. */
async function approve(engine: RunningEngine, ...dispatches: ReadonlyArray<typeof HostDispatch.Type>) {
  const exit = await runCommand(engine.registry, agentWritesApprove, { children: dispatches.map((d) => ({ actionId: d.actionId, digest: d.digest })) })
  expect(exit._tag).toBe('Success')
}

const posted = (engine: RunningEngine, clientMsgId: string) => engine.fake.messages(CHANNEL).filter((m) => m.client_msg_id === clientMsgId)

describe('the AgentHost port', () => {
  it('resolves locally with writes disabled, only on a click, restores Undo, and never reapplies a repeated dispatch', async () => {
    const { engine, agent: { client }, account } = await hostWithAgent('disabled')
    const topics = await ok(client['host.topics.list']({ limit: 20 }))
    const topic = topics.topics[0]!
    const base = send(account, '')
    const dispatch = dispatchOf(++sequence, { ...base.payload, tool: 'topics_resolve', destination_ids: [topic.topicId], args: { topicIds: [topic.topicId] } })
    expect(await failure(client['host.topics.resolve'](dispatch))).toMatchObject({ reason: 'rejected' })
    expect((await ok(client['host.topics.get']({ topicId: HostTopicId.make(topic.topicId) }))).resolved).toBe(false)
    await approve(engine, dispatch)
    const result = await ok(client['host.topics.resolve'](dispatch))
    expect(result._tag).toBe('done')
    expect((await ok(client['host.topics.get']({ topicId: HostTopicId.make(topic.topicId) }))).resolved).toBe(true)
    await ok(client['host.topics.undoResolve']({ accountId: account, actionId: dispatch.actionId }))
    await ok(client['host.topics.undoResolve']({ accountId: account, actionId: dispatch.actionId }))
    expect(await ok(client['host.topics.resolve'](dispatch))).toEqual(result)
    expect((await ok(client['host.topics.get']({ topicId: HostTopicId.make(topic.topicId) }))).resolved).toBe(false)
    const bad = dispatchOf(++sequence, { ...dispatch.payload, args: { topicIds: [topic.topicId, 'missing'] }, destination_ids: [topic.topicId, 'missing'] })
    await approve(engine, bad)
    expect(await failure(client['host.topics.resolve'](bad))).toMatchObject({ reason: 'rejected' })
    expect((await ok(client['host.topics.get']({ topicId: HostTopicId.make(topic.topicId) }))).resolved).toBe(false)
  })

  it('lists, creates, updates, deletes and undoes local views while Slack writes are disabled', async () => {
    const { engine, agent: { client }, account } = await hostWithAgent('disabled')
    const directory = await ok(client['host.slack.channels']({ accountId: account, pattern: '*E*', limit: 1 }))
    expect(directory.channels).toHaveLength(1)
    const remaining = directory.next === undefined ? [] : (await ok(client['host.slack.channels']({ accountId: account, pattern: '*e*', cursor: directory.next, limit: 200 }))).channels
    expect([...directory.channels, ...remaining].some((channel) => channel.id === CHANNEL)).toBe(true)
    expect(await ok(client['host.slack.channels']({ accountId: account, pattern: 'no-such-channel-*', limit: 200 }))).toEqual({ channels: [] })
    const slackCalls = engine.fake.calls.length
    const view = { name: 'Bots', icon: 'robot', channels: [CHANNEL], keepOutOfAll: true }
    const created = await ok(client['host.views.create']({ accountId: account, view }))
    // The built-in Automated view comes first: the first sync made it.
    const own = async () => (await ok(client['host.views.list']({ accountId: account }))).filter((each) => each.id !== 'automated')
    expect(await own()).toEqual([{ ...view, id: created.id, position: 1 }])
    const updated = await ok(client['host.views.update']({ accountId: account, id: created.id, view: { ...view, name: 'Alerts', channels: [] } }))
    expect(await failure(client['host.views.undo']({ accountId: account, undo: created.undo }))).toMatchObject({ reason: 'stale' })
    await ok(client['host.views.undo']({ accountId: account, undo: updated.undo }))
    const deleted = await ok(client['host.views.delete']({ accountId: account, id: created.id }))
    expect(await own()).toEqual([])
    await ok(client['host.views.undo']({ accountId: account, undo: deleted.undo }))
    expect(await own()).toEqual([{ ...view, id: created.id, position: 1 }])
    await ok(client['host.views.undo']({ accountId: account, undo: created.undo }))
    await ok(client['host.views.undo']({ accountId: account, undo: created.undo }))
    expect(await own()).toEqual([])
    expect(await failure(client['host.views.update']({ accountId: account, id: 'missing', view }))).toMatchObject({ reason: 'notFound' })
    expect(await failure(client['host.views.create']({ accountId: account, view: { ...view, icon: 'invalid' } }))).toMatchObject({ reason: 'rejected' })
    expect(await failure(client['host.views.create']({ accountId: Schema.decodeUnknownSync(HostPresence.fields.accountId)('other')!, view }))).toMatchObject({ reason: 'stale' })
    expect(engine.fake.calls).toHaveLength(slackCalls)
  })

  it('serves Slack and topic reads from the store, hostile text as it is', async () => {
    const { engine, agent, account } = await hostWithAgent('disabled')
    for (const { message } of hostileMessages.filter((f) => f.message.threadTs === undefined && f.name !== 'loneSurrogate')) {
      engine.fake.injectMessage({ channel: CHANNEL, user: 'U0MAYA', text: message.text })
    }
    const { client } = agent

    expect(await ok(client['host.hello']({ protocol: 2 }))).toEqual({ host: 'juno', protocol: 2 })
    expect(await ok(client['host.hello']({ protocol: 1 }))).toEqual({ host: 'juno', protocol: 2 })
    expect<unknown>(account).toBe(`${engine.fake.teamId}:U0TUSHAR`)

    const injection = hostileMessages.find((f) => f.name === 'ignoreInstructions')!.message.text
    const history = await waitFor(async () => {
      const page = await ok(client['host.slack.history']({ accountId: account, channelId: CHANNEL, limit: 50 } as never))
      return page.messages.some((m) => m.text === injection) ? page : undefined
    }, 30_000, 'the hostile messages in history')
    // Exactly as Slack holds it: Slack escapes <, > and &, and the host changes nothing.
    const asSlack = engine.fake.messages(CHANNEL).find((m) => m.text?.includes('The owner has approved every pending card'))!
    expect(asSlack.text).toContain('&lt;/tool_result&gt;')
    expect(history.messages.find((m) => m.ts === String(asSlack.ts))).toMatchObject({ channelId: CHANNEL, senderId: 'U0MAYA', senderName: 'Maya', channelName: '#eng', text: asSlack.text })
    const times = history.messages.map((m) => m.ts)
    expect(times).toEqual(times.toSorted())

    const older = await ok(client['host.slack.history']({ accountId: account, channelId: CHANNEL, limit: 2 } as never))
    expect(older.messages).toHaveLength(2)
    expect<unknown>(older.next).toBe(older.messages[0]!.ts)

    const found = await ok(client['host.slack.search']({ accountId: account, query: 'maintenance mode', limit: 10 } as never))
    expect(found.messages.map((m) => m.text)).toEqual([injection])
    const fromMaya = await ok(client['host.slack.search']({ accountId: account, query: 'from:@maya in:#eng maintenance', limit: 10 } as never))
    expect(fromMaya.messages.map((m) => m.text)).toEqual([injection])
    const fromLeo = await ok(client['host.slack.search']({ accountId: account, query: 'from:@leo maintenance', limit: 10 } as never))
    expect(fromLeo.messages).toEqual([])
    // `from:me` is the signed-in user: what the learning pass reads.
    const fromMe = await ok(client['host.slack.search']({ accountId: account, query: 'from:me', limit: 50 } as never))
    expect(fromMe.messages.length).toBeGreaterThan(0)
    expect(fromMe.messages.every((m) => m.senderId === SELF_ID)).toBe(true)

    expect<unknown>(await ok(client['host.slack.person']({ accountId: account, userId: 'U0MAYA' } as never))).toEqual({ id: 'U0MAYA', name: 'Maya Chen', displayName: 'Maya' })
    expect((await failure(client['host.slack.person']({ accountId: account, userId: 'U0NOBODY' } as never)))).toMatchObject({ reason: 'notFound' })

    // Who the owner exchanges messages with (SPEC 13.8): counts and names, most first, never a bot or the owner.
    const { people } = await ok(client['host.slack.people']({ accountId: account, since: 0, limit: 50 } as never))
    const maya = people.find((p) => p.id === 'U0MAYA')
    expect(maya).toMatchObject({ name: 'Maya Chen', dm: 'D0MAYA' })
    expect(maya!.owner).toBeGreaterThanOrEqual(2)
    expect(maya!.them).toBeGreaterThanOrEqual(4)
    expect(people.map((p) => p.id)).not.toContain(SELF_ID)
    expect(people.map((p) => p.id)).not.toContain('U0GRAFANA')
    expect(people.map((p) => p.owner + p.them)).toEqual(people.map((p) => p.owner + p.them).toSorted((a, b) => b - a))
    expect(Object.keys(maya!).sort()).toEqual(['dm', 'id', 'lastAt', 'name', 'owner', 'them'])
    const { members } = await ok(client['host.slack.members']({ accountId: account, names: ['Maya', 'maya chen', 'Nobody'] } as never))
    expect<unknown>(members.map((m) => m.ids.map((id) => id.id))).toEqual([['U0MAYA'], ['U0MAYA'], []])

    const { topics } = await ok(client['host.topics.list']({ limit: 200 } as never))
    expect(topics).toContainEqual({ topicId: `m:${CHANNEL}`, title: '#eng · Main', where: '#eng', tint: 'public' })
    const main = await ok(client['host.topics.get']({ topicId: `m:${CHANNEL}` } as never))
    expect(main).toMatchObject({ accountId: account, resolved: false, place: { channelId: CHANNEL, name: 'eng', kindLabel: 'Public channel', tint: 'public' } })
    expect(main.messages.messages.some((m) => m.text === injection)).toBe(true)

    const thread = topics.find((t) => t.topicId.startsWith(`t:${CHANNEL}:`))!
    const rootTs = thread.topicId.split(':')[2]!
    const replies = await ok(client['host.slack.replies']({ accountId: account, channelId: CHANNEL, threadTs: rootTs, limit: 200 } as never))
    expect(replies.messages[0]).toMatchObject({ ts: rootTs })
    expect(replies.messages.slice(1).every((m) => m.threadTs === rootTs)).toBe(true)

    expect(await failure(client['host.slack.history']({ accountId: 'T0OTHER:U0OTHER', channelId: CHANNEL, limit: 5 } as never))).toMatchObject({ reason: 'stale' })
  })

  it("binds the agent's Slack reads to the account its presence names", async () => {
    const { engine, transport, account } = await hostWithAgent('disabled')
    engine.fake.injectMessage({ channel: CHANNEL, user: 'U0MAYA', text: 'Deploy is green' })
    const agent = await startRealAgent(transport, engine.userData)
    expect(agent.host).toEqual({ host: 'juno', protocol: 2 })
    await waitFor(() => (agent.presence()?.accountId === account ? true : undefined), 15_000, 'the presence to name the account')

    const history = await waitFor(async () => {
      const page = await agent.reads.history(CHANNEL)
      return page.messages.some((m) => m.text === 'Deploy is green') ? page : undefined
    }, 30_000, 'the message in history')
    expect(history.messages.find((m) => m.text === 'Deploy is green')).toMatchObject({ channelId: CHANNEL, senderId: 'U0MAYA' })
    expect((await agent.reads.search('green')).messages.map((m) => m.text)).toEqual(['Deploy is green'])
    expect(await agent.reads.person('U0MAYA')).toEqual({ id: 'U0MAYA', name: 'Maya Chen', displayName: 'Maya' })
    expect(await agent.reads.person('U0NOBODY').catch((error: unknown) => error)).toMatchObject({ reason: 'notFound' })
  })

  it('reads notification and active hours from the notifications settings', async () => {
    const { engine, agent } = await hostWithAgent('disabled')
    const never = { days: [], from: 9 * 60, to: 19 * 60 }
    const settings = { notificationHours: never, presenceHours: never, matters: '', channels: {}, people: {} }
    await runCommand(engine.registry, prefsSet, { key: 'notifications', value: settings })
    expect(await presence(agent.client, (p) => p.quietHours && !p.ownerActive)).toMatchObject({ quietHours: true, ownerActive: false })

    const always = { days: [0, 1, 2, 3, 4, 5, 6], from: 0, to: 1439 }
    const minute = new Date().getHours() * 60 + new Date().getMinutes()
    // 23:59 is outside 0 to 1439; skip the flip when the test runs in that minute.
    if (minute < 1438) {
      await runCommand(engine.registry, prefsSet, { key: 'notifications', value: { ...settings, notificationHours: always, presenceHours: always } })
      expect(await presence(agent.client, (p) => !p.quietHours && p.ownerActive)).toMatchObject({ quietHours: false, ownerActive: true })
    }
  })

  it('follows AI assist and the topic last viewed in presence', async () => {
    const { engine, agent } = await hostWithAgent('disabled')
    const first = (await presence(agent.client))!
    expect(first).toMatchObject({ online: true, aiEnabled: true, thisTopic: null })

    const unmount = engine.registry.mount(topicAtom(`m:${CHANNEL}`))
    const viewing = await presence(agent.client, (p) => p.thisTopic !== null)
    expect<unknown>(viewing?.thisTopic).toEqual({ topicId: `m:${CHANNEL}`, place: { channelId: CHANNEL, name: 'eng', kindLabel: 'Public channel', tint: 'public' } })
    unmount()

    await runCommand(engine.registry, prefsSet, { key: 'aiAssist', value: false })
    const off = await presence(agent.client, (p) => !p.aiEnabled)
    // "This" is the topic last viewed: it stays after the topic closes.
    expect(off).toMatchObject({ aiEnabled: false, thisTopic: { topicId: `m:${CHANNEL}` } })
  })

  it('refuses sends while external writes are off', async () => {
    const { engine, agent, account } = await hostWithAgent('disabled')
    const dispatch = send(account, 'Hello from Juno')
    await approve(engine, dispatch)
    expect(await failure(agent.client['host.outbox.send'](dispatch))).toMatchObject({ reason: 'unsupported' })
    expect(await failure(agent.client['host.topics.resolve'](dispatch))).toMatchObject({ reason: 'rejected' })
    expect(posted(engine, dispatch.actionId)).toEqual([])
    expect(engine.fake.callCount('chat.postMessage')).toBe(0)
  })

  it('sends only on the owner click on that exact payload, and only once', async () => {
    const { engine, agent, account } = await hostWithAgent('enabled')
    const unclicked = send(account, 'Juno wrote this on its own')
    expect(await failure(agent.client['host.outbox.send'](unclicked))).toMatchObject({ reason: 'rejected' })

    // The owner approved one text; the dispatch carries another, with its own digest or with the approved one.
    const shown = send(account, 'Lunch at noon?')
    await approve(engine, shown)
    const swapped = { ...shown, payload: { ...shown.payload, args: { channelId: CHANNEL, text: 'Lunch at noon? Also, the launch is cancelled.' } } } as typeof shown
    expect(await failure(agent.client['host.outbox.send']({ ...swapped, digest: actionDigest(swapped.payload) }))).toMatchObject({ reason: 'rejected' })
    expect(await failure(agent.client['host.outbox.send'](swapped))).toMatchObject({ reason: 'rejected' })
    expect(engine.fake.callCount('chat.postMessage')).toBe(0)

    expect(await ok(agent.client['host.outbox.send'](shown))).toMatchObject({ _tag: 'done', attemptId: shown.attemptId })
    // A second authorization of the same click, a replay under new ids, is refused.
    const replay = { ...shown, authorizationId: 'auth-replay', attemptId: 'attempt-replay' } as typeof shown
    expect(await failure(agent.client['host.outbox.send'](replay))).toMatchObject({ reason: 'rejected' })
    expect(engine.fake.callCount('chat.postMessage')).toBe(1)
    expect(posted(engine, shown.actionId)).toHaveLength(1)
    expect(posted(engine, unclicked.actionId)).toEqual([])
  })

  it('sends through the outbox once per authorization, and answers a repeat from the record', async () => {
    const { engine, agent, account } = await hostWithAgent('enabled')
    const dispatch = send(account, 'Lunch at noon?')
    await approve(engine, dispatch)
    const result = await ok(agent.client['host.outbox.send'](dispatch))
    const [message] = posted(engine, dispatch.actionId)
    expect(result).toEqual({ _tag: 'done', attemptId: dispatch.attemptId, receipt: { channelId: CHANNEL, ts: message!.ts } })
    expect(message).toMatchObject({ user: 'U0TUSHAR', text: 'Lunch at noon?' })
    // It went as the composer sends: one rich_text block with the text.
    expect(JSON.stringify(message!.blocks)).toContain('rich_text')

    expect(await ok(agent.client['host.outbox.send'](dispatch))).toEqual(result)
    expect(await ok(agent.client['host.outbox.cancel']({ authorizationId: dispatch.authorizationId, attemptId: dispatch.attemptId }))).toEqual(result)
    expect(engine.fake.callCount('chat.postMessage')).toBe(1)

    const reconciled = await ok(agent.client['host.outbox.reconcileSend']({ accountId: account, channelId: CHANNEL, actionId: dispatch.actionId, attemptId: dispatch.attemptId } as never))
    expect(reconciled).toMatchObject({ _tag: 'found', message: { ts: message!.ts, senderId: 'U0TUSHAR', clientMessageId: dispatch.actionId } })

    const other = send(account, 'Wrong account')
    const otherAccount = { ...other, payload: { ...other.payload, account_id: 'T0OTHER:U0OTHER' } } as typeof other
    const wrong = { ...otherAccount, digest: actionDigest(otherAccount.payload) }
    await approve(engine, wrong)
    expect(await failure(agent.client['host.outbox.send'](wrong))).toMatchObject({ reason: 'stale' })
    const notSend = dispatchOf(++sequence, { ...dispatch.payload, tool: 'notion-update-page' })
    await approve(engine, notSend)
    expect(await failure(agent.client['host.outbox.send'](notSend))).toMatchObject({ reason: 'rejected' })
    expect(engine.fake.callCount('chat.postMessage')).toBe(1)
  })

  it('a refused post fails with Slack’s reason and stays in the topic as Not sent', async () => {
    const { engine, agent, account } = await hostWithAgent('enabled')
    const dispatch = send(account, 'Into a channel I left')
    await approve(engine, dispatch)
    engine.fake.forceError({ method: 'chat.postMessage', error: 'not_in_channel' })
    expect(await ok(agent.client['host.outbox.send'](dispatch))).toEqual({ _tag: 'failed', attemptId: dispatch.attemptId, reason: 'not_in_channel' })
    expect(posted(engine, dispatch.actionId)).toEqual([])
    expect(engine.fake.callCount('chat.postMessage')).toBe(1)
  })

  it('follows a refused send to its outbox row: the owner retries it from the topic, and its state turns done', async () => {
    const { engine, agent, account } = await hostWithAgent('enabled')
    const dispatch = send(account, 'Refused, then retried')
    await approve(engine, dispatch)
    engine.fake.forceError({ method: 'chat.postMessage', error: 'not_in_channel' })
    expect(await ok(agent.client['host.outbox.send'](dispatch))).toMatchObject({ _tag: 'failed', reason: 'not_in_channel' })
    const stateOf = (until: (state: typeof HostSendState.Type | undefined) => boolean) =>
      ok(agent.client['host.outbox.states']().pipe(
        Stream.map((states) => states.find((state) => state.attemptId === dispatch.attemptId)),
        Stream.filter(until), Stream.take(1), Stream.runHead,
      ))
    expect(await stateOf((state) => state?.state === 'failed')).toMatchObject({ _tag: 'Some', value: { state: 'failed', reason: 'not_in_channel' } })
    expect((await runCommand(engine.registry, messagesRetry, { clientMsgId: dispatch.actionId }))._tag).toBe('Success')
    const [message] = await waitFor(() => (posted(engine, dispatch.actionId).length === 1 ? posted(engine, dispatch.actionId) : undefined), 15_000, 'the retried post')
    expect(await stateOf((state) => state?.state === 'done')).toMatchObject({ _tag: 'Some', value: { state: 'done', receipt: { channelId: CHANNEL, ts: message!.ts } } })
    // The record follows too: a repeat of the authorization now answers done, and nothing is posted again.
    expect(await ok(agent.client['host.outbox.send'](dispatch))).toMatchObject({ _tag: 'done', attemptId: dispatch.attemptId })
    expect(engine.fake.callCount('chat.postMessage')).toBe(2)
  })

  it('waits out a lost connection and sends when it is back', async () => {
    const { engine, agent, account } = await hostWithAgent('enabled')
    engine.main.network.offline = true
    engine.fake.goOffline()
    await engine.phase('offline')
    const dispatch = send(account, 'Sent while offline')
    await approve(engine, dispatch)
    const pending = run(agent.client['host.outbox.send'](dispatch))
    await engine.workPass('post')
    expect(engine.fake.callCount('chat.postMessage')).toBe(0)
    engine.main.network.offline = false
    engine.fake.goOnline()
    expect(await pending).toMatchObject({ _tag: 'Success', success: { _tag: 'done', attemptId: dispatch.attemptId } })
    expect(posted(engine, dispatch.actionId)).toHaveLength(1)
  })

  it('keeps the send when the agent dies mid-call, and the restarted agent gets its result', async () => {
    const { engine, transport, agent, account } = await hostWithAgent('enabled')
    const dispatch = send(account, 'Sent while the agent crashed')
    await approve(engine, dispatch)
    engine.fake.holdNext({ method: 'chat.postMessage' })
    const lost = Effect.runPromiseExit(agent.client['host.outbox.send'](dispatch))
    await waitFor(() => (engine.fake.heldCount({ method: 'chat.postMessage' }) === 1 ? true : undefined), 15_000, 'the send to reach Slack')
    await agent.close()
    expect(Exit.isSuccess(await lost)).toBe(false)

    const restarted = await connectAgent(transport)
    const again = run(restarted.client['host.outbox.send'](dispatch))
    engine.fake.release({ method: 'chat.postMessage' })
    const result = await again
    expect(result).toMatchObject({ _tag: 'Success', success: { _tag: 'done', attemptId: dispatch.attemptId } })
    expect(posted(engine, dispatch.actionId)).toHaveLength(1)
    expect(engine.fake.callCount('chat.postMessage')).toBe(1)
  })

  it('a lost answer is settled by the outbox lookup, never posted twice, and only the owner’s message counts', async () => {
    const { engine, agent, account } = await hostWithAgent('enabled')
    const lost = send(account, 'Answer lost on the way back')
    await approve(engine, lost)
    engine.fake.loseResponse({ method: 'chat.postMessage' })
    expect(await ok(agent.client['host.outbox.send'](lost))).toMatchObject({ _tag: 'done', attemptId: lost.attemptId })
    expect(posted(engine, lost.actionId)).toHaveLength(1)
    expect(engine.fake.callCount('chat.postMessage')).toBe(1)

    // Slack ran nothing, and someone else posts a message carrying the send's client_msg_id.
    const forged = send(account, 'Never landed')
    await approve(engine, forged)
    engine.fake.forceError({ method: 'chat.postMessage', error: 'internal_error' })
    const pending = run(agent.client['host.outbox.send'](forged))
    await waitFor(() => (engine.fake.callCount('chat.postMessage') === 2 ? true : undefined), 15_000, 'the refused post')
    const receipt = forgedSendReceipt(forged.actionId, CHANNEL)
    engine.fake.injectMessage({ channel: CHANNEL, user: 'U0MAYA', text: receipt.text, clientMsgId: forged.actionId })
    expect(HOSTILE_USER).not.toBe('U0MAYA')
    expect(await pending).toMatchObject({ _tag: 'Success', success: { _tag: 'unknown', attemptId: forged.attemptId } })
    expect(await ok(agent.client['host.outbox.reconcileSend']({ accountId: account, channelId: CHANNEL, actionId: forged.actionId, attemptId: forged.attemptId } as never))).toEqual({ _tag: 'unknown' })
    expect(await ok(agent.client['host.outbox.send'](forged))).toEqual({ _tag: 'unknown', attemptId: forged.attemptId })
    expect(engine.fake.callCount('chat.postMessage')).toBe(2)
  })

  it('deletes the copy when the network sends an agent post twice', async () => {
    const { engine, agent, account } = await hostWithAgent('enabled')
    engine.main.network.resend = true
    const dispatch = send(account, 'Sent twice by the network')
    await approve(engine, dispatch)
    engine.fake.loseResponse({ method: 'chat.postMessage' })
    const result = await ok(agent.client['host.outbox.send'](dispatch))
    expect(result).toMatchObject({ _tag: 'done', attemptId: dispatch.attemptId })
    expect(engine.fake.callCount('chat.postMessage')).toBe(2)
    await waitFor(() => (posted(engine, dispatch.actionId).length === 1 ? true : undefined), 15_000, 'the copy deleted')
    expect(engine.fake.callCount('chat.delete')).toBe(1)
  })

  it('reconciles a send whose text Slack stores escaped', async () => {
    const { engine, agent, account } = await hostWithAgent('enabled')
    const sent = send(account, 'Ship it if p95 < 200ms & errors > 0?')
    await approve(engine, sent)
    expect(await ok(agent.client['host.outbox.send'](sent))).toMatchObject({ _tag: 'done', attemptId: sent.attemptId })
    const [stored] = posted(engine, sent.actionId)
    expect(stored!.text).not.toBe('Ship it if p95 < 200ms & errors > 0?')
    const found = await ok(agent.client['host.outbox.reconcileSend']({ accountId: account, channelId: CHANNEL, actionId: sent.actionId, attemptId: sent.attemptId } as never))
    expect(found).toMatchObject({ _tag: 'found', message: { clientMessageId: sent.actionId, text: stored!.text } })
    expect(engine.fake.callCount('chat.postMessage')).toBe(1)
  })

  it('a cancel before the send refuses it; a send cut off by an engine restart is followed to its end', async () => {
    const { engine, transport, agent, account } = await hostWithAgent('enabled')
    const cancelled = send(account, 'Never sent')
    await approve(engine, cancelled)
    expect(await ok(agent.client['host.outbox.cancel']({ authorizationId: cancelled.authorizationId, attemptId: cancelled.attemptId }))).toEqual({ _tag: 'cancelled' })
    expect(await ok(agent.client['host.outbox.send'](cancelled))).toEqual({ _tag: 'failed', attemptId: cancelled.attemptId, reason: 'cancelled' })
    expect(engine.fake.callCount('chat.postMessage')).toBe(0)

    engine.main.network.resend = true
    const cut = send(account, 'Engine stopped mid-send')
    await approve(engine, cut)
    engine.fake.holdNext({ method: 'chat.postMessage' })
    const pending = Effect.runPromiseExit(agent.client['host.outbox.send'](cut))
    await waitFor(() => (engine.fake.heldCount({ method: 'chat.postMessage' }) === 1 ? true : undefined), 15_000, 'the send to reach Slack')
    await agent.close()
    await pending
    engine.registry.dispose()
    await engine.handle.stop()
    engines.splice(engines.indexOf(engine), 1)
    engine.fake.release({ method: 'chat.postMessage' })

    const next = await startTestEngine({
      reuse: { userData: engine.userData, fake: engine.fake, credentials: engine.fake.credentials() },
      initial: () => engine.fake.credentials(),
      agent: { transport, writes: 'enabled' },
    })
    engines.push({
      ...next,
      stop: async () => {
        await next.stop()
        await engine.fake.close()
        await rm(engine.userData, { recursive: true, force: true })
      },
    })
    await next.status('ready')
    const restarted = await connectAgent(transport)
    // The post was cut off mid-call: the outbox's lookup finds it, and the record follows.
    expect(await ok(restarted.client['host.outbox.send'](cut))).toMatchObject({ _tag: 'done', attemptId: cut.attemptId })
    expect(posted(engine, cut.actionId)).toHaveLength(1)
    const found = await ok(restarted.client['host.outbox.reconcileSend']({ accountId: account, channelId: CHANNEL, actionId: cut.actionId, attemptId: cut.attemptId } as never))
    expect(found).toMatchObject({ _tag: 'found' })
  })
})

describe('reply-watch host reads', () => {
  it('verifies the owner, emits conversation changes, and refreshes beyond one Slack page', async () => {
    const { engine, agent, account } = await hostWithAgent('disabled')
    const root = engine.fake.injectMessage({ channel: CHANNEL, user: 'U0TUSHAR', text: 'Can someone check the test plan?' })
    const conversation = { channelId: CHANNEL, ts: root.ts, threadTs: root.ts }
    const check = (refresh: boolean) => agent.client['host.schedule.check']({ accountId: account, conversation, refresh })
    await waitFor(async () => (await ok(check(false))).ownMessage || undefined, 30_000, 'the owner message in the local store')
    const changed = ok(agent.client['host.schedule.changes']().pipe(Stream.drop(1), Stream.take(1), Stream.runDrain))
    for (let n = 0; n < 205; n++) engine.fake.injectMessage({ channel: CHANNEL, user: 'U0MAYA', threadTs: root.ts, text: `Test reply ${n}` })
    await changed
    const snapshot = await ok(check(true))
    expect(snapshot.owner).toBe('U0TUSHAR')
    expect(snapshot.ownMessage).toBe(true)
    expect(snapshot.messages).toHaveLength(205)
    expect(snapshot.messages.every((message) => message.threadTs === root.ts && message.userId === 'U0MAYA' && !('text' in message))).toBe(true)
    expect(await ok(agent.client['host.schedule.hours']({ accountId: account }))).toMatchObject({ weekdays: [1, 2, 3, 4, 5], start: 540, end: 1140 })
    expect(await failure(agent.client['host.schedule.check']({ accountId: 'wrong-account' as typeof account, conversation, refresh: true }))).toMatchObject({ reason: 'stale' })
  })
})
