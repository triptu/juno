import { existsSync } from 'node:fs'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { startFakeCodex, startFakeMcpServer } from '@juno/agent-testing'
import { createCodexAdapter } from '../src/index'
import { providerHarness, request } from './providers-harness'

let h: Awaited<ReturnType<typeof providerHarness>>
let fake: ReturnType<typeof startFakeCodex>
let server: Awaited<ReturnType<typeof startFakeMcpServer>>
beforeEach(async () => {
  h = await providerHarness()
  fake = startFakeCodex()
  server = await startFakeMcpServer({ tools: [{ name: 'echo', call: args => String(args.text) }], bearer: 'test-turn-token' })
})
afterEach(async () => { await server.close(); fake.close(); await h.close() })

it('requires sign-in in its own home, uses approval mode and runs a fresh isolated thread', async () => {
  const guard = h.guard()
  const codex = createCodexAdapter({ agentDir: h.dir, guard, executable: fake.path })
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
