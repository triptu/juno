import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect, Layer, ManagedRuntime } from 'effect'
import { prefs, transaction } from '@juno/store'
import { expect, it, vi } from 'vitest'
import { AiCredentials } from '../src/aiCredentials'
import { AiWarmup } from '../src/aiWarmup'
import { EngineConfig } from '../src/config'
import { HostLink, memoryHost } from '../src/protocol/host'
import { Workspace } from '../src/workspace'

it('warms once after paint and enabling AI, without a model call', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'juno-warm-'))
  const host = memoryHost()
  const request = vi.fn(async () => new Response(null))
  vi.stubGlobal('fetch', request)
  const runtime = ManagedRuntime.make(AiWarmup.pipe(
    Layer.provideMerge(Workspace.layer),
    Layer.provide(AiCredentials.layer),
    Layer.provide(HostLink.layer(host)),
    Layer.provide(EngineConfig.layer({ userData: dir, e2e: true, dev: false, ai: 'live', openRouterApiKey: 'fake-key' })),
  ))
  try {
    const open = await runtime.runPromise(Workspace.use(w => w.open('fake-team')))
    const enabled = (value: boolean) => runtime.runPromise(transaction(prefs.set('aiAssist', value)).pipe(Effect.provide(open.context)))
    await enabled(false)
    expect(request).not.toHaveBeenCalled()
    host.deliver({ _tag: 'painted' })
    await enabled(true)
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    expect(request).toHaveBeenCalledWith('https://openrouter.ai/api/v1/models', expect.objectContaining({ method: 'HEAD' }))
    host.deliver({ _tag: 'painted' })
    await enabled(false)
    await enabled(true)
    expect(request).toHaveBeenCalledTimes(1)
  } finally {
    await runtime.dispose()
    vi.unstubAllGlobals()
    await rm(dir, { recursive: true, force: true })
  }
})
