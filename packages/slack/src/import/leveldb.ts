/**
 * A read-only scan of a leveldb directory, enough to find the newest value of
 * one key in Chromium's Local Storage (research section 1: the Slack app
 * keeps `localConfig_v2` there).
 *
 * Why not a dependency: `level` and `classic-level` build or download a
 * native binding and open the database for writing, which would also take
 * leveldb's `LOCK` while the Slack app runs; the pure JavaScript readers on
 * npm are unmaintained. The two file formats are stable since 2011 and the
 * reader is under two hundred lines, so it lives here.
 *
 * Formats (leveldb `doc/log_format.md` and `doc/table_format.md`):
 *
 * - `*.log`: 32 KiB blocks of records `[crc32c u32][length u16][type u8][data]`.
 *   Types FULL, FIRST, MIDDLE, LAST reassemble a write batch:
 *   `[sequence u64][count u32]` then per entry `[kind u8][key varint+bytes]`
 *   and, for a put, `[value varint+bytes]`.
 * - `*.ldb`: blocks ending in `[type u8][crc32c u32]` (type 1 is snappy),
 *   a footer of 48 bytes with the metaindex and index block handles and the
 *   magic number. Block entries are prefix-compressed
 *   `[shared varint][unshared varint][value length varint][key delta][value]`
 *   with a restart array at the end. Data block keys are internal keys: the
 *   user key plus 8 bytes of `sequence << 8 | kind`.
 *
 * Checksums are not verified: the copy is ours and a corrupt record only
 * costs one candidate. Every put and delete found is returned with its
 * sequence number, so the caller takes the newest.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { snappyUncompress } from './snappy.ts'

export interface LevelDbRecord {
  readonly key: Uint8Array
  /** Absent for a deletion. */
  readonly value?: Uint8Array
  readonly sequence: bigint
}

const LOG_BLOCK_SIZE = 32 * 1024
const LOG_HEADER_SIZE = 7
const TABLE_FOOTER_SIZE = 48
const TABLE_MAGIC = 0xdb4775248b80fb57n
const KIND_DELETION = 0
const KIND_VALUE = 1

/** Every put and delete in the directory's log and table files. Order is not meaningful. */
export async function scanLevelDb(dir: string): Promise<ReadonlyArray<LevelDbRecord>> {
  const names = await readdir(dir)
  const records: Array<LevelDbRecord> = []
  for (const name of names) {
    const file = join(dir, name)
    if (name.endsWith('.log')) records.push(...parseLog(await readFile(file)))
    else if (name.endsWith('.ldb') || name.endsWith('.sst')) records.push(...parseTable(await readFile(file)))
  }
  return records
}

/** The newest record whose key satisfies `match`, or undefined if none or if the newest is a deletion. */
export function newestValue(records: ReadonlyArray<LevelDbRecord>, match: (key: Uint8Array) => boolean): Uint8Array | undefined {
  let best: LevelDbRecord | undefined
  for (const record of records) {
    if (!match(record.key)) continue
    if (best === undefined || record.sequence > best.sequence) best = record
  }
  return best?.value
}

// Log files

export function parseLog(data: Uint8Array): Array<LevelDbRecord> {
  const records: Array<LevelDbRecord> = []
  let fragments: Array<Uint8Array> = []
  let pos = 0
  while (pos + LOG_HEADER_SIZE <= data.length) {
    const blockLeft = LOG_BLOCK_SIZE - (pos % LOG_BLOCK_SIZE)
    if (blockLeft < LOG_HEADER_SIZE) {
      pos += blockLeft
      continue
    }
    const length = data[pos + 4]! | (data[pos + 5]! << 8)
    const type = data[pos + 6]!
    const start = pos + LOG_HEADER_SIZE
    const end = start + length
    if (end > data.length) break
    pos = end
    const payload = data.subarray(start, end)
    switch (type) {
      case 1: // FULL
        records.push(...safeParseBatch(payload))
        fragments = []
        break
      case 2: // FIRST
        fragments = [payload]
        break
      case 3: // MIDDLE
        fragments.push(payload)
        break
      case 4: // LAST
        fragments.push(payload)
        records.push(...safeParseBatch(concat(fragments)))
        fragments = []
        break
      default:
        // Type 0 is zero padding at the end of a preallocated file.
        if (length === 0 && type === 0) pos = data.length
        break
    }
  }
  return records
}

function safeParseBatch(batch: Uint8Array): Array<LevelDbRecord> {
  try {
    return parseBatch(batch)
  } catch {
    return []
  }
}

