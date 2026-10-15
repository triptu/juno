import { execFile, spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { promisify } from 'node:util'
import { Schema } from 'effect'
const exec = promisify(execFile)
const Listing = Schema.Struct({ id: Schema.Number, result: Schema.optionalKey(Schema.Unknown) })
const ModelList = Schema.Struct({ data: Schema.Array(Schema.Struct({ id: Schema.String, hidden: Schema.optionalKey(Schema.Boolean) })), nextCursor: Schema.optionalKey(Schema.NullOr(Schema.String)) })
const decodeListing = Schema.decodeUnknownOption(Listing)
export type CodexStatus = 'signedIn' | 'signedOut' | 'missing'

export function createCodexLocal(options: { readonly agentDir: string; readonly executable: string }) {
  const home = resolve(options.agentDir, 'codex')
  const env: Record<string, string> = { CODEX_HOME: home }
  // No inherited keys, Codex configuration or MCP credentials.
  for (const name of ['PATH', 'HOME', 'TMPDIR', 'SYSTEMROOT']) {
    const value = process.env[name]
    if (value !== undefined) env[name] = value
  }
  const status = async (): Promise<CodexStatus> => {
    await mkdir(home, { recursive: true, mode: 0o700 })
    try {
      const result = await exec(options.executable, ['login', 'status'], { env, timeout: 10_000, maxBuffer: 64 * 1024 })
      return /ChatGPT/i.test(result.stdout + result.stderr) ? 'signedIn' : 'signedOut'
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return 'missing'
      if (error instanceof Error && /not logged in|signed out/i.test(error.message)) return 'signedOut'
      throw error
    }
  }
  return {
    home,
    environment: env,
    version: async () => (await exec(options.executable, ['--version'], { env, timeout: 10_000, maxBuffer: 4096 })).stdout.trim(),
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
  }
}
