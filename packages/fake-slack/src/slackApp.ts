/**
 * A fake of the installed Slack app's data directory, for testing the import
 * path (architecture 13, "Import seam") without the real app or keychain.
 *
 * `writeSlackAppFixture(dir, ...)` writes what the importer reads:
 *
 * - `Local Storage/leveldb/`: a leveldb with `localConfig_v2` for the origin
 *   `https://app.slack.com`. An older value goes into a table file
 *   (`000005.ldb`) and the newest into the log (`000007.log`), so a reader
 *   has to handle both formats and pick by sequence number.
 * - `Cookies` (or `Network/Cookies`, as newer Chromium writes it): a Chromium
 *   cookie store with the `d` cookie encrypted the way Chromium encrypts it on
 *   macOS under the given "keychain" password.
 *
 * The leveldb writer here is for fixtures only: one data block, no
 * compression, no filter block, no manifest. The reader in `@juno/slack`
 * does not open the database through leveldb, so no manifest is needed.
 */
import { createCipheriv, createHash, pbkdf2Sync } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export interface SlackAppFixtureTeam {
  readonly id: string
  readonly name: string
  readonly domain: string
  /** `http://127.0.0.1:1234/` for the fake, `https://<workspace>.slack.com/` for the real thing. */
  readonly url: string
  readonly token: string
  readonly userId: string
  readonly enterpriseId?: string
}

export interface SlackAppFixtureOptions {
  readonly team: SlackAppFixtureTeam
  /** The `d` cookie value. */
  readonly cookie: string
  /** Stands in for the "Slack Safe Storage" keychain password. */
  readonly keychainPassword: string
  /** A stale team record written before `team`, to prove the newest wins. Default: a copy of `team` with an old token. */
  readonly staleTeam?: SlackAppFixtureTeam
  /** Where the cookie store goes. Default: `Cookies`. */
  readonly cookiesFile?: 'Cookies' | 'Network/Cookies'
  /** Leave out the `d` cookie, as a Slack app that was signed out does. */
  readonly signedOut?: boolean
  /** Write the newest `localConfig_v2` with no teams. */
  readonly emptyTeams?: boolean
}

const ORIGIN = 'https://app.slack.com'
const LOCAL_CONFIG_KEY = 'localConfig_v2'

export async function writeSlackAppFixture(dir: string, options: SlackAppFixtureOptions): Promise<void> {
  const leveldb = join(dir, 'Local Storage', 'leveldb')
  await mkdir(leveldb, { recursive: true })
  const stale = options.staleTeam ?? { ...options.team, token: 'xoxc-stale-00000000' }
  const key = storageKey(ORIGIN, LOCAL_CONFIG_KEY)
  // Sequence numbers: the table holds the older write, the log the newer.
  await writeFile(join(leveldb, '000005.ldb'), tableFile([{ key, value: storageValue(localConfigJson(stale)), sequence: 10n }]))
  const newest = options.emptyTeams === true ? JSON.stringify({ teams: {}, orderedTeamIds: [] }) : localConfigJson(options.team)
  await writeFile(join(leveldb, '000007.log'), logFile(20n, [{ key, value: storageValue(newest) }]))
  await writeFile(join(leveldb, 'CURRENT'), 'MANIFEST-000001\n')
  const cookies = join(dir, ...(options.cookiesFile ?? 'Cookies').split('/'))
  await mkdir(dirname(cookies), { recursive: true })
  writeCookies(cookies, options)
}

export function localConfigJson(team: SlackAppFixtureTeam): string {
  return JSON.stringify({
    teams: {
      [team.id]: {
        id: team.id,
        name: team.name,
        domain: team.domain,
        url: team.url,
        token: team.token,
        user_id: team.userId,
        user_locale: 'en-US',
        variant: 'commercial',
        ...(team.enterpriseId === undefined ? {} : { enterprise_id: team.enterpriseId, enterprise_name: 'Juno Fake Org' }),
      },
    },
    lastActiveTeamId: team.id,
    orderedTeamIds: [team.id],
    lastFetched: Date.now(),
  })
}

// Chromium Local Storage encoding: `_<origin>\0` then a format byte (1 = Latin-1) and the key; values start with the same format byte.

function storageKey(origin: string, key: string): Buffer {
  return Buffer.concat([Buffer.from(`_${origin}\0`, 'latin1'), Buffer.from([1]), Buffer.from(key, 'latin1')])
}

function storageValue(value: string): Buffer {
  // Latin-1 only works for ASCII JSON, which localConfig_v2 is; use UTF-16LE otherwise, like Chromium does.
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\xff]*$/.test(value)) return Buffer.concat([Buffer.from([1]), Buffer.from(value, 'latin1')])
  return Buffer.concat([Buffer.from([0]), Buffer.from(value, 'utf16le')])
}

// leveldb log file: one FULL record holding one write batch.

interface Entry {
  readonly key: Buffer
  readonly value: Buffer
}

function logFile(sequence: bigint, entries: ReadonlyArray<Entry>): Buffer {
  const header = Buffer.alloc(12)
  header.writeBigUInt64LE(sequence, 0)
  header.writeUInt32LE(entries.length, 8)
  const body = Buffer.concat([
    header,
    ...entries.map((entry) => Buffer.concat([Buffer.from([1]), varint(entry.key.length), entry.key, varint(entry.value.length), entry.value])),
  ])
  const record = Buffer.alloc(7 + body.length)
  record.writeUInt32LE(mask(crc32c(Buffer.concat([Buffer.from([1]), body]))), 0)
  record.writeUInt16LE(body.length, 4)
  record[6] = 1 // FULL
  body.copy(record, 7)
  return record
}

