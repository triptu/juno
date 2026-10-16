/**
 * The keychain for Juno Agent's provider keys (SPEC 13.10, plan v3 §2.2,
 * §7.2): the OpenRouter key and a custom endpoint's key, each a generic
 * password in the login keychain. `providers.ts` decides what is stored;
 * keys are never written to a file or to prefs, and never logged: errors
 * from the keychain are reported as `failed` with no detail.
 *
 * The keychain is reached through `/usr/bin/security`, as the dev session
 * cache does (`scripts/live-common.ts`). The value goes in on stdin of
 * `security -i`, never in argv, so no process listing shows it. `security`
 * created the item, so it reads it back without a prompt.
 *
 * Under `JUNO_E2E` main uses a keychain in memory, so tests never touch the
 * real one.
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

/** The real `security`. A call that may wait on a macOS prompt needs a longer `timeoutMs`. */
export const securityRunner =
  (timeoutMs = 30_000): SecurityRunner =>
  (args, stdin) =>
    new Promise((resolve) => {
      // stderr is dropped: `security -i` may echo the command line it failed on.
      const child = spawn('/usr/bin/security', [...args], { stdio: ['pipe', 'pipe', 'ignore'], timeout: timeoutMs })
      let stdout = ''
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => (stdout += chunk))
      child.on('error', () => resolve({ code: 1, stdout: '' }))
      child.on('close', (code) => resolve({ code: code ?? 1, stdout }))
      child.stdin.end(stdin ?? '')
    })

export interface KeychainItem {
  readonly service: string
  readonly account: string
}
export const OPENROUTER_ITEM: KeychainItem = { service: 'juno-openrouter-key', account: 'openrouter' }
export const CUSTOM_ITEM: KeychainItem = { service: 'juno-custom-provider-key', account: 'custom' }

/** A generic password in the login keychain. The item's names and the value must hold no spaces or quotes (see `KEY_PATTERN`). */
export function macKeychain({ service, account }: KeychainItem, run: SecurityRunner = securityRunner()): Keychain {
  return {
    read: async () => {
      const answer = await run(['find-generic-password', '-w', '-s', service, '-a', account])
      const value = answer.stdout.trim()
      return answer.code === 0 && value !== '' ? value : undefined
    },
    write: async (value) => {
      // `-U` replaces an item with the same service and account.
      const answer = await run(['-i'], `add-generic-password -U -s ${service} -a ${account} -w ${value}\n`)
      if (answer.code !== 0) throw new Error('the keychain refused the write')
    },
    remove: async () => {
      const answer = await run(['delete-generic-password', '-s', service, '-a', account])
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

/**
 * What a key may look like: no spaces or quotes, so it is one token on the
 * `security -i` command line. An OpenRouter key is `sk-or-v1-` and hex.
 */
export const KEY_PATTERN = /^[\w.~+/=:-]{8,1024}$/
