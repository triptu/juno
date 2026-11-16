/**
 * `secrets.bin` (architecture 2.3, 14): the session secrets, encrypted with
 * `safeStorage` in userData. Only the token and the team record live here;
 * the `d` cookie stays in the `persist:slack` Chromium session.
 *
 * The cipher comes from the caller (`index.ts`): `safeStorage` in the app,
 * plain JSON under `JUNO_E2E` so the keychain never prompts during tests.
 * The file name is the same, so a test can read it to check that a session
 * was stored or cleared.
 */
import { open, readFile, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Schema } from 'effect'
import { SessionSecrets } from '@juno/contract'

export const SECRETS_FILE = 'secrets.bin'

const decode = Schema.decodeUnknownSync(SessionSecrets)
const encode = Schema.encodeSync(SessionSecrets)

/** How the session is written to disk: `safeStorage`'s string cipher, or none. */
export interface SecretsCipher {
  readonly encrypt: (json: string) => Buffer
  readonly decrypt: (bytes: Buffer) => string
}

export const plainCipher: SecretsCipher = { encrypt: (json) => Buffer.from(json, 'utf8'), decrypt: (bytes) => bytes.toString('utf8') }

export class SecretsStore {
  readonly #file: string
  readonly #cipher: SecretsCipher

  constructor(userData: string, cipher: SecretsCipher) {
    this.#file = join(userData, SECRETS_FILE)
    this.#cipher = cipher
  }

  /** The stored session, or null when there is none or the file cannot be read. Never throws. */
  async read(): Promise<SessionSecrets | null> {
    let bytes: Buffer
    try {
      bytes = await readFile(this.#file)
    } catch {
      return null
    }
    // Emptied by a sign-out whose unlink the folder refused (`delete`): no session.
    if (bytes.length === 0) return null
    try {
      const json = this.#cipher.decrypt(bytes)
      return decode(JSON.parse(json))
    } catch (cause) {
      // A file from another machine or an older format. The user signs in again.
      console.warn('main: secrets.bin could not be read; ignoring it', cause instanceof Error ? cause.name : '')
      return null
    }
  }

  async write(secrets: SessionSecrets): Promise<void> {
    const json = JSON.stringify(encode(secrets))
    const bytes = this.#cipher.encrypt(json)
    const temporary = `${this.#file}.${process.pid}.tmp`
    try {
      const file = await open(temporary, 'w', 0o600)
      try {
        await file.writeFile(bytes)
        await file.sync()
      } finally {
        await file.close()
      }
      await rename(temporary, this.#file)
      // The rename is durable once its folder is synced. Windows cannot open a folder as a file (EISDIR), and
      // NTFS logs the rename itself, so there it is done; throwing here failed every sign-in on Windows.
      if (process.platform === 'win32') return
      const directory = await open(dirname(this.#file), 'r')
      try {
        await directory.sync()
      } finally {
        await directory.close()
      }
    } catch (cause) {
      await rm(temporary, { force: true })
      throw cause
    }
  }

  /**
   * Removes the stored session. When the folder refuses the unlink (a
   * userData folder that is not writable) but the file still is, the file is
   * emptied in place instead, so the next launch finds no session either way.
   * A file that cannot be opened for writing either throws, and the caller
   * logs it.
   */
  async delete(): Promise<void> {
    try {
      await rm(this.#file, { force: true })
    } catch (cause) {
      const file = await open(this.#file, 'w').catch(() => undefined)
      if (file === undefined) throw cause
      await file.close()
    }
  }
}
