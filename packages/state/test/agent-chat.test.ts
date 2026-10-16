// The Juno chat as the renderer holds it: `@juno/state/agent`'s atoms and actions over a Node
// MessageChannel to the agent's real renderer server, on the real turn engine with the scripted
// fake model. The same port shape main brokers between the renderer and the agent process.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MessageChannel, type MessagePort } from 'node:worker_threads'
import { afterEach, expect, it } from 'vitest'
import { Effect, Exit, Layer, Scope, Stream } from 'effect'
import { CHAT_MIGRATIONS, createProviderGuard, openTurns, rendererPorts, rendererServer, type HostPort, type Turns } from '@juno/agent'
import { fakeProvider, reply } from '@juno/agent-testing'
import type { ChatPage, HostPresence } from '@juno/agent-contract'
import { makeRegistry, toastAtom, undoLast, type PortLike, type Registry } from '../src/index'
import { chatActions, chatItemsAtom, chatSummaryAtom, configureAgentConnection, MAX_SEND_BYTES, watchReply } from '../src/agent'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) await cleanup()
})

const hostPort = (port: MessagePort): HostPort => ({
  postMessage: (message) => port.postMessage(message),
  onMessage: (f) => {
    port.on('message', f)
  },
  onClose: (f) => {
    port.on('close', f)
  },
  close: () => port.close(),
})

const ONLINE: typeof HostPresence.Type = { online: true, aiEnabled: true, quietHours: false, ownerActive: true, accountId: null, thisTopic: null }

async function agentChat() {
  const dir = await mkdtemp(join(tmpdir(), 'juno-state-agent-'))
  const fake = fakeProvider()
  const opened = await openTurns({
    agentDir: dir,
    provider: (store) => createProviderGuard({ store, transport: fake.models }),
    model: { provider: 'openrouter', modelId: 'anthropic/claude-sonnet-5.5' },
    migrations: [CHAT_MIGRATIONS],
  })
  if (opened._tag !== 'running') throw new Error('the engine did not open')
  const turns: Turns = opened
  cleanups.push(async () => {
    await turns.close()
    await rm(dir, { recursive: true, force: true })
  })
  const transport = rendererPorts()
  const scope = Effect.runSync(Scope.make())
  cleanups.push(() => Effect.runPromise(Scope.close(scope, Exit.void)))
  await Effect.runPromise(Layer.buildWithScope(rendererServer(transport, { turns, presence: () => ONLINE, presenceChanges: Stream.make(ONLINE), schedule: { scheduler: turns.scheduler, host: { ownMessage: async () => true, hours: async () => ({ timeZone: 'UTC', weekdays: [1, 2, 3, 4, 5], start: 540, end: 1020 }) } } }), scope))

  const registry: Registry = makeRegistry()
  cleanups.push(async () => registry.dispose())
  configureAgentConnection(registry, {
    acquire: async () => {
      const { port1, port2 } = new MessageChannel()
      transport.add(hostPort(port2))
      return port1 as unknown as PortLike
    },
  })
  return { fake, turns, registry }
}

/** Polls until `read` gives a value, for at most 15 s. */
async function eventually<A>(read: () => A | undefined, what: string): Promise<A> {
  const deadline = Date.now() + 15_000
  for (;;) {
    const value = read()
    if (value !== undefined) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

const LATEST = { _tag: 'latest', limit: 50 } as const

function pageOf(registry: Registry): ChatPage | undefined {
  const result = registry.get(chatItemsAtom(LATEST))
  return result._tag === 'Success' ? result.value : undefined
}

it('a send shows at once, then as the agent stored it, and Juno answers it', async () => {
  const { fake, registry } = await agentChat()
  registry.mount(chatItemsAtom(LATEST))
  registry.mount(chatSummaryAtom)
  await eventually(() => pageOf(registry), 'the first page')
  const actions = chatActions(registry)

  fake.script([reply('<say>Morning. Two meetings today.</say>')])
  // Every page the chat is given from the send on, to check the bubble never leaves.
  const pages: Array<ChatPage> = []
  const unsubscribe = registry.subscribe(chatItemsAtom(LATEST), (result) => {
    if (result._tag === 'Success') pages.push(result.value)
  })
  const opId = actions.send('what is on today?')
  // From the first frame, before the agent has it.
  expect(pageOf(registry)?.items).toContainEqual(expect.objectContaining({ _tag: 'owner', opId, text: 'what is on today?', delivery: { _tag: 'sending' } }))

  const answered = await eventually(() => {
    const page = pageOf(registry)
    return page?.items.some((item) => item._tag === 'juno') && !page.items.some((item) => item._tag === 'status') ? page : undefined
  }, 'the answer')
  const owners = answered.items.filter((item) => item._tag === 'owner')
  expect(owners).toHaveLength(1)
  expect(owners[0]).toMatchObject({ opId, delivery: { _tag: 'sent' } })
  unsubscribe()
  // In every page, with the day separator the stored row has above it, so the bubble never moves when it lands.
  const sentAt = (page: ChatPage) => page.items.findIndex((item) => item._tag === 'owner' && item.opId === opId)
  expect(pages.filter((page) => sentAt(page) < 1 || page.items[sentAt(page) - 1]?._tag !== 'day')).toEqual([])
  const bubble = answered.items.find((item) => item._tag === 'juno')!
  expect(bubble).toMatchObject({ body: [{ _tag: 'paragraph', inlines: [{ _tag: 'text', text: 'Morning. Two meetings today.' }] }], unread: true })

  await eventually(() => {
    const summary = registry.get(chatSummaryAtom)
    return summary._tag === 'Success' && summary.value.unread === 1 ? true : undefined
  }, 'one unread')
  await actions.read(bubble._tag === 'juno' ? bubble.id : '')
  await eventually(() => {
    const summary = registry.get(chatSummaryAtom)
    return summary._tag === 'Success' && summary.value.unread === 0 ? true : undefined
  }, 'nothing unread')
})

it('a message over 64 KB fails locally and never reaches the agent', async () => {
  const { turns, registry } = await agentChat()
  registry.mount(chatItemsAtom(LATEST))
  await eventually(() => pageOf(registry), 'the first page')
  const opId = chatActions(registry).send('x'.repeat(MAX_SEND_BYTES + 1))
  expect(pageOf(registry)?.items).toContainEqual(expect.objectContaining({ _tag: 'owner', opId, delivery: { _tag: 'failed', reason: 'tooLong' } }))
  expect(turns.op(opId)).toBeUndefined()
})

it('the menu reply watch toast undoes the schedule without a model run', async () => {
  const { fake, turns, registry } = await agentChat()
  await watchReply(registry, { channelId: 'C_TEST', ts: '100', threadTs: '100' })
  expect(turns.scheduler.list()).toHaveLength(1)
  expect(registry.get(toastAtom)?.text).toContain('Watching for a reply until')
  expect(await undoLast(registry)).toBe(true)
  expect(turns.scheduler.list()).toHaveLength(0)
  expect(fake.requests).toHaveLength(0)
})
