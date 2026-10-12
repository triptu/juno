/**
 * `secrets.bin` (architecture 2.3, 14): the session secrets, encrypted with
 * `safeStorage` in userData. Only the token and the team record live here;
 * the `d` cookie stays in the `persist:slack` Chromium session.
 *
 * Under `JUNO_E2E` the file holds plain JSON so the keychain never prompts
 * during tests. The file name is the same, so a test can read it to check
 * that a session was stored or cleared.
 */
import { safeStorage } from 'electron'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Schema } from 'effect'
import { SessionSecrets } from '@juno/contract'

export const SECRETS_FILE = 'secrets.bin'

const decode = Schema.decodeUnknownSync(SessionSecrets)
const encode = Schema.encodeSync(SessionSecrets)

export class SecretsStore {
  readonly #file: string
  readonly #plaintext: boolean

  constructor(userData: string, options: { readonly plaintext: boolean }) {
    this.#file = join(userData, SECRETS_FILE)
    this.#plaintext = options.plaintext
  }

  /** The stored session, or null when there is none or the file cannot be read. Never throws. */
  async read(): Promise<SessionSecrets | null> {
    let bytes: Buffer
    try {
      bytes = await readFile(this.#file)
    } catch {
      return null
    }
    try {
      const json = this.#plaintext ? bytes.toString('utf8') : safeStorage.decryptString(bytes)
      return decode(JSON.parse(json))
    } catch (cause) {
      // A file from another machine or an older format. The user signs in again.
      console.warn('main: secrets.bin could not be read; ignoring it', cause instanceof Error ? cause.name : '')
      return null
    }
  }

  async write(secrets: SessionSecrets): Promise<void> {
    const json = JSON.stringify(encode(secrets))
    const bytes = this.#plaintext ? Buffer.from(json, 'utf8') : safeStorage.encryptString(json)
    await writeFile(this.#file, bytes, { mode: 0o600 })
  }

  async delete(): Promise<void> {
    await rm(this.#file, { force: true })
  }
}
