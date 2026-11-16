import { testDurability } from '@juno/agent-testing'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'bun:test'
import { fakeProvider, startFakeCodex } from '@juno/agent-testing'
import { createProviderGuard, openTurns } from '../src/index'
import { defineTool } from '../src/request/tool'
import { createJunoSettings } from '../src/settings/settings'
import { modelPicker } from '../src/providers/picker'
import { providerConnection } from '../src/providers/connection'

const cleanup: Array<() => Promise<void> | void> = []
afterEach(async () => { for (const close of cleanup.splice(0).toReversed()) await close() })

it('runs a picked Codex turn through durable tools, shows waiting, and never repeats a crashed action', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'juno-codex-flow-'))
  cleanup.push(() => rm(dir, { recursive: true, force: true }))
  const fake = startFakeCodex()
  cleanup.push(() => fake.close())
  fake.signIn(join(dir, 'codex'))
  const transport = fakeProvider()
  let actions = 0
  const options = {
    agentDir: dir,
    provider: (store: Parameters<typeof createProviderGuard>[0]['store']) => createProviderGuard({ store, transport: transport.models, codex: { agentDir: dir, executable: () => fake.path } }),
    model: { provider: 'openai-codex', modelId: 'gpt-6.1-sol' },
    tools: () => [defineTool({ name: 'test_action', description: 'Test action', parameters: { type: 'object', properties: {} }, replay: 'unsafe', status: () => 'Running test action', run: async () => { actions++; return { text: 'done' } } })],
  }
  let turns = await openTurns({ ...options, durability: testDurability })
  if (turns._tag !== 'running') throw new Error('not running')
  cleanup.push(() => turns.close())
  const connection = providerConnection()
  connection.set(null)
  const picker = modelPicker(connection, { codex: { agentDir: dir, executable: () => fake.path }, fetch: async () => new Response('{}', { status: 503 }) })
  const settings = createJunoSettings({ turns, picker, connection, agentDir: dir })
  cleanup.push(() => settings.close())
  await settings.ready
  fake.signOut(join(dir, 'codex'))
  await picker.refresh(turns.store)
  expect(settings.page().chatModels.some(row => row.provider === 'codex')).toBe(false)
  expect(settings.page().codex._tag).toBe('signedOut')
  fake.signIn(join(dir, 'codex'))
  await picker.refresh(turns.store)
  const codexChoice = settings.page().chatModels.find(row => row.provider === 'codex')
  expect(codexChoice).toMatchObject({ family: 'GPT Sol', price: expect.stringContaining('Uses your ChatGPT plan') })
  expect(settings.change({ _tag: 'model', purpose: 'chat', provider: 'codex', family: 'GPT Sol' })).toEqual({ _tag: 'done' })
  expect(settings.page().chatModels.filter(row => row.selected)).toHaveLength(1)
  expect(turns.guard.spend.setCap(0)).toBe(true)
  const events: unknown[] = []
  const active = turns
  turns.subscribe(event => {
    events.push(event)
    if (event._tag === 'status' && event.text === 'Running test action') active.accept({ kind: 'send', opId: 'steer', text: 'Tell me when done' })
  })
  fake.script([{ delayMs: 50, reply: '<say>First reply.</say>' }, { toolCalls: [{ server: 'juno', tool: 'test_action' }], crash: true }])
  turns.accept({ kind: 'send', opId: 'first', text: 'Hello' })
  await turns.idle()
  expect(events).toContainEqual(expect.objectContaining({ _tag: 'status', text: 'Waiting for Codex' }))
  expect(events).toContainEqual(expect.objectContaining({ _tag: 'bubble', text: 'First reply.' }))
  turns.accept({ kind: 'send', opId: 'second', text: 'Do the test action' })
  await turns.idle()
  expect(events).toContainEqual(expect.objectContaining({ _tag: 'ended', ending: expect.objectContaining({ _tag: 'failed', reason: 'codexCrash' }) }))
  expect(actions).toBe(1)
  expect(turns.guard.spend.snapshot()).toMatchObject({ codexTurns: 2, actual: 0, reserved: 0 })
  expect(settings.page().chatModels.find(row => row.provider === 'codex')?.price).toContain('2 turns today')
  settings.close()
  await turns.close()
  turns = await openTurns({ ...options, durability: testDurability })
  if (turns._tag !== 'running') throw new Error('not running')
  await turns.idle()
  expect(actions).toBe(1)
  expect(fake.invocations().filter(i => i.command === 'exec')).toHaveLength(2)
})
