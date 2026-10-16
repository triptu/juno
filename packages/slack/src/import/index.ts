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
import { cookieForHost, cookieRowCount, readCookies, type SlackCookie } from './cookies.ts'
import { scanLevelDb } from './leveldb.ts'
import { localConfigFromRecords, pickTeam, type LocalConfigTeam } from './localConfig.ts'
import { COOKIES_FILES, LOCAL_STORAGE_DIR } from './locate.ts'

export { type SlackCookie } from './cookies.ts'

export { LocalConfigTeam, pickTeam } from './localConfig.ts'
export { snappyUncompress } from './snappy.ts'

export { copySlackAppData, KEYCHAIN_SERVICE, locateSlackAppData, slackAppCandidates, type SlackAppCandidate } from './locate.ts'

export const SESSION_COOKIE = 'd'

export interface SlackAppSession {
  readonly team: LocalConfigTeam
  readonly cookie: SlackCookie
}

/**
 * `no-local-config`, `no-team` and `signed-out` (no `d` cookie stored) mean
 * the app is not signed in. `no-keychain` means the password was not given;
 * `no-cookie` means a `d` cookie is stored but none decrypted for the team.
 */
export type SlackAppImportFailure = 'no-local-config' | 'no-team' | 'signed-out' | 'no-keychain' | 'no-cookie'

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
export async function readSlackAppSession(options: {
  readonly dir: string
  readonly keychainPassword: string | (() => Promise<string | undefined>)
  readonly teamId?: string
}): Promise<SlackAppSession> {
  const records = await scanLevelDb(join(options.dir, LOCAL_STORAGE_DIR))
  const json = localConfigFromRecords(records)
  if (json === undefined) throw new SlackAppImportError('no-local-config')
  const team = pickTeam(json, options.teamId)
  if (team === undefined) throw new SlackAppImportError('no-team')
  const cookiesFile = COOKIES_FILES.map((file) => join(options.dir, file)).find((file) => existsSync(file))
  if (cookiesFile === undefined || cookieRowCount(cookiesFile, SESSION_COOKIE) === 0) throw new SlackAppImportError('signed-out')
  const password = typeof options.keychainPassword === 'string' ? options.keychainPassword : await options.keychainPassword()
  if (password === undefined) throw new SlackAppImportError('no-keychain')
  const cookie = cookieForHost(readCookies(cookiesFile, SESSION_COOKIE, password), new URL(team.url).hostname)
  if (cookie === undefined) throw new SlackAppImportError('no-cookie')
  return { team, cookie }
}
