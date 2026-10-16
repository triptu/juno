import { Effect, Fiber, Layer, ManagedRuntime, Stream } from 'effect'
import { AiProvider, PiAiProvider, tasks } from '@juno/ai'
import type { HostSpendAsk } from '@juno/agent-contract'
import type { TopicId } from '@juno/domain'
import { expect, it, vi } from 'vitest'
import { AiProviderLive } from '../src/ai'
import { AiCredentials } from '../src/aiCredentials'
import { AiBackground, AiSpend } from '../src/aiSpend'
import { AiAudit } from '../src/aiAudit'
import type { EngineConfig as Config } from '@juno/contract'
import { EngineConfig } from '../src/config'
import { HostLink, memoryHost } from '../src/protocol/host'
import { Workspace } from '../src/workspace'
import { waitFor } from './harness'

const input = { topicId: 't:C:test' as TopicId, channel: 'eng', messages: [{ sender: 'Sam', text: 'Postgres migration', at: new Date(0).toISOString() }] }
const generate = AiProvider.use(p => p.generate(tasks.titleTopic, input))

function engineAi(config: Config) {
  const host = memoryHost()
  const runtime = ManagedRuntime.make(AiProviderLive.pipe(
    Layer.provideMerge(AiCredentials.layer),
    Layer.provideMerge(AiSpend.layer),
    Layer.provideMerge(AiAudit.layer),
    Layer.provide(Workspace.layer),
    Layer.provide(HostLink.layer(host)),
    Layer.provide(EngineConfig.layer(config)),
  ))
  const setKey = async (key: string | null) => {
    const before = await runtime.runPromise(AiCredentials.use(c => c.revision))
    host.deliver({ _tag: 'aiKey', key })
    await waitFor(async () => (await runtime.runPromise(AiCredentials.use(c => c.revision))) > before || undefined)
  }
  /** Stands in for the agent's ledger: answers every ask with `decide`, and records the asks it answered. */
  const ledger = (decide: (amount: number) => 'reserved' | 'blocked') => {
    const answered: Array<HostSpendAsk> = []
    const fiber = runtime.runFork(AiSpend.use(spend => spend.host.asks.pipe(Stream.runForEach(asks => Effect.forEach(asks, ask => {
      if (!answered.some(seen => seen.id === ask.id && seen._tag === ask._tag)) answered.push(ask)
      return spend.host.answer({ id: ask.id, ask: ask._tag, result: ask._tag === 'settle' ? 'settled' : decide(ask.amount) })
    }, { discard: true })))))
    return { answered, stop: () => Effect.runPromise(Fiber.interrupt(fiber)) }
  }
  return { host, runtime, setKey, ledger }
}

it('follows key changes from main and cancels calls made with the old key', async () => {
  const { host, runtime, setKey, ledger } = engineAi({ userData: '', e2e: true, dev: false, ai: 'fake', fakeAiRequiresKey: true, fakeAiDelayMillis: 100 })
  const agent = ledger(() => 'reserved')
  const reservations = () => agent.answered.filter(ask => ask._tag === 'reserve').length
  try {
    expect(await runtime.runPromise(generate)).toMatchObject({ _tag: 'NoDecision', reason: 'missing-key' })
    await setKey('fake-key-one')
    expect(await runtime.runPromise(generate)).toMatchObject({ _tag: 'Decided', value: 'Postgres migration' })
    const pending = runtime.runFork(generate)
    await waitFor(() => reservations() >= 2 || undefined)
    await setKey('fake-key-two')
    expect(await Effect.runPromise(Fiber.join(pending))).toMatchObject({ _tag: 'NoDecision', reason: 'missing-key' })
    expect(await runtime.runPromise(generate)).toMatchObject({ _tag: 'Decided' })
    await setKey(null)
    const calls = host.fromEngine.filter(m => m._tag === 'aiCall').length
    const reserved = reservations()
    expect(await runtime.runPromise(generate)).toMatchObject({ _tag: 'NoDecision', reason: 'missing-key' })
    expect(host.fromEngine.filter(m => m._tag === 'aiCall')).toHaveLength(calls)
    expect(reservations()).toBe(reserved)
    // Every reservation was settled, the cancelled one included.
    await waitFor(() => agent.answered.filter(ask => ask._tag === 'settle').length === reserved || undefined)
  } finally {
    await agent.stop()
    await runtime.dispose()
  }
})

it('makes no call outside the daily cap: blocked by the ledger, or with no agent to ask', async () => {
  const { host, runtime, setKey, ledger } = engineAi({ userData: '', e2e: true, dev: false, ai: 'fake', fakeAiRequiresKey: true })
  try {
    await setKey('fake-key')
    expect(await runtime.runPromise(generate)).toMatchObject({ _tag: 'NoDecision', reason: 'budget' })
    const agent = ledger(() => 'blocked')
    await waitFor(async () => (await runtime.runPromise(generate))._tag === 'NoDecision' && agent.answered.length > 0 || undefined)
    expect(await runtime.runPromise(generate)).toMatchObject({ _tag: 'NoDecision', reason: 'budget' })
    expect(host.fromEngine.filter(m => m._tag === 'aiCall')).toHaveLength(0)
    await agent.stop()
    const open = ledger(() => 'reserved')
    await waitFor(async () => (await runtime.runPromise(generate))._tag === 'Decided' || undefined)
    expect(host.fromEngine.filter(m => m._tag === 'aiCall').length).toBeGreaterThan(0)
    await open.stop()
  } finally {
    await runtime.dispose()
  }
})

it('reads the latest key for every live provider call and reserves before it', async () => {
  const provider = vi.spyOn(PiAiProvider, 'layer').mockImplementation(config => Layer.succeed(AiProvider, {
    decide: () => Effect.die('unused'),
    generate: () => config.pipe(Effect.map(value => ({ _tag: 'Decided' as const, value: value.apiKey === 'fake-first-key' && value.admit !== undefined ? 'First provider' : 'Second provider', meta: { model: 'scripted', latencyMillis: 0, attempts: 1 } }))),
  }))
  const { runtime, setKey } = engineAi({ userData: '', e2e: true, dev: false, ai: 'live' })
  try {
    expect(await runtime.runPromise(generate)).toMatchObject({ reason: 'missing-key' })
    await setKey('fake-first-key')
    expect(await runtime.runPromise(generate)).toMatchObject({ value: 'First provider' })
    await setKey('fake-next-key')
    expect(await runtime.runPromise(generate)).toMatchObject({ value: 'Second provider' })
  } finally {
    await runtime.dispose()
    provider.mockRestore()
  }
})

it('asks the ledger as backlog for a call made as background work, and as foreground otherwise', async () => {
  const { runtime, setKey, ledger } = engineAi({ userData: '', e2e: true, dev: false, ai: 'fake', fakeAiRequiresKey: true })
  const agent = ledger(() => 'reserved')
  try {
    await setKey('fake-key')
    expect(await runtime.runPromise(generate)).toMatchObject({ _tag: 'Decided' })
    expect(await runtime.runPromise(generate.pipe(Effect.provideService(AiBackground, true)))).toMatchObject({ _tag: 'Decided' })
    const reserves = agent.answered.filter(ask => ask._tag === 'reserve')
    expect(reserves.map(ask => ask._tag === 'reserve' && ask.background === true)).toEqual([false, true])
    expect(reserves.every(ask => ask._tag === 'reserve' && ask.amount > 0)).toBe(true)
  } finally {
    await agent.stop()
    await runtime.dispose()
  }
})
