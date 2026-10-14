/**
 * A fake Codex CLI for the Codex harness (plan v3 §7.2, WP20). Pass `path` as
 * the SDK's `codexPathOverride`. The SDK then drives it exactly as it drives
 * the real binary, and each turn's MCP tool calls really reach the loopback
 * server named in the config, with its bearer token.
 *
 * The binary is a small shell wrapper with the fake's directory baked in, so
 * it works whatever `env` the SDK is given. Sign-in lives in
 * `$CODEX_HOME/auth.json`, as with the real CLI, so a test can check that Juno
 * runs Codex with its own home (spikes.md, S3 isolation gap).
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AUTH_FILE, LOG_FILE, NEXT_TURN_FILE, SCRIPT_FILE, type CodexInvocation, type CodexModel, type CodexScript, type CodexTurn } from './types'

/** What `codex app-server` `model/list` returned in S3. */
export const codexModels: ReadonlyArray<CodexModel> = [
  { id: 'gpt-6.1-sol', isDefault: true },
  { id: 'gpt-6-astra' }, { id: 'gpt-6-sol' }, { id: 'gpt-6-luna' },
  { id: 'gpt-5.6-sol' }, { id: 'gpt-5.6-terra' }, { id: 'gpt-5.6-luna' },
]

export interface FakeCodexOptions {
  /** Signs in the default home. Default true. */
  readonly signedIn?: boolean
  readonly models?: ReadonlyArray<CodexModel>
}

export interface FakeCodex {
  /** The executable, for `new Codex({ codexPathOverride })`. */
  readonly path: string
  /** The `CODEX_HOME` used when the environment sets none. */
  readonly home: string
  /** Replaces the turns. Each `exec` takes the next one; with none left the turn fails. */
  readonly script: (turns: ReadonlyArray<CodexTurn>) => void
  /** Signs in or out the given home (default `home`), as `codex login` and `codex logout` do. */
  readonly signIn: (home?: string) => void
  readonly signOut: (home?: string) => void
  /** Every run of the binary, in order. */
  readonly invocations: () => ReadonlyArray<CodexInvocation>
  readonly close: () => void
}

const bin = fileURLToPath(new URL('./bin.ts', import.meta.url))
const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`

export function startFakeCodex(options: FakeCodexOptions = {}): FakeCodex {
  const dir = mkdtempSync(join(tmpdir(), 'juno-fake-codex-'))
  const home = join(dir, 'home')
  const models = options.models ?? codexModels
  const write = (turns: ReadonlyArray<CodexTurn>) => {
    const script: CodexScript = { models, turns }
    writeFileSync(join(dir, SCRIPT_FILE), JSON.stringify(script))
    rmSync(join(dir, NEXT_TURN_FILE), { force: true })
  }
  const signIn = (at = home) => {
    mkdirSync(at, { recursive: true })
    writeFileSync(join(at, AUTH_FILE), JSON.stringify({ auth_mode: 'chatgpt' }))
  }
  write([])
  if (options.signedIn ?? true) signIn()
  const path = join(dir, 'codex')
  writeFileSync(path, `#!/bin/sh\nJUNO_FAKE_CODEX_DIR=${quote(dir)} exec ${quote(process.execPath)} --no-warnings ${quote(bin)} "$@"\n`)
  chmodSync(path, 0o755)
  return {
    path,
    home,
    script: write,
    signIn,
    signOut: (at = home) => rmSync(join(at, AUTH_FILE), { force: true }),
    invocations: () => {
      const file = join(dir, LOG_FILE)
      if (!existsSync(file)) return []
      return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as CodexInvocation)
    },
    close: () => rmSync(dir, { recursive: true, force: true }),
  }
}
