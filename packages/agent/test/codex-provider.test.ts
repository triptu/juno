import { purgeCodexThreads } from '../src/providers/codex-purge'
import { existsSync } from 'node:fs'
import { afterEach, beforeEach, expect, it } from 'bun:test'
import { startFakeCodex, startFakeMcpServer } from '@juno/agent-testing'
import { createCodexAdapter } from '../src/index'
import { providerHarness, request } from './providers-harness'
import { deferred } from './turns-harness'

let h: Awaited<ReturnType<typeof providerHarness>>
let fake: ReturnType<typeof startFakeCodex>
let server: Awaited<ReturnType<typeof startFakeMcpServer>>
/** Resolves at the first call that reaches Juno's tool server. */
let called: Promise<void>
beforeEach(async () => {
  h = await providerHarness()
  fake = startFakeCodex()
  const reached = deferred()
  called = reached.promise
  server = await startFakeMcpServer({ tools: [{ name: 'echo', call: args => { reached.resolve(); return String(args.text) } }], bearer: 'test-turn-token' })
})
afterEach(async () => { await server.close(); fake.close(); await h.close() })

it('requires sign-in in its own home, uses approval mode and runs a fresh isolated thread', async () => {
  const guard = h.guard()
  const codex = createCodexAdapter({ agentDir: h.dir, guard, executable: () => fake.path })
  const model = { ...h.model, id: 'gpt-6.1-sol', provider: 'openai-codex', contextWindow: 272_000 }
  const { revision, context } = request()
  const input = { revision, prompt: String(context.messages.at(-1)!.content), model, mcp: { url: server.url, token: 'test-turn-token' } }
  expect(await codex.status()).toBe('signedOut')
  expect(await codex.turn(input)).toMatchObject({ kind: 'failed', failure: { ending: { _tag: 'failed', reason: 'codexSignedOut' } } })
  expect(fake.invocations().filter(i => i.command === 'exec')).toHaveLength(0)
  expect(guard.spend.snapshot().codexTurns).toBe(0)
  fake.signIn(codex.home)
  expect(codex.home).not.toBe(fake.home)
  expect(codex.loginEnvironment().CODEX_HOME).toBe(codex.home)
  expect(await codex.status()).toBe('signedIn')
  expect(await codex.listModels()).toContain('gpt-6.1-sol')
  fake.script([{ toolCalls: [{ server: 'juno', tool: 'echo', arguments: { text: 'ping' } }], reply: '{{result}}' }, { reply: 'second' }])
  expect(await codex.turn(input)).toMatchObject({ kind: 'done', text: 'ping' })
  expect(await codex.turn(input)).toMatchObject({ kind: 'done', text: 'second' })
  const turns = fake.invocations().filter(i => i.command === 'exec')
  expect(turns).toHaveLength(2)
  for (const turn of turns) {
    expect(turn).toMatchObject({ home: codex.home, sandbox: 'read-only', config: {
      approval_policy: 'never', mcp_servers: { juno: { default_tools_approval_mode: 'approve' } },
      features: { shell_tool: false, apps: false, memories: false },
    } })
    expect(turn.prompt).toBe(input.prompt)
    expect(existsSync(turn.cwd!)).toBe(false)
  }
  expect(fake.invocations().every(i => i.home === codex.home)).toBe(true)
  expect(turns[0]!.cwd).not.toBe(turns[1]!.cwd)
  expect(server.calls).toHaveLength(1)
  expect(server.rejected()).toBe(0)
  expect(guard.spend.snapshot()).toMatchObject({ codexTurns: 2, reserved: 0, actual: 0 })
  fake.signOut(codex.home)
  expect(await codex.status()).toBe('signedOut')
})