function parseBatch(batch: Uint8Array): Array<LevelDbRecord> {
  const view = new DataView(batch.buffer, batch.byteOffset, batch.byteLength)
  const sequence = view.getBigUint64(0, true)
  const count = view.getUint32(8, true)
  const reader = new Reader(batch, 12)
  const records: Array<LevelDbRecord> = []
  for (let i = 0; i < count; i++) {
    const kind = reader.u8()
    const key = reader.bytes(reader.varint())
    if (kind === KIND_VALUE) records.push({ key, value: reader.bytes(reader.varint()), sequence: sequence + BigInt(i) })
    else if (kind === KIND_DELETION) records.push({ key, sequence: sequence + BigInt(i) })
    else throw new Error('leveldb: unknown batch entry kind')
  }
  return records
}

// Table files

export function parseTable(data: Uint8Array): Array<LevelDbRecord> {
  if (data.length < TABLE_FOOTER_SIZE) return []
  const footer = data.subarray(data.length - TABLE_FOOTER_SIZE)
  const magic = new DataView(footer.buffer, footer.byteOffset, footer.byteLength).getBigUint64(TABLE_FOOTER_SIZE - 8, true)
  if (magic !== TABLE_MAGIC) return []
  const handles = new Reader(footer, 0)
  handles.varint64() // metaindex offset
  handles.varint64() // metaindex size
  const indexOffset = handles.varint64()
  const indexSize = handles.varint64()
  const records: Array<LevelDbRecord> = []
  try {
    const index = readBlock(data, indexOffset, indexSize)
    for (const entry of blockEntries(index)) {
      const handle = new Reader(entry.value, 0)
      const offset = handle.varint64()
      const size = handle.varint64()
      const block = readBlock(data, offset, size)
      for (const { key, value } of blockEntries(block)) {
        if (key.length < 8) continue
        const trailer = new DataView(key.buffer, key.byteOffset + key.length - 8, 8).getBigUint64(0, true)
        const kind = Number(trailer & 0xffn)
        const userKey = key.subarray(0, key.length - 8)
        const sequence = trailer >> 8n
        if (kind === KIND_VALUE) records.push({ key: userKey, value, sequence })
        else if (kind === KIND_DELETION) records.push({ key: userKey, sequence })
      }
    }
  } catch {
    // A damaged table yields what was read before the damage.
  }
  return records
}

function readBlock(data: Uint8Array, offset: number, size: number): Uint8Array {
  const raw = data.subarray(offset, offset + size)
  const type = data[offset + size]
  if (type === 0) return raw
  if (type === 1) return snappyUncompress(raw)
  throw new Error(`leveldb: unsupported block compression ${type}`)
}

function* blockEntries(block: Uint8Array): Generator<{ key: Uint8Array; value: Uint8Array }> {
  if (block.length < 4) return
  const view = new DataView(block.buffer, block.byteOffset, block.byteLength)
  const restarts = view.getUint32(block.length - 4, true)
  const end = block.length - 4 - restarts * 4
  const reader = new Reader(block, 0)
  let key = new Uint8Array(0)
  while (reader.pos < end) {
    const shared = reader.varint()
    const unshared = reader.varint()
    const valueLength = reader.varint()
    const delta = reader.bytes(unshared)
    const next = new Uint8Array(shared + unshared)
    next.set(key.subarray(0, shared), 0)
    next.set(delta, shared)
    key = next
    yield { key, value: reader.bytes(valueLength) }
  }
}

// Helpers

class Reader {
  pos: number
  readonly data: Uint8Array
  constructor(data: Uint8Array, pos: number) {
    this.data = data
    this.pos = pos
  }
  u8(): number {
    const byte = this.data[this.pos++]
    if (byte === undefined) throw new Error('leveldb: truncated')
    return byte
  }
  varint(): number {
    let result = 0
    let shift = 0
    while (true) {
      const byte = this.u8()
      result |= (byte & 0x7f) << shift
      if ((byte & 0x80) === 0) return result >>> 0
      shift += 7
      if (shift > 28) throw new Error('leveldb: varint too long')
    }
  }
  varint64(): number {
    let result = 0n
    let shift = 0n
    while (true) {
      const byte = this.u8()
      result |= BigInt(byte & 0x7f) << shift
      if ((byte & 0x80) === 0) return Number(result)
      shift += 7n
      if (shift > 63n) throw new Error('leveldb: varint too long')
    }
  }
  bytes(length: number): Uint8Array {
    if (this.pos + length > this.data.length) throw new Error('leveldb: truncated')
    const out = this.data.subarray(this.pos, this.pos + length)
    this.pos += length
    return out
  }
}

function concat(parts: ReadonlyArray<Uint8Array>): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let pos = 0
  for (const part of parts) {
    out.set(part, pos)
    pos += part.length
  }
  return out
}
