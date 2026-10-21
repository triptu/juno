/**
 * `localConfig_v2`: the web client's record of signed-in teams, kept in
 * Local Storage for the origin `https://app.slack.com` (research section 1).
 * The Slack-app import reads it from a copy of the Slack app's leveldb.
 */
import { Schema as S } from 'effect'
import { newestValue, type LevelDbRecord } from './leveldb.ts'

const opt = S.optionalKey

export const LocalConfigTeam = S.Struct({
  id: S.String,
  name: opt(S.String),
  domain: opt(S.String),
  /** `https://<workspace>.slack.com/`. */
  url: S.String,
  /** `xoxc-…`. Never log it. */
  token: S.String,
  user_id: S.String,
  enterprise_id: opt(S.String),
  enterprise_api_token: opt(S.String),
  enterprise_name: opt(S.String),
})
export type LocalConfigTeam = typeof LocalConfigTeam.Type

export const LocalConfig = S.Struct({
  teams: S.Record(S.String, S.Unknown),
  lastActiveTeamId: opt(S.String),
  orderedTeamIds: opt(S.Array(S.String)),
})

const decodeConfig = S.decodeUnknownSync(LocalConfig)
const decodeTeam = S.decodeUnknownSync(LocalConfigTeam)

/**
 * Picks one team out of the config JSON: `teamId` when given and present,
 * else the last active team, else the first ordered one. Teams whose record
 * has no usable token are skipped.
 */
/** How many team records `localConfig_v2` holds, with a token or not. */
export function teamCount(json: string): number {
  return Object.keys(decodeConfig(JSON.parse(json)).teams).length
}

export function pickTeam(json: string, teamId?: string): LocalConfigTeam | undefined {
  const config = decodeConfig(JSON.parse(json))
  const teams = new Map<string, LocalConfigTeam>()
  for (const [id, raw] of Object.entries(config.teams)) {
    try {
      const team = decodeTeam(raw)
      if (team.token.startsWith('xoxc-')) teams.set(id, team)
    } catch {
      // A team without a token (signed out in place) or an unknown shape.
    }
  }
  const order = [teamId, config.lastActiveTeamId, ...(config.orderedTeamIds ?? []), ...teams.keys()]
  for (const candidate of order) {
    if (candidate !== undefined && teams.has(candidate)) return teams.get(candidate)
  }
  return undefined
}

const KEY = 'localConfig_v2'
const ORIGIN = 'https://app.slack.com'

/**
 * Chromium stores a Local Storage entry under `_<origin>\0<format><key>`,
 * where `format` is 0 for UTF-16LE and 1 for Latin-1; values carry the same
 * format byte first. The Slack app writes the key for the app.slack.com
 * origin; a different origin (the fake in tests) is accepted when no record
 * for app.slack.com exists.
 */
export function localConfigFromRecords(records: ReadonlyArray<LevelDbRecord>): string | undefined {
  const forOrigin = newestValue(records, (key) => matchesKey(key, ORIGIN))
  const value = forOrigin ?? newestValue(records, (key) => matchesKey(key, undefined))
  return value === undefined ? undefined : decodeStorageValue(value)
}

function matchesKey(key: Uint8Array, origin: string | undefined): boolean {
  if (key[0] !== 0x5f) return false // '_'
  const separator = key.indexOf(0)
  if (separator < 0) return false
  if (origin !== undefined && latin1(key.subarray(1, separator)) !== origin) return false
  const name = decodeStorageValue(key.subarray(separator + 1))
  return name === KEY
}

function decodeStorageValue(bytes: Uint8Array): string {
  const format = bytes[0]
  const body = bytes.subarray(1)
  if (format === 0) return new TextDecoder('utf-16le').decode(body)
  return latin1(body)
}

function latin1(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) out += String.fromCharCode(byte)
  return out
}
