// The fake `codex` executable. `startFakeCodex()` writes a wrapper that runs
// this file with the fake's directory in JUNO_FAKE_CODEX_DIR. It speaks the
// parts of Codex CLI 0.162.1 that Juno uses (spikes.md, S3):
//   codex exec --experimental-json [flags] [resume <id>]   JSONL events on stdout, prompt on stdin
//   codex app-server                                       JSON-RPC over stdio: initialize, model/list
//   codex login | login status | logout                    sign-in state in $CODEX_HOME/auth.json
// Each exec turn takes the next scripted turn and makes its MCP tool calls for
// real, over Streamable HTTP with the bearer token from `bearer_token_env_var`.
// Node runs it directly (type stripping), so it only uses erasable syntax.
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { randomUUID } from 'node:crypto'
import { McpClient, StreamableHttpTransport } from '@earendil-works/pi-mcp'
import { AUTH_FILE, LOG_FILE, NEXT_TURN_FILE, SCRIPT_FILE, type CodexInvocation, type CodexScript, type CodexToolOutcome, type CodexTurn } from './types.ts'

const dir = process.env.JUNO_FAKE_CODEX_DIR
if (!dir) {
  process.stderr.write('JUNO_FAKE_CODEX_DIR is not set\n')
  process.exit(2)
}
const home = process.env.CODEX_HOME ?? join(dir, 'home')
const auth = join(home, AUTH_FILE)
const args = process.argv.slice(2)
const command = args[0] ?? ''
const config: Record<string, unknown> = {}
const flags: Record<string, string> = {}
for (let i = 1; i < args.length; i++) {
  const arg = args[i]
  if (arg === '--config' || arg === '-c') {
    const entry = args[++i] ?? ''
    const at = entry.indexOf('=')
    setPath(config, entry.slice(0, at).trim(), tomlValue(entry.slice(at + 1).trim()))
  } else if (arg === '--model' || arg === '--sandbox' || arg === '--cd') {
    flags[arg.slice(2)] = args[++i] ?? ''
  }
}
const toolCalls: CodexToolOutcome[] = []
const log = (prompt?: string) => {
  const entry: CodexInvocation = {
    command, args, config, home, signedIn: existsSync(auth), toolCalls,
    ...(flags.model ? { model: flags.model } : {}), ...(flags.sandbox ? { sandbox: flags.sandbox } : {}),
    ...(flags.cd ? { cwd: flags.cd } : {}), ...(prompt !== undefined ? { prompt } : {}),
  }
  appendFileSync(join(dir, LOG_FILE), `${JSON.stringify(entry)}\n`)
}
const script = JSON.parse(readFileSync(join(dir, SCRIPT_FILE), 'utf8')) as CodexScript

if (command === '--version') {
  log()
  process.stdout.write('codex-cli 0.162.1\n')
} else if (command === 'login') {
  log()
  if (args[1] === 'status') {
    if (existsSync(auth)) process.stdout.write('Logged in using ChatGPT\n')
    else {
      process.stderr.write('Not logged in\n')
      process.exitCode = 1
    }
  } else {
    mkdirSync(home, { recursive: true })
    writeFileSync(auth, JSON.stringify({ auth_mode: 'chatgpt' }))
    process.stdout.write('Successfully logged in\n')
  }
} else if (command === 'logout') {
  log()
  rmSync(auth, { force: true })
  process.stdout.write('Successfully logged out\n')
} else if (command === 'app-server') {
  log()
  appServer()
} else if (command === 'exec') {
  await exec()
} else {
  log()
  process.stderr.write(`fake codex: unknown command ${command}\n`)
  process.exitCode = 2
}

