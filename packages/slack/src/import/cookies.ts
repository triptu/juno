/**
 * The Slack app's cookie store (research section 1): a Chromium `Cookies`
 * SQLite file whose values are in `encrypted_value`, encrypted the standard
 * Chromium way on macOS: `v10` + AES-128-CBC with a key derived from the
 * "Slack Safe Storage" keychain password (PBKDF2-SHA1, salt `saltysalt`,
 * 1003 rounds, 16 bytes) and an IV of 16 spaces. Newer Chromium prefixes the
 * plaintext with the SHA-256 of `host_key`; the prefix is detected and
 * stripped.
 *
 * Only the `d` cookie is read. The caller passes a copy of the file; this
 * module never touches the live store.
 */
import { createDecipheriv, createHash, pbkdf2Sync } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

export interface SlackCookie {
  readonly name: string
  readonly value: string
  /** `host_key` as stored, for example `.slack.com` or `127.0.0.1`. */
  readonly host: string
  readonly path: string
  /** Epoch seconds, or undefined for a session cookie. */
  readonly expires?: number
  readonly secure: boolean
  readonly httpOnly: boolean
}

const SALT = 'saltysalt'
const ROUNDS = 1003
const KEY_BYTES = 16
const IV = Buffer.alloc(16, ' ')
const VERSION = 'v10'
/** Chromium's time origin is 1601-01-01; values are microseconds. */
const WINDOWS_EPOCH_OFFSET_SECONDS = 11_644_473_600

export function deriveCookieKey(password: string): Buffer {
  return pbkdf2Sync(password, SALT, ROUNDS, KEY_BYTES, 'sha1')
}

export function decryptCookieValue(encrypted: Uint8Array, hostKey: string, key: Buffer): string {
  const buffer = Buffer.from(encrypted)
  if (buffer.subarray(0, 3).toString('latin1') !== VERSION) throw new Error('cookie: unsupported encryption version')
  const decipher = createDecipheriv('aes-128-cbc', key, IV)
  const plain = Buffer.concat([decipher.update(buffer.subarray(3)), decipher.final()])
  const hostHash = createHash('sha256').update(hostKey).digest()
  const body = plain.length >= 32 && plain.subarray(0, 32).equals(hostHash) ? plain.subarray(32) : plain
  return body.toString('utf8')
}

interface CookieRow {
  host_key: string
  name: string
  encrypted_value: Uint8Array | null
  value: string | null
  path: string
  expires_utc: number | bigint
  is_secure: number | bigint
  is_httponly: number | bigint
}

/** How many cookies named `name` the file holds. Needs no password: names are stored in the clear. */
export function cookieRowCount(file: string, name: string): number {
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    const row = db.prepare('SELECT COUNT(*) AS count FROM cookies WHERE name = ?').get(name) as { count: number } | undefined
    return Number(row?.count ?? 0)
  } finally {
    db.close()
  }
}

/**
 * Every cookie named `name` in the file, decrypted. Rows that fail to
 * decrypt are skipped: a wrong password yields no cookies, not garbage.
 */
export function readCookies(file: string, name: string, password: string): ReadonlyArray<SlackCookie> {
  const key = deriveCookieKey(password)
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    const statement = db.prepare(
      'SELECT host_key, name, encrypted_value, value, path, expires_utc, is_secure, is_httponly FROM cookies WHERE name = ?',
    )
    // Chromium times are microseconds since 1601 and do not fit a safe integer.
    statement.setReadBigInts(true)
    const rows = statement.all(name) as unknown as Array<CookieRow>
    const cookies: Array<SlackCookie> = []
    for (const row of rows) {
      let value: string
      try {
        value =
          row.encrypted_value !== null && row.encrypted_value.length > 0
            ? decryptCookieValue(row.encrypted_value, row.host_key, key)
            : (row.value ?? '')
      } catch {
        continue
      }
      if (value === '') continue
      const expiresMicros = Number(row.expires_utc)
      cookies.push({
        name: row.name,
        value,
        host: row.host_key,
        path: row.path,
        ...(expiresMicros > 0 ? { expires: Math.floor(expiresMicros / 1_000_000 - WINDOWS_EPOCH_OFFSET_SECONDS) } : {}),
        secure: Number(row.is_secure) === 1,
        httpOnly: Number(row.is_httponly) === 1,
      })
    }
    return cookies
  } finally {
    db.close()
  }
}

/** The cookie whose host matches `hostname` (exactly or as a parent domain), preferring the most specific host. */
export function cookieForHost(cookies: ReadonlyArray<SlackCookie>, hostname: string): SlackCookie | undefined {
  let best: SlackCookie | undefined
  for (const cookie of cookies) {
    const host = cookie.host.startsWith('.') ? cookie.host.slice(1) : cookie.host
    if (hostname !== host && !hostname.endsWith(`.${host}`)) continue
    if (best === undefined || host.length > best.host.replace(/^\./, '').length) best = cookie
  }
  return best
}
