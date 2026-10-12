/**
 * Reading a session out of a copy of the installed Slack app's data
 * (architecture 14, research slack-data-access section 1). The caller owns
 * the copy, the keychain prompt and what happens to the result; this module
 * only parses files. Nothing here logs a value.
 *
 * Layout of the Slack app's user data (macOS: `~/Library/Application
 * Support/Slack`): `Local Storage/leveldb/` holds `localConfig_v2` with the
 * teams and their `xoxc` tokens; `Cookies` holds the `d` cookie.
 */
import { join } from 'node:path'
import { cookieForHost, readCookies, type SlackCookie } from './cookies.ts'
import { scanLevelDb } from './leveldb.ts'
import { localConfigFromRecords, pickTeam, type LocalConfigTeam } from './localConfig.ts'

export { cookieForHost, decryptCookieValue, deriveCookieKey, readCookies, type SlackCookie } from './cookies.ts'
export { newestValue, parseLog, parseTable, scanLevelDb, type LevelDbRecord } from './leveldb.ts'
export { localConfigFromRecords, LocalConfigTeam, pickTeam } from './localConfig.ts'
export { snappyUncompress } from './snappy.ts'

export const LOCAL_STORAGE_DIR = join('Local Storage', 'leveldb')
export const COOKIES_FILE = 'Cookies'
export const SESSION_COOKIE = 'd'

export interface SlackAppSession {
  readonly team: LocalConfigTeam
  readonly cookie: SlackCookie
}

export type SlackAppImportFailure = 'no-local-config' | 'no-team' | 'no-cookie'

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
 * directory with the same two entries).
 */
export async function readSlackAppSession(options: {
  readonly dir: string
  readonly keychainPassword: string
  readonly teamId?: string
}): Promise<SlackAppSession> {
  const records = await scanLevelDb(join(options.dir, LOCAL_STORAGE_DIR))
  const json = localConfigFromRecords(records)
  if (json === undefined) throw new SlackAppImportError('no-local-config')
  const team = pickTeam(json, options.teamId)
  if (team === undefined) throw new SlackAppImportError('no-team')
  const cookies = readCookies(join(options.dir, COOKIES_FILE), SESSION_COOKIE, options.keychainPassword)
  const cookie = cookieForHost(cookies, new URL(team.url).hostname)
  if (cookie === undefined) throw new SlackAppImportError('no-cookie')
  return { team, cookie }
}
