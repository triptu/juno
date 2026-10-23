// The Juno chat as the renderer holds it: `@juno/state/agent`'s atoms and actions over a Node
// MessageChannel to the agent's real renderer server, on the real turn engine with the scripted
// fake model. The same port shape main brokers between the renderer and the agent process.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MessageChannel, type MessagePort } from 'node:worker_threads'
import { afterEach, expect, it } from 'bun:test'
import { Effect, Exit, Layer, Scope, Stream } from 'effect'
import { CHAT_MIGRATIONS, createProviderGuard, openTurns, rendererPorts, rendererServer, type HostPort, type Turns } from '@juno/agent'
import { fakeProvider, reply } from '@juno/agent-testing'
import type { ChatPage, HostPresence } from '@juno/agent-contract'
import { makeRegistry, type PortLike, type Registry } from '../src/index'
import { chatActions, chatItemsAtom, chatSummaryAtom, configureAgentConnection } from '../src/agent'

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

/** Resolves with `read()` once it gives a value, now or after a change `subscribe` reports. The test's timeout bounds the wait. */
function when<B>(subscribe: (changed: () => void) => () => void, read: () => B | undefined): Promise<B> {
  return new Promise((resolve) => {
    const now = read()
    if (now !== undefined) return resolve(now)
    const cancel = subscribe(() => {
      const value = read()
      if (value === undefined) return
      cancel()
      resolve(value)
    })
  })
}

const LATEST = { _tag: 'latest', limit: 50 } as const
function pageOf(registry: Registry): ChatPage | undefined {
  const result = registry.get(chatItemsAtom(LATEST))
  return result._tag === 'Success' ? result.value : undefined
}
function unreadOf(registry: Registry): number | undefined {
  const result = registry.get(chatSummaryAtom)
  return result._tag === 'Success' ? result.value.unread : undefined
}
const pageChanged = (registry: Registry) => (changed: () => void) => registry.subscribe(chatItemsAtom(LATEST), changed)
const summaryChanged = (registry: Registry) => (changed: () => void) => registry.subscribe(chatSummaryAtom, changed)

it('a send shows at once, then as the agent stored it, and Juno answers it', async () => {
  const { fake, registry } = await agentChat()
  registry.mount(chatItemsAtom(LATEST))
  registry.mount(chatSummaryAtom)
  await when(pageChanged(registry), () => pageOf(registry))
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

  const answered = await when(pageChanged(registry), () => {
    const shown = pageOf(registry)
    return shown?.items.some((item) => item._tag === 'juno') && !shown.items.some((item) => item._tag === 'status') ? shown : undefined
  })
  const owners = answered.items.filter((item) => item._tag === 'owner')
  expect(owners).toHaveLength(1)
  expect(owners[0]).toMatchObject({ opId, delivery: { _tag: 'sent' } })
  unsubscribe()
  // In every page, with the day separator the stored row has above it, so the bubble never moves when it lands.
  const sentAt = (page: ChatPage) => page.items.findIndex((item) => item._tag === 'owner' && item.opId === opId)
  expect(pages.filter((page) => sentAt(page) < 1 || page.items[sentAt(page) - 1]?._tag !== 'day')).toEqual([])
  const bubble = answered.items.find((item) => item._tag === 'juno')!
  expect(bubble).toMatchObject({ body: [{ _tag: 'paragraph', inlines: [{ _tag: 'text', text: 'Morning. Two meetings today.' }] }], unread: true })

  await when(summaryChanged(registry), () => (unreadOf(registry) === 1 ? true : undefined))
  await actions.read(bubble._tag === 'juno' ? bubble.id : '')
  await when(summaryChanged(registry), () => (unreadOf(registry) === 0 ? true : undefined))
})

