import { testDurability } from '@juno/agent-testing'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildRequest } from '@juno/agent-memory'
import { fakeProvider } from '@juno/agent-testing'
import { openCore, SPEND_MIGRATIONS, createSpend, createProviderGuard, type Core } from '../src/index'

export async function providerHarness() {
  const dir = await mkdtemp(join(tmpdir(), 'juno-wp9-'))
  const fake = fakeProvider()
  let now = new Date(2026, 9, 14, 12).getTime()
  const options = { agentDir: dir, models: fake.models, model: { provider: 'openrouter', modelId: 'anthropic/claude-sonnet-5.5' },
    migrations: [SPEND_MIGRATIONS], now: () => now }
  let core = await openCore({ ...options, durability: testDurability })
  if (core._tag !== 'running') throw new Error('Fresh core did not open')
  const running = (): Core => {
    if (core._tag !== 'running') throw new Error('Core did not reopen')
    return core
  }
  const model = fake.model('anthropic/claude-sonnet-5.5')
  return {
    dir, fake, model,
    get core() { return running() },
    spend: () => createSpend(running().store),
    guard: () => createProviderGuard({ store: running().store, transport: fake.models }),
    nextDay: () => { now += 24 * 60 * 60 * 1000 },
    reopen: async () => { await core.close(); core = await openCore({ ...options, durability: testDurability }) },
    close: async () => { await core.close(); await rm(dir, { recursive: true, force: true }) },
  }
}
/** A request as WP11's builder admits it, and the context its hook would build from it. */
export function request(text = 'hello') {
  const built = buildRequest({ rev: 0, gen: 0, pins: { revision: 0, active: [] },
    covered: 0, h: 0, cutoff: 1, lines: [], tail: [], parents: [], systemAndTools: ['You are Juno.'],
    active: [{ kind: 'user', sourcePos: 0, sourceEnd: 1, text, metadata: '' }], contextWindow: 1_000_000 })
  if (built.kind !== 'admitted') throw new Error(`Builder refused the request: ${built.reason}`)
  return { revision: built, context: { messages: built.messages.map(content => ({ role: 'user' as const, content, timestamp: 0 })) } }
}