it('reuses a session thread, rotates at the bound, and never resumes after removal', async () => {
  const guard = h.guard()
  const codex = createCodexAdapter({ agentDir: h.dir, guard, executable: () => fake.path,
    threadExists: id => h.core.store.db.prepare('SELECT 1 FROM codex_turns WHERE thread_id = ?').get(id) !== undefined })
  fake.signIn(codex.home)
  const input = { revision: request().revision, prompt: 'hello', model: { ...h.model, id: 'gpt-6.1-sol', contextWindow: 272_000 }, sessionId: 'chat', mcp: { url: server.url, token: 'test-turn-token' } }
  fake.script([{ reply: 'one' }, { reply: 'two', usage: { input_tokens: 260_000, output_tokens: 10 } }, { reply: 'three' }, { reply: 'four' }])
  const first = await codex.turn(input)
  const second = await codex.turn(input)
  expect(second.threadId).toBe(first.threadId)
  const third = await codex.turn(input)
  expect(third.threadId).not.toBe(second.threadId)
  expect(await purgeCodexThreads(h.core.store)).toBe(2)
  const fourth = await codex.turn(input)
  expect(fourth.threadId).not.toBe(third.threadId)
  expect(fake.invocations().filter(i => i.command === 'exec').map(i => i.args.includes('resume'))).toEqual([false, true, false, false])
})

it('refuses built-ins while allowing only the bearer-authenticated Juno MCP tools', async () => {
  const codex = createCodexAdapter({ agentDir: h.dir, guard: h.guard(), executable: () => fake.path })
  fake.signIn(codex.home)
  fake.script([{ builtIns: ['shell', 'edit', 'web'], reply: 'done' }])
  const result = await codex.turn({ revision: request().revision, prompt: 'try built-ins', model: h.model, mcp: { url: server.url, token: 'test-turn-token' } })
  expect(result.kind).toBe('done')
  expect(fake.invocations().find(i => i.command === 'exec')?.toolCalls.map(c => c.status)).toEqual(['failed', 'failed', 'failed'])
})

it('reports missing, quota and process crash distinctly without retrying a tool', async () => {
  const missing = createCodexAdapter({ agentDir: h.dir, guard: h.guard(), executable: () => `${fake.path}-missing` })
  const input = { revision: request().revision, prompt: 'hello', model: h.model, mcp: { url: server.url, token: 'test-turn-token' } }
  expect(await missing.status()).toBe('missing')
  expect(await missing.turn(input)).toMatchObject({ kind: 'failed', failure: { ending: { reason: 'codexMissing' } } })
  const codex = createCodexAdapter({ agentDir: h.dir, guard: h.guard(), executable: () => fake.path })
  fake.signIn(codex.home)
  fake.script([{ fail: 'You have hit your usage limit' }, { toolCalls: [{ server: 'juno', tool: 'echo', arguments: { text: 'once' } }], crash: true }])
  expect(await codex.turn(input)).toMatchObject({ kind: 'failed', failure: { ending: { reason: 'codexQuota' } } })
  expect(await codex.turn(input)).toMatchObject({ kind: 'failed', failure: { ending: { reason: 'codexCrash' } } })
  expect(server.calls).toHaveLength(1)
  expect(fake.invocations().filter(i => i.command === 'exec')).toHaveLength(2)
})

it('removal drains an active writer and purges even a session without a recorded id', async () => {
  const codex = createCodexAdapter({ agentDir: h.dir, guard: h.guard(), executable: () => fake.path })
  fake.signIn(codex.home)
  fake.script([{ toolCalls: [{ server: 'juno', tool: 'echo', arguments: { text: 'started' } }], delayMs: 10_000 }])
  const running = codex.turn({ revision: request().revision, prompt: 'hello', model: h.model, mcp: { url: server.url, token: 'test-turn-token' } })
  await called
  // Crash window: a file exists before its id has been committed to Juno.
  h.core.store.db.prepare('UPDATE codex_turns SET thread_id = NULL').run()
  expect(await purgeCodexThreads(h.core.store)).toBe(1)
  expect(await running).toMatchObject({ kind: 'failed', failure: { ending: { _tag: 'interrupted' } } })
  expect(h.guard().spend.snapshot().codexTurns).toBe(1)
})
