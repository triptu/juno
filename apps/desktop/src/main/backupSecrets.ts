/**
 * The keychain for Juno Agent's encrypted backup (WP21, plan v3 §14.4):
 * the backup key, the deletion record and the recovery phrase, each a
 * generic password under the service `juno-backup`. The agent asks for
 * them by name (`SecretRequest`); they never reach a file, a log or the
 * renderer, except the phrase once after an export.
 *
 * Values are stored base64, so a phrase's spaces never reach the
 * `security -i` command line (`keychain.ts`).
 *
 * **The phrase.** When the agent stores a new phrase (Export recovery
 * phrase), main may hand it to the renderer once: `takePhrase` answers it
 * and forgets that it may. The sheet that shows it is the only place it
 * appears. On a new Mac, `typePhrase` stores the phrase the owner typed in
 * the restore sheet, so the agent can open the old Mac's backup.
 *
 * The keychain is the app's (`appKeychains`): the login keychain on the Mac,
 * encrypted files on Windows, memory under `JUNO_E2E`.
 */
import type { BackupSecretName, SecretRequest } from '@juno/agent-contract'
import type { Keychain, KeychainItem } from './keychain'

export const BACKUP_SERVICE = 'juno-backup'
const NAMES: ReadonlyArray<BackupSecretName> = ['backupKey', 'deletionRecord', 'recoveryPhrase']

/** A phrase as an owner may type it: Crockford base32 in groups, with spaces or dashes. */
const PHRASE = /^[0-9a-z\s-]{16,80}$/i

export interface BackupSecrets {
  /** Answers the agent: the stored value for `get` (null when there is none), nothing for `set`. */
  readonly answer: (request: SecretRequest) => Promise<string | null | undefined>
  /** The phrase from the last export, once. Undefined after that, or when there was no export. */
  readonly takePhrase: () => Promise<string | undefined>
  /** Stores a phrase the owner typed, for a restore. `invalid` when it cannot be a phrase. */
  readonly typePhrase: (phrase: string) => Promise<'saved' | 'invalid' | 'failed'>
}

export function backupSecrets(item: (name: BackupSecretName) => Keychain): BackupSecrets {
  const read = async (name: BackupSecretName) => {
    const raw = await item(name).read()
    return raw === undefined ? undefined : Buffer.from(raw, 'base64').toString('utf8')
  }
  const write = (name: BackupSecretName, value: string) => item(name).write(Buffer.from(value, 'utf8').toString('base64'))
  // Set by an export, cleared by the one read that shows it.
  let revealable = false
  return {
    answer: async (request) => {
      if (!NAMES.includes(request.name)) throw new Error('refused')
      if (request._tag === 'get') return (await read(request.name)) ?? null
      await write(request.name, request.value)
      if (request.name === 'recoveryPhrase') revealable = true
      return undefined
    },
    takePhrase: async () => {
      if (!revealable) return undefined
      revealable = false
      return read('recoveryPhrase')
    },
    typePhrase: async (phrase) => {
      const text = phrase.trim()
      if (!PHRASE.test(text)) return 'invalid'
      try {
        await write('recoveryPhrase', text)
        return 'saved'
      } catch {
        return 'failed'
      }
    },
  }
}

/** The app's backup secrets, in the app's keychain (`appKeychains`). */
export function appBackupSecrets(keychain: (item: KeychainItem) => Keychain): BackupSecrets {
  return backupSecrets((name) => keychain({ service: BACKUP_SERVICE, account: name }))
}
