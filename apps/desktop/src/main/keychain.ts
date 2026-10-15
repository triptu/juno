/**
 * The OpenRouter key (SPEC 13.10, plan v3 §2.2, §7.2). The owner enters it
 * once in Settings › Juno; the renderer hands it to main
 * (`agent.setOpenRouterKey`), main stores it as a generic password in the
 * login keychain and sends it to the agent, which keeps it in memory. It is
 * never written to a file or to prefs, and never logged: errors from the
 * keychain are reported as `failed` with no detail.
 *
 * The keychain is reached through `/usr/bin/security`, as the dev session
 * cache does (`scripts/live-common.ts`). The value goes in on stdin of
 * `security -i`, never in argv, so no process listing shows it. `security`
 * created the item, so it reads it back without a prompt.
 *
 * `OPENROUTER_API_KEY` stays as a development override: when it is set, the
 * agent starts with it instead of the stored key. A key set in Settings
 * replaces it until the next launch. Under `JUNO_E2E` main uses a keychain
 * in memory, so tests never touch the real one.
 */
import { spawn } from 'node:child_process'

export interface Keychain {
  /** The stored value, or undefined when there is none. */
  readonly read: () => Promise<string | undefined>
  readonly write: (value: string) => Promise<void>
  readonly remove: () => Promise<void>
}

/** Runs `security` with `args`, writing `stdin` if given. Resolves with its exit code and stdout. */
export type SecurityRunner = (args: ReadonlyArray<string>, stdin?: string) => Promise<{ readonly code: number; readonly stdout: string }>

const runSecurity: SecurityRunner = (args, stdin) =>
  new Promise((resolve) => {
    // stderr is dropped: `security -i` may echo the command line it failed on.
    const child = spawn('/usr/bin/security', [...args], { stdio: ['pipe', 'pipe', 'ignore'], timeout: 30_000 })
    let stdout = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => (stdout += chunk))
    child.on('error', () => resolve({ code: 1, stdout: '' }))
    child.on('close', (code) => resolve({ code: code ?? 1, stdout }))
    child.stdin.end(stdin ?? '')
  })

export const OPENROUTER_SERVICE = 'juno-openrouter-key'
const ACCOUNT = 'openrouter'

/** A generic password in the login keychain. `service` and the value must hold no spaces or quotes (see `KEY_PATTERN`). */
export function macKeychain(service = OPENROUTER_SERVICE, run: SecurityRunner = runSecurity): Keychain {
  return {
    read: async () => {
      const answer = await run(['find-generic-password', '-w', '-s', service, '-a', ACCOUNT])
      const value = answer.stdout.trim()
      return answer.code === 0 && value !== '' ? value : undefined
    },
    write: async (value) => {
      // `-U` replaces an item with the same service and account.
      const answer = await run(['-i'], `add-generic-password -U -s ${service} -a ${ACCOUNT} -w ${value}\n`)
      if (answer.code !== 0) throw new Error('the keychain refused the write')
    },
    remove: async () => {
      const answer = await run(['delete-generic-password', '-s', service, '-a', ACCOUNT])
      // 44: no such item, which is the goal.
      if (answer.code !== 0 && answer.code !== 44) throw new Error('the keychain refused the delete')
    },
  }
}

/** For tests: the same contract, in memory. */
export function memoryKeychain(initial?: string): Keychain {
  let value = initial
  return {
    read: async () => value,
    write: async (next) => {
      value = next
    },
    remove: async () => {
      value = undefined
    },
  }
}

/** What an OpenRouter key looks like (`sk-or-v1-` and hex today). Anything else is refused before it reaches the keychain. */
export const KEY_PATTERN = /^[\w-]{16,256}$/

export type KeyResult = 'saved' | 'removed' | 'invalid' | 'failed'

/**
 * Main's copy of the key: loaded once at start (the development override,
 * else the keychain), changed from Settings, and sent to the agent on every
 * change through `send`. The agent supervisor resends the current key to
 * each new agent process.
 */
export class OpenRouterKeyStore {
  #current: string | null | undefined
  #loading: Promise<string | null> | undefined

  constructor(
    private readonly keychain: Keychain,
    /** `OPENROUTER_API_KEY`, outside tests. */
    private readonly override: string | undefined,
    private readonly send: (key: string | null) => void,
  ) {}

  /** The key now: undefined until `load` has finished. */
  get current(): string | null | undefined {
    return this.#current
  }

  load(): Promise<string | null> {
    this.#loading ??= (async () => {
      let key: string | null = this.override !== undefined && this.override !== '' ? this.override : null
      if (key === null) {
        try {
          key = (await this.keychain.read()) ?? null
        } catch {
          key = null
        }
      }
      // A set during the load wins.
      if (this.#current === undefined) {
        this.#current = key
        this.send(key)
      }
      return this.#current
    })()
    return this.#loading
  }

  /** Stores `key` in the keychain and hands it to the agent; `null` removes it. */
  async set(key: string | null): Promise<KeyResult> {
    const value = key?.trim() ?? null
    if (value !== null && !KEY_PATTERN.test(value)) return 'invalid'
    try {
      if (value === null) await this.keychain.remove()
      else await this.keychain.write(value)
    } catch {
      return 'failed'
    }
    this.#current = value
    this.send(value)
    return value === null ? 'removed' : 'saved'
  }
}
