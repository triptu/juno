// S3: driving the local Codex CLI (0.162.1) from Juno. Uses the owner's ChatGPT sign-in, so it
// spends a little of that subscription (one short turn). No API key involved.
//   1. The model list, through `codex app-server` (JSON-RPC over stdio).
//   2. One turn through @openai/codex-sdk: an empty temp directory, read-only sandbox, built-in tools
//      turned off where config allows, and Juno's tools offered by a loopback MCP server that requires
//      a per-turn bearer token.
// Run: node docs/juno-agent/spikes/s3-codex.ts
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Codex } from '@openai/codex-sdk'

// 1. Model list.
async function listModels() {
  const child = spawn('codex', ['app-server'], { stdio: ['pipe', 'pipe', 'ignore'] })
  const send = (msg: object) => child.stdin.write(`${JSON.stringify(msg)}\n`)
  const lines: string[] = []
  let buffer = ''
  const done = new Promise<any>((resolve) => {
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      let at: number
      while ((at = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, at)
        buffer = buffer.slice(at + 1)
        lines.push(line)
        const msg = JSON.parse(line)
        if (msg.id === 2) resolve(msg.result)
      }
    })
  })
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'juno-spike', version: '0' } } })
  send({ jsonrpc: '2.0', method: 'initialized' })
  send({ jsonrpc: '2.0', id: 2, method: 'model/list', params: {} })
  const result = await done
  child.kill()
  return (result.data as Array<{ id: string; isDefault: boolean; hidden: boolean }>).map((m) => `${m.id}${m.isDefault ? ' (default)' : ''}${m.hidden ? ' (hidden)' : ''}`)
}

// 2. A loopback MCP server with one tool, Streamable HTTP with JSON responses, bearer token required.
function startMcp(token: string) {
  const seen = { authorized: 0, rejected: 0, calls: [] as unknown[] }
  const reply = (res: ServerResponse, id: unknown, result: object) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ jsonrpc: '2.0', id, result }))
  }
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.headers.authorization !== `Bearer ${token}`) {
      seen.rejected++
      res.writeHead(401).end()
      return
    }
    seen.authorized++
    if (req.method !== 'POST') {
      res.writeHead(405).end()
      return
    }
    let body = ''
    for await (const chunk of req) body += chunk
    const msg = JSON.parse(body)
    if (msg.id === undefined) {
      res.writeHead(202).end()
      return
    }
    if (msg.method === 'initialize') {
      reply(res, msg.id, { protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'juno', version: '0' } })
    } else if (msg.method === 'tools/list') {
      reply(res, msg.id, {
        tools: [
          {
            name: 'juno_echo',
            description: 'Echo text back, prefixed with JUNO.',
            inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
          },
        ],
      })
    } else if (msg.method === 'tools/call') {
      seen.calls.push(msg.params)
      reply(res, msg.id, { content: [{ type: 'text', text: `JUNO:${msg.params.arguments.text}` }] })
    } else {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'not found' } }))
    }
  })
  return new Promise<{ url: string; seen: typeof seen; close: () => void }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number }
      resolve({ url: `http://127.0.0.1:${port}/mcp`, seen, close: () => server.close() })
    })
  })
}

console.log(`models from codex app-server: ${(await listModels()).join(', ')}`)

const token = randomBytes(24).toString('hex')
const mcp = await startMcp(token)
const cwd = mkdtempSync(join(tmpdir(), 'juno-codex-'))
try {
  const codex = new Codex({
    env: { ...(process.env as Record<string, string>), JUNO_MCP_TOKEN: token },
    config: {
      features: {
        shell_tool: false,
        apps: false,
        plugins: false,
        image_generation: false,
        browser_use: false,
        computer_use: false,
        in_app_browser: false,
        memories: false,
      },
      include_permissions_instructions: false,
      include_apps_instructions: false,
      include_environment_context: false,
      mcp_servers: { juno: { url: mcp.url, bearer_token_env_var: 'JUNO_MCP_TOKEN', default_tools_approval_mode: 'approve' } },
    },
  })
  const thread = codex.startThread({
    model: 'gpt-6.1-sol',
    workingDirectory: cwd,
    skipGitRepoCheck: true,
    sandboxMode: 'read-only',
    approvalPolicy: 'never',
    networkAccessEnabled: false,
    webSearchMode: 'disabled',
    modelReasoningEffort: 'low',
  })
  const started = performance.now()
  let firstEventMs = 0
  let firstTextMs = 0
  const items: Array<{ type: string; detail: string }> = []
  const { events } = await thread.runStreamed('Call the juno_echo tool with text "ping", then reply with exactly what it returned.')
  let usage: unknown
  for await (const event of events) {
    if (!firstEventMs) firstEventMs = performance.now() - started
    if (event.type === 'item.completed') {
      const item = event.item
      if (item.type === 'agent_message' && !firstTextMs) firstTextMs = performance.now() - started
      const detail =
        item.type === 'mcp_tool_call' ? `${item.server}.${item.tool} ${item.status}` :
        item.type === 'agent_message' ? JSON.stringify(item.text) :
        item.type === 'command_execution' ? item.command : ''
      items.push({ type: item.type, detail })
    }
    if (event.type === 'turn.completed') usage = event.usage
    if (event.type === 'turn.failed') console.log(`turn failed: ${event.error.message}`)
  }
  const total = performance.now() - started
  console.log(`thread id: ${thread.id ? 'set' : 'missing'}`)
  console.log(`items: ${items.map((i) => `${i.type}${i.detail ? `[${i.detail}]` : ''}`).join(', ')}`)
  console.log(`MCP: ${mcp.seen.authorized} authorized requests, ${mcp.seen.rejected} rejected, ${mcp.seen.calls.length} tool calls`)
  console.log(`latency: first event ${firstEventMs.toFixed(0)} ms, first text ${firstTextMs.toFixed(0)} ms, turn ${total.toFixed(0)} ms`)
  console.log(`usage: ${JSON.stringify(usage)}`)
  console.log(`files written to the working directory: ${readdirSync(cwd).length}`)
} finally {
  mcp.close()
  rmSync(cwd, { recursive: true, force: true })
}
