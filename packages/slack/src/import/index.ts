/**
 * Reading a session out of a copy of the installed Slack app's data
 * (architecture 14, research slack-data-access section 1). The caller owns
 * the copy, the keychain prompt and what happens to the result; this module
 * only parses files. Nothing here logs a value.
 *
 * Layout of the Slack app's user data (`locate.ts` has where it lives):
 * `Local Storage/leveldb/` holds `localConfig_v2` with the teams and their
 * `xoxc` tokens; `Network/Cookies` (or `Cookies` on older builds) holds the
 * `d` cookie.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { cookieForHost, cookieVersions, macCookieKey, readCookies, type CookieKey, type SlackCookie } from './cookies.ts'
import { scanLevelDb } from './leveldb.ts'
import { localConfigFromRecords, pickTeam, teamCount, type LocalConfigTeam } from './localConfig.ts'
import { COOKIES_FILES, LOCAL_STORAGE_DIR } from './locate.ts'

export { macCookieKey, windowsCookieKey, type CookieKey, type SlackCookie } from './cookies.ts'
export { LOCAL_STATE_FILE, readProtectedCookieKey } from './localState.ts'

export { LocalConfigTeam } from './localConfig.ts'
export { snappyUncompress } from './snappy.ts'

export {
  copySlackAppData,
  KEYCHAIN_SERVICE,
  locateSlackAppData,
  slackAppCandidates,
  windowsSlackAppCandidates,
  type CookiesFile,
  type SlackAppCandidate,
  type SlackAppCheck,
  type SlackAppVariant,
} from './locate.ts'

export const SESSION_COOKIE = 'd'

export interface SlackAppSession {
  readonly team: LocalConfigTeam
  readonly cookie: SlackCookie
}

/**
 * `no-local-config`, `no-team`, `no-token` (teams, but none with a session
 * token) and `signed-out` (no `d` cookie stored) mean the app is not signed
 * in. `no-keychain` means no password was given; `no-cookie` means a `d`
 * cookie is stored but no password given decrypted one for the team.
 * `app-bound` means every stored `d` cookie uses Chromium's `v20` app-bound
 * encryption, which only Chrome's elevation service undoes.
 */
export type SlackAppImportFailure = 'no-local-config' | 'no-team' | 'no-token' | 'signed-out' | 'no-keychain' | 'no-cookie' | 'app-bound'

/**
 * The keychain password: a string, or a function asked for attempt 0, then
 * for attempt 1, 2 and so on while the previous answer did not decrypt the
 * cookie. It answers undefined when it has nothing more to try.
 */
export type KeychainPasswords = string | ((attempt: number) => Promise<string | undefined>)

/** The Mac gives keychain passwords; Windows gives the one key from `Local State`. */
export type CookieKeySource =
  | { readonly keychainPassword: KeychainPasswords }
  /** Windows: the key, or a function that reads it once the team and a stored `d` cookie are found. */
  | { readonly cookieKey: CookieKey | (() => Promise<CookieKey | undefined>) }

export class SlackAppImportError extends Error {
  readonly reason: SlackAppImportFailure
  constructor(reason: SlackAppImportFailure) {
    super(`slack app import: ${reason}`)
    this.name = 'SlackAppImportError'
    this.reason = reason
  }
}

/**
 * Reads the newest `localConfig_v2`, picks a team, and finds that team's `d`
 * cookie. `dir` is a copy of the Slack app's user data directory (or any
 * directory with Local Storage and a cookie store at the same paths). A
 * function for `keychainPassword` is called only once the team and a stored
 * `d` cookie are found, so a signed-out app never causes a keychain prompt.
 */
export async function readSlackAppSession(
  options: { readonly dir: string; readonly teamId?: string } & CookieKeySource,
): Promise<SlackAppSession> {
  const records = await scanLevelDb(join(options.dir, LOCAL_STORAGE_DIR))
  const json = localConfigFromRecords(records)
  if (json === undefined) throw new SlackAppImportError('no-local-config')
  const team = pickTeam(json, options.teamId)
  if (team === undefined) throw new SlackAppImportError(teamCount(json) === 0 ? 'no-team' : 'no-token')
  const cookiesFile = COOKIES_FILES.map((file) => join(options.dir, file)).find((file) => existsSync(file))
  const versions = cookiesFile === undefined ? [] : cookieVersions(cookiesFile, SESSION_COOKIE)
  if (cookiesFile === undefined || versions.length === 0) throw new SlackAppImportError('signed-out')
  if (versions.every((version) => version === 'v20')) throw new SlackAppImportError('app-bound')
  const ask = keysFrom(options)
  const hostname = new URL(team.url).hostname
  for (let attempt = 0; ; attempt++) {
    const key = await ask(attempt)
    if (key === undefined) throw new SlackAppImportError(attempt === 0 ? 'no-keychain' : 'no-cookie')
    const cookie = cookieForHost(readCookies(cookiesFile, SESSION_COOKIE, key), hostname)
    if (cookie !== undefined) return { team, cookie }
  }
}

/** The keys to try, by attempt. Each Mac password is asked for only when the one before it failed. */
function keysFrom(source: CookieKeySource): (attempt: number) => Promise<CookieKey | undefined> {
  if ('cookieKey' in source) {
    const key = source.cookieKey
    return async (attempt) => (attempt > 0 ? undefined : typeof key === 'function' ? key() : key)
  }
  const passwords = source.keychainPassword
  if (typeof passwords === 'string') return async (attempt) => (attempt === 0 ? macCookieKey(passwords) : undefined)
  return async (attempt) => {
    const password = await passwords(attempt)
    return password === undefined ? undefined : macCookieKey(password)
  }
}
