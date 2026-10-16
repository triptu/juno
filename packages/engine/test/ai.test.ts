import { Effect, Fiber, Layer, ManagedRuntime } from 'effect'
import { AiProvider, PiAiProvider, tasks } from '@juno/ai'
import type { TopicId } from '@juno/domain'
import { expect, it, vi } from 'vitest'
import { AiProviderLive } from '../src/ai'
import { AiCredentials } from '../src/aiCredentials'
import { EngineConfig } from '../src/config'
import { HostLink, memoryHost } from '../src/protocol/host'
import { Workspace } from '../src/workspace'
import { waitFor } from './harness'

it('updates the engine provider on host key changes and cancels calls using the old key', async () => {
  const host = memoryHost()
  const runtime = ManagedRuntime.make(AiProviderLive.pipe(
    Layer.provideMerge(AiCredentials.layer),
    Layer.provide(Workspace.layer),
    Layer.provide(HostLink.layer(host)),
    Layer.provide(EngineConfig.layer({ userData: '', e2e: true, dev: false, ai: 'fake', fakeAiRequiresKey: true, fakeAiDelayMillis: 100 })),
  ))
  const input = { topicId: 't:C:test' as TopicId, channel: 'eng', messages: [{ sender: 'Sam', text: 'Postgres migration', at: new Date(0).toISOString() }] }
  const generate = AiProvider.use(p => p.generate(tasks.titleTopic, input))
  const setKey = async (key: string | null) => {
    const before = await runtime.runPromise(AiCredentials.use(c => c.revision))
    host.deliver({ _tag: 'aiKey', key })
    await waitFor(async () => (await runtime.runPromise(AiCredentials.use(c => c.revision))) > before || undefined)
  }
  try {
    expect(await runtime.runPromise(generate)).toMatchObject({ _tag: 'NoDecision', reason: 'missing-key' })
    await setKey('fake-key-one')
    expect(await runtime.runPromise(generate)).toMatchObject({ _tag: 'Decided', value: 'Postgres migration' })
    const pending = runtime.runFork(generate)
    await waitFor(() => host.fromEngine.filter(m => m._tag === 'aiCall').length >= 2 || undefined)
    await setKey('fake-key-two')
    expect(await Effect.runPromise(Fiber.join(pending))).toMatchObject({ _tag: 'NoDecision', reason: 'missing-key' })
    expect(await runtime.runPromise(generate)).toMatchObject({ _tag: 'Decided' })
    await setKey(null)
    const calls = host.fromEngine.filter(m => m._tag === 'aiCall').length
    expect(await runtime.runPromise(generate)).toMatchObject({ _tag: 'NoDecision', reason: 'missing-key' })
    expect(host.fromEngine.filter(m => m._tag === 'aiCall')).toHaveLength(calls)
  } finally {
    await runtime.dispose()
  }
})


it('reads the latest key for every live provider call', async () => {
  const host = memoryHost()
  const provider = vi.spyOn(PiAiProvider, 'layer').mockImplementation(config => Layer.succeed(AiProvider, {
    decide: () => Effect.die('unused'),
    generate: () => config.pipe(Effect.map(value => ({ _tag: 'Decided' as const, value: value.apiKey === 'fake-first-key' ? 'First provider' : 'Second provider', meta: { model: 'scripted', latencyMillis: 0, attempts: 1 } }))),
  }))
  const runtime = ManagedRuntime.make(AiProviderLive.pipe(
    Layer.provideMerge(AiCredentials.layer), Layer.provide(Workspace.layer), Layer.provide(HostLink.layer(host)),
    Layer.provide(EngineConfig.layer({ userData: '', e2e: true, dev: false, ai: 'live', openRouterApiKey: 'fake-first-key' })),
  ))
  const generate = AiProvider.use(p => p.generate(tasks.titleTopic, { topicId: 't:C:test' as TopicId, channel: 'eng', messages: [] }))
  try {
    expect(await runtime.runPromise(generate)).toMatchObject({ value: 'First provider' })
    host.deliver({ _tag: 'aiKey', key: 'fake-next-key' })
    await waitFor(async () => (await runtime.runPromise(AiCredentials.use(c => c.revision))) === 1 || undefined)
    expect(await runtime.runPromise(generate)).toMatchObject({ value: 'Second provider' })
  } finally {
    await runtime.dispose()
    provider.mockRestore()
  }
})
