// The fake Codex binary, driven by the real Codex SDK.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { afterEach, beforeEach, expect, it } from 'bun:test'
import { Codex } from '@openai/codex-sdk'
import { startFakeCodex, startFakeMcpServer, type FakeCodex, type FakeMcpServer } from '../src/index'

let codex: FakeCodex
let mcp: FakeMcpServer
let cwd: string
const token = 'per-turn-token'
beforeEach(async () => {
  codex = startFakeCodex()
  mcp = await startFakeMcpServer({ tools: [{ name: 'juno_echo', call: (args) => `echo:${String(args.text)}` }], bearer: token })
  cwd = mkdtempSync(join(tmpdir(), 'juno-codex-cwd-'))
})
afterEach(async () => {
  codex.close()
  await mcp.close()
  rmSync(cwd, { recursive: true, force: true })
})

const juno = (approve: boolean) => ({ url: mcp.url, bearer_token_env_var: 'JUNO_MCP_TOKEN', ...(approve ? { default_tools_approval_mode: 'approve' } : {}) })
const thread = (options: { approve?: boolean; env?: Record<string, string> } = {}) =>
  new Codex({ codexPathOverride: codex.path, env: { JUNO_MCP_TOKEN: token, ...options.env }, config: { mcp_servers: { juno: juno(options.approve ?? true) } } })
    .startThread({ model: 'gpt-6.1-sol', sandboxMode: 'read-only', approvalPolicy: 'never', workingDirectory: cwd, skipGitRepoCheck: true })

it('runs a turn whose tool call reaches Juno\'s server with the bearer token', async () => {
  codex.script([{ toolCalls: [{ server: 'juno', tool: 'juno_echo', arguments: { text: 'ping' } }], reply: 'JUNO:{{result}}' }])
  const turn = await thread().run('Call juno_echo with "ping".')
  expect(turn.finalResponse).toBe('JUNO:echo:ping')
  expect(turn.usage).toMatchObject({ input_tokens: 20_000, output_tokens: 110 })
  expect(mcp.calls).toEqual([{ name: 'juno_echo', args: { text: 'ping' } }])
  expect(mcp.rejected()).toBe(0)
  expect(codex.invocations()).toMatchObject([{ command: 'exec', model: 'gpt-6.1-sol', sandbox: 'read-only', prompt: 'Call juno_echo with "ping".', config: { approval_policy: 'never' } }])
})

it('refuses MCP calls in approval mode unless the server approves its tools', async () => {
  codex.script([{ toolCalls: [{ server: 'juno', tool: 'juno_echo', arguments: { text: 'ping' } }], reply: 'done' }])
  const turn = await thread({ approve: false }).run('Call juno_echo.')
  expect(turn.items.find((item) => item.type === 'mcp_tool_call')).toMatchObject({ status: 'failed', error: { message: 'MCP tool call requires approval' } })
  expect(mcp.calls).toEqual([])
})

it('fails a turn when signed out, including in a home of its own', async () => {
  codex.signOut()
  await expect(thread().run('hi')).rejects.toThrow(/Not logged in/)
  const home = mkdtempSync(join(tmpdir(), 'juno-codex-home-'))
  try {
    codex.signIn()
    await expect(thread({ env: { CODEX_HOME: home } }).run('hi')).rejects.toThrow(/Not logged in/)
    codex.signIn(home)
    codex.script([{ reply: 'hello' }])
    expect((await thread({ env: { CODEX_HOME: home } }).run('hi')).finalResponse).toBe('hello')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

it('reports a scripted turn failure', async () => {
  codex.script([{ fail: 'You have hit your usage limit.' }])
  await expect(thread().run('hi')).rejects.toThrow('You have hit your usage limit.')
})

it('lists models over app-server', async () => {
  const child = spawn(codex.path, ['app-server'], { stdio: ['pipe', 'pipe', 'inherit'] })
  const lines = createInterface({ input: child.stdout })
  const answers: Array<{ id: number; result: { data?: Array<{ id: string; isDefault: boolean }> } }> = []
  const done = new Promise<void>((resolve) => lines.on('line', (line) => {
    answers.push(JSON.parse(line))
    if (answers.length === 2) resolve()
  }))
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'juno-test', version: '0' } } })}\n`)
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'initialized' })}\n`)
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'model/list', params: {} })}\n`)
  await done
  child.kill()
  const models = answers.find((a) => a.id === 2)!.result.data!
  expect(models[0]).toMatchObject({ id: 'gpt-6.1-sol', isDefault: true })
  expect(models.map((m) => m.id)).toContain('gpt-5.6-luna')
})