function appServer() {
  const lines = createInterface({ input: process.stdin })
  lines.on('line', (line) => {
    const message = JSON.parse(line) as { id?: number | string; method: string }
    if (message.id === undefined) return
    const send = (body: object) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, ...body })}\n`)
    if (message.method === 'initialize') send({ result: { userAgent: 'codex_cli_rs/0.162.1 (fake)' } })
    else if (message.method === 'model/list') {
      send({ result: { data: script.models.map((m) => ({ id: m.id, model: m.id, displayName: m.id, isDefault: m.isDefault ?? false, hidden: m.hidden ?? false })), nextCursor: null } })
    } else send({ error: { code: -32601, message: `method not found: ${message.method}` } })
  })
}

async function exec() {
  let prompt = ''
  for await (const chunk of process.stdin) prompt += chunk
  if (!existsSync(auth)) {
    log(prompt)
    // Codex refuses to run a turn without a sign-in. The SDK reports the exit
    // code and stderr: "Codex Exec exited with code 1: ...".
    process.stderr.write('Error: Not logged in. Run `codex login` to sign in.\n')
    process.exitCode = 1
    return
  }
  const counter = join(dir!, NEXT_TURN_FILE)
  const index = existsSync(counter) ? Number(readFileSync(counter, 'utf8')) : 0
  writeFileSync(counter, String(index + 1))
  const turn: CodexTurn | undefined = script.turns[index]
  emit({ type: 'thread.started', thread_id: args.includes('resume') ? args[args.indexOf('resume') + 1] : randomUUID() })
  emit({ type: 'turn.started' })
  if (!turn) {
    log(prompt)
    emit({ type: 'turn.failed', error: { message: 'fake codex: no scripted turn left' } })
    return
  }
  let result = ''
  let n = 0
  for (const call of turn.toolCalls ?? []) {
    const id = `item_${n++}`
    const item = { id, type: 'mcp_tool_call', server: call.server, tool: call.tool, arguments: call.arguments ?? {} }
    emit({ type: 'item.started', item: { ...item, status: 'in_progress' } })
    const outcome = await callTool(call.server, call.tool, call.arguments ?? {})
    toolCalls.push({ server: call.server, tool: call.tool, status: outcome.error === undefined ? 'completed' : 'failed', ...(outcome.error !== undefined ? { error: outcome.error } : {}) })
    if (outcome.error !== undefined) {
      emit({ type: 'item.completed', item: { ...item, status: 'failed', error: { message: outcome.error } } })
    } else {
      result = outcome.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n')
      emit({ type: 'item.completed', item: { ...item, status: 'completed', result: { content: outcome.content, structured_content: null } } })
    }
  }
  if (turn.delayMs) await new Promise((resolve) => setTimeout(resolve, turn.delayMs))
  log(prompt)
  if (turn.fail !== undefined) {
    emit({ type: 'turn.failed', error: { message: turn.fail } })
    return
  }
  emit({ type: 'item.completed', item: { id: `item_${n}`, type: 'agent_message', text: (turn.reply ?? '{{result}}').replaceAll('{{result}}', result) } })
  const usage = turn.usage ?? { input_tokens: 20_000, output_tokens: 110 }
  emit({ type: 'turn.completed', usage: { cached_input_tokens: 0, reasoning_output_tokens: 0, cache_write_input_tokens: 0, ...usage } })
}

function emit(event: object) {
  process.stdout.write(`${JSON.stringify(event)}\n`)
}

type ToolContent = { type: string; text?: string }
async function callTool(server: string, tool: string, input: Record<string, unknown>): Promise<{ content: ToolContent[]; error?: undefined } | { error: string }> {
  const servers = (config.mcp_servers ?? {}) as Record<string, { url?: string; bearer_token_env_var?: string; default_tools_approval_mode?: string }>
  const entry = servers[server]
  if (!entry?.url) return { error: `unknown MCP server '${server}'` }
  // S3: with approval_policy "never", Codex refuses MCP calls unless the
  // server approves its tools by default.
  if (config.approval_policy === 'never' && entry.default_tools_approval_mode !== 'approve') {
    return { error: 'MCP tool call requires approval' }
  }
  const token = entry.bearer_token_env_var ? process.env[entry.bearer_token_env_var] : undefined
  const client = new McpClient({ name: 'codex-mcp-client', version: '0.162.1' })
  try {
    await client.connect(new StreamableHttpTransport({ url: entry.url, openGetStream: false, ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}) }))
    const called = await client.callTool(tool, input)
    if (called.isError) return { error: called.content.map((c) => ('text' in c ? c.text : '')).join('\n') }
    return { content: called.content as ToolContent[] }
  } catch (error) {
    return { error: (error as Error).message }
  } finally {
    await client.close().catch(() => {})
  }
}

function tomlValue(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

function setPath(target: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split('.').map((key) => key.replace(/^"|"$/g, ''))
  let node = target
  for (const key of keys.slice(0, -1)) node = (node[key] ??= {}) as Record<string, unknown>
  node[keys.at(-1)!] = value
}
