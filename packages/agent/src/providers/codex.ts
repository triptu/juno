import { execFile, spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { promisify } from 'node:util'
import { Schema } from 'effect'
import { Codex } from '@openai/codex-sdk'
import type { Api, Model } from '@earendil-works/pi-ai'
import { AdmissionError, providerFailure, type ProviderFailure, type ProviderGuardApi, type Revision } from './guard'

const exec = promisify(execFile)
const Listing = Schema.Struct({ id: Schema.Number, result: Schema.optionalKey(Schema.Unknown) })
const ModelList = Schema.Struct({ data: Schema.Array(Schema.Struct({ id: Schema.String, hidden: Schema.optionalKey(Schema.Boolean) })), nextCursor: Schema.optionalKey(Schema.NullOr(Schema.String)) })
const decodeListing = Schema.decodeUnknownOption(Listing)
export interface CodexOptions {
  readonly agentDir: string
  readonly guard: ProviderGuardApi
  /** The bundled CLI in production; startFakeCodex().path in tests. */
  readonly executable: string
}
export type CodexResult = { readonly kind: 'done'; readonly text: string; readonly threadId: string | null }
  | { readonly kind: 'failed'; readonly failure: ProviderFailure; readonly threadId: string | null }

/** WP20 owns the durable juno.harnessTurn task and the per-turn MCP server. */
export function createCodexAdapter(options: CodexOptions) {
  const home = resolve(options.agentDir, 'codex')
  const env: Record<string, string> = { CODEX_HOME: home }
  // No inherited keys, Codex configuration or MCP credentials.
  for (const name of ['PATH', 'HOME', 'TMPDIR', 'SYSTEMROOT']) {
    const value = process.env[name]
    if (value !== undefined) env[name] = value
  }
  const status = async (): Promise<'signedIn' | 'signedOut'> => {
    await mkdir(home, { recursive: true, mode: 0o700 })
    try {
      await exec(options.executable, ['login', 'status'], { env, timeout: 10_000, maxBuffer: 64 * 1024 })
      return 'signedIn'
    } catch (error) {
      if (error instanceof Error && /not logged in|signed out/i.test(error.message)) return 'signedOut'
      throw error
    }
  }
  return {
    home,
    status,
    /** No login is started implicitly. Settings must sign in using this home. */
    loginEnvironment: () => ({ ...env }),
    listModels: async (): Promise<readonly string[] | undefined> => {
      await mkdir(home, { recursive: true, mode: 0o700 })
      return new Promise(resolveModels => {
        const child = spawn(options.executable, ['app-server'], { env, stdio: ['pipe', 'pipe', 'ignore'] })
        const lines = createInterface({ input: child.stdout })
        let finished = false
        const ids: string[] = []
        const cursors = new Set<string>()
        const finish = (listed?: readonly string[]) => {
          if (finished) return
          finished = true
          clearTimeout(timer)
          lines.close()
          child.kill()
          resolveModels(listed)
        }
        const timer = setTimeout(() => finish(), 10_000)
        child.on('error', () => finish())
        child.on('exit', () => finish())
        child.stdin.on('error', () => finish())
        lines.on('line', line => {
          try {
            const decoded = decodeListing(JSON.parse(line))
            if (decoded._tag !== 'Some') return
            if (decoded.value.id === 1) {
              child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'initialized' })}\n`)
              child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'model/list', params: {} })}\n`)
            } else if (decoded.value.id === 2) {
              const page = Schema.decodeUnknownSync(ModelList)(decoded.value.result)
              ids.push(...page.data.filter(m => !m.hidden).map(m => m.id))
              if (!page.nextCursor) finish(ids)
              else if (cursors.has(page.nextCursor)) finish()
              else {
                cursors.add(page.nextCursor)
                child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'model/list', params: { cursor: page.nextCursor } })}\n`)
              }
            }
          } catch { finish() }
        })
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'juno', version: '0.1.0' } } })}\n`)
      })
    },
    turn: async (input: {
      /** What the builder built the prompt against, such as the admitted `Request`. */
      readonly revision: Revision
      readonly prompt: string
      readonly model: Model<Api>
      readonly mcp: { readonly url: string; readonly token: string }
      readonly signal?: AbortSignal
    }): Promise<CodexResult> => {
      let threadId: string | null = null
      let cwd: string | undefined
      try {
        if (await status() === 'signedOut') throw new AdmissionError({ _tag: 'failed', reason: 'codexSignedOut' })
        const endpoint = new URL(input.mcp.url)
        if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || !endpoint.port || endpoint.username || endpoint.password) {
          throw new Error('Codex tools require a loopback endpoint')
        }
        cwd = await mkdtemp(join(tmpdir(), 'juno-codex-turn-'))
        const codex = new Codex({ codexPathOverride: options.executable, env: { ...env, JUNO_MCP_TOKEN: input.mcp.token }, config: {
          mcp_servers: { juno: { url: input.mcp.url, bearer_token_env_var: 'JUNO_MCP_TOKEN', default_tools_approval_mode: 'approve' } },
          features: { shell_tool: false, apps: false, plugins: false, image_generation: false, browser_use: false,
            computer_use: false, in_app_browser: false, memories: false },
          include_permissions_instructions: false, include_apps_instructions: false, include_environment_context: false,
        } })
        const thread = codex.startThread({ model: input.model.id, workingDirectory: cwd, skipGitRepoCheck: true,
          sandboxMode: 'read-only', approvalPolicy: 'never', networkAccessEnabled: false, webSearchMode: 'disabled' })
        const prompt = options.guard.admitHarness(input.revision, input.model, input.prompt)
        input.signal?.throwIfAborted()
        const turnId = options.guard.spend.countCodex(home)
        const stream = await thread.runStreamed(prompt, { signal: input.signal })
        let text = ''
        let completed = false
        for await (const event of stream.events) {
          if (event.type === 'thread.started') {
            threadId = event.thread_id
            options.guard.spend.recordThread(turnId, threadId)
          } else if (event.type === 'item.completed' && event.item.type === 'agent_message') text = event.item.text
          else if (event.type === 'turn.completed') completed = true
          else if (event.type === 'turn.failed') throw new Error(event.error.message)
          else if (event.type === 'error') throw new Error(event.message)
        }
        if (!completed) throw new Error('terminated')
        return { kind: 'done', text, threadId }
      } catch (error) {
        return { kind: 'failed', failure: providerFailure(error), threadId }
      } finally {
        if (cwd) await rm(cwd, { recursive: true, force: true })
      }
    },
  }
}