// leveldb table file: data block, metaindex block, index block, footer.

function tableFile(entries: ReadonlyArray<Entry & { readonly sequence: bigint }>): Buffer {
  const dataBlock = block(
    entries.map((entry) => {
      const trailer = Buffer.alloc(8)
      trailer.writeBigUInt64LE((entry.sequence << 8n) | 1n, 0) // kind 1 = value
      return { key: Buffer.concat([entry.key, trailer]), value: entry.value }
    }),
  )
  const lastKey = entries.length === 0 ? Buffer.alloc(0) : Buffer.concat([entries[entries.length - 1]!.key, Buffer.alloc(8, 0xff)])
  const dataHandle = handle(0, dataBlock.length - 5)
  const metaindexBlock = block([])
  const metaindexOffset = dataBlock.length
  const indexBlock = block([{ key: lastKey, value: dataHandle }])
  const indexOffset = metaindexOffset + metaindexBlock.length
  const footer = Buffer.alloc(48)
  const handles = Buffer.concat([handle(metaindexOffset, metaindexBlock.length - 5), handle(indexOffset, indexBlock.length - 5)])
  handles.copy(footer, 0)
  footer.writeBigUInt64LE(0xdb4775248b80fb57n, 40)
  return Buffer.concat([dataBlock, metaindexBlock, indexBlock, footer])
}

/** A block with one restart point and no prefix compression, plus its trailer (type 0, crc). */
function block(entries: ReadonlyArray<Entry>): Buffer {
  const body = Buffer.concat([
    ...entries.map((entry) => Buffer.concat([varint(0), varint(entry.key.length), varint(entry.value.length), entry.key, entry.value])),
    uint32(0),
    uint32(1),
  ])
  const trailer = Buffer.alloc(5)
  trailer[0] = 0
  trailer.writeUInt32LE(mask(crc32c(Buffer.concat([body, Buffer.from([0])]))), 1)
  return Buffer.concat([body, trailer])
}

function handle(offset: number, size: number): Buffer {
  return Buffer.concat([varint(offset), varint(size)])
}

function varint(value: number): Buffer {
  const bytes: Array<number> = []
  let rest = value
  while (rest >= 0x80) {
    bytes.push((rest & 0x7f) | 0x80)
    rest >>>= 7
  }
  bytes.push(rest)
  return Buffer.from(bytes)
}

function uint32(value: number): Buffer {
  const out = Buffer.alloc(4)
  out.writeUInt32LE(value, 0)
  return out
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0x82f63b78 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32c(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** leveldb's masked crc: rotated and offset so a crc of crc'd data is not itself a valid crc. */
function mask(crc: number): number {
  return (((crc >>> 15) | (crc << 17)) + 0xa282ead8) >>> 0
}

// Chromium cookie store.

const WINDOWS_EPOCH_OFFSET_SECONDS = 11_644_473_600

function writeCookies(file: string, options: SlackAppFixtureOptions): void {
  const url = new URL(options.team.url)
  const hostKey = url.hostname.endsWith('.slack.com') || url.hostname === 'slack.com' ? '.slack.com' : url.hostname
  const key = pbkdf2Sync(options.keychainPassword, 'saltysalt', 1003, 16, 'sha1')
  const encrypt = (value: string) => {
    const cipher = createCipheriv('aes-128-cbc', key, Buffer.alloc(16, ' '))
    const hostHash = createHash('sha256').update(hostKey).digest()
    return Buffer.concat([Buffer.from('v10', 'latin1'), cipher.update(Buffer.concat([hostHash, Buffer.from(value, 'utf8')])), cipher.final()])
  }
  const expires = BigInt(Math.floor(Date.now() / 1000) + 365 * 86_400 + WINDOWS_EPOCH_OFFSET_SECONDS) * 1_000_000n
  const db = new DatabaseSync(file)
  try {
    db.exec(`CREATE TABLE cookies (
      creation_utc INTEGER NOT NULL, host_key TEXT NOT NULL, top_frame_site_key TEXT NOT NULL, name TEXT NOT NULL,
      value TEXT NOT NULL, encrypted_value BLOB NOT NULL, path TEXT NOT NULL, expires_utc INTEGER NOT NULL,
      is_secure INTEGER NOT NULL, is_httponly INTEGER NOT NULL, last_access_utc INTEGER NOT NULL, has_expires INTEGER NOT NULL,
      is_persistent INTEGER NOT NULL, priority INTEGER NOT NULL, samesite INTEGER NOT NULL, source_scheme INTEGER NOT NULL,
      source_port INTEGER NOT NULL, last_update_utc INTEGER NOT NULL, source_type INTEGER NOT NULL, has_cross_site_ancestor INTEGER NOT NULL,
      UNIQUE (host_key, top_frame_site_key, has_cross_site_ancestor, name, path, source_scheme, source_port))`)
    const insert = db.prepare(`INSERT INTO cookies VALUES (?, ?, '', ?, '', ?, '/', ?, ?, ?, 0, 1, 1, 1, 0, ?, ?, 0, 0, 0)`)
    const secure = url.protocol === 'https:' ? 1 : 0
    const row = (name: string, value: string, httpOnly: number) =>
      insert.run(0, hostKey, name, encrypt(value), expires, secure, httpOnly, secure ? 2 : 1, url.port === '' ? (secure ? 443 : 80) : Number(url.port))
    if (options.signedOut !== true) row('d', options.cookie, 1)
    row('b', 'fixture-b', 0)
    row('lc', '0', 0)
  } finally {
    db.close()
  }
}
