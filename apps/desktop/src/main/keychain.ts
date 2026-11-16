/**
 * The keychain for Juno Agent's provider keys (SPEC 13.10, plan v3 §2.2,
 * §7.2): the OpenRouter key and a custom endpoint's key, each a generic
 * password in the login keychain on the Mac. `providers.ts` decides what is
 * stored; keys are never written to prefs or a plain file, and never logged: errors
 * from the keychain are reported as `failed` with no detail.
 *
 * The keychain is reached through `/usr/bin/security`, as the dev session
 * cache does (`scripts/live-common.ts`). The value goes in on stdin of
 * `security -i`, never in argv, so no process listing shows it. `security`
 * created the item, so it reads it back without a prompt.
 *
 * On Windows there is no login keychain to reach without a prompt or native
 * code, so each item is a file under `<userData>/keychain`, its value
 * encrypted with `safeStorage` (DPAPI, bound to the Windows user), as the
 * Slack session in `secrets.bin` is. A file is written to a temp name and
 * renamed over the old one, so a read sees the old value or the new one.
 *
 * `appKeychains` picks one of these for every caller: the OpenRouter and
 * custom provider keys, MCP sign-in state and the backup's secrets. Under
 * `JUNO_E2E` it keeps items in memory, so tests never touch the real ones.
 */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface Keychain {
  /** The stored value, or undefined when there is none. */
  readonly read: () => Promise<string | undefined>
  readonly write: (value: string) => Promise<void>
  /** Resolves true when there was an item to remove. */
  readonly remove: () => Promise<boolean>
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
      return answer.code === 0
    },
  }
}

/** Encrypts and decrypts one item's value: `safeStorage` in the app. */
export interface ItemCipher {
  readonly encrypt: (value: string) => Buffer
  readonly decrypt: (bytes: Buffer) => string
}

/**
 * One item as an encrypted file, `<dir>/<service>/<account>`. Item names are
 * Juno's own (`juno-mcp`, `server-<uuid>.0`), so they are safe file names. A
 * file that no longer decrypts (a copied profile, another Windows user) reads
 * as no value, as a refused keychain read does on the Mac.
 */
export function fileKeychain(dir: string, { service, account }: KeychainItem, cipher: ItemCipher): Keychain {
  const folder = join(dir, service)
  const file = join(folder, account)
  return {
    read: async () => {
      let bytes: Buffer
      try {
        bytes = await readFile(file)
      } catch {
        return undefined
      }
      try {
        const value = cipher.decrypt(bytes)
        return value === '' ? undefined : value
      } catch {
        return undefined
      }
    },
    write: async (value) => {
      await mkdir(folder, { recursive: true })
      const temp = `${file}.${randomUUID()}.tmp`
      try {
        await writeFile(temp, cipher.encrypt(value), { flush: true })
        await rename(temp, file)
      } catch (cause) {
        await rm(temp, { force: true })
        throw new Error('the keychain refused the write', { cause })
      }
    },
    remove: async () => {
      try {
        await unlink(file)
        return true
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return false
        throw new Error('the keychain refused the delete', { cause })
      }
    },
  }
}

export interface AppKeychainOptions {
  readonly e2e: boolean
  readonly platform: NodeJS.Platform
  /** The app's user data folder. Windows items live in `keychain` inside it. */
  readonly userData: string
  /** `safeStorage`, for Windows. */
  readonly cipher: ItemCipher
}

/**
 * The keychain for this run: memory under tests, encrypted files on Windows,
 * the login keychain on the Mac. Two keychains for one item share its value.
 */
export function appKeychains({ e2e, platform, userData, cipher }: AppKeychainOptions): (item: KeychainItem) => Keychain {
  if (!e2e && platform === 'win32') return (item) => fileKeychain(join(userData, 'keychain'), item, cipher)
  if (!e2e) return (item) => macKeychain(item)
  return memoryKeychains()
}

/** Items in memory, one per service and account. */
export function memoryKeychains(): (item: KeychainItem) => Keychain {
  const items = new Map<string, Keychain>()
  return (item) => {
    const name = `${item.service}/${item.account}`
    let found = items.get(name)
    if (!found) items.set(name, (found = memoryKeychain()))
    return found
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
      const had = value !== undefined
      value = undefined
      return had
    },
  }
}

/**
 * What a key may look like: no spaces or quotes, so it is one token on the
 * `security -i` command line. An OpenRouter key is `sk-or-v1-` and hex.
 */
export const KEY_PATTERN = /^[\w.~+/=:-]{8,1024}$/
