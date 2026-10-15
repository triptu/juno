/**
 * The backup folder's layout and its manifests (plan v3 §14.4).
 *
 *   <folder>/g000007/snapshot.bin      generation 7's snapshot, position 0
 *   <folder>/g000007/segment-1.bin     the delta from position 0 to 1
 *   <folder>/g000007/manifest.json     the authenticated chain head
 *
 * Every file is written to a temporary name, synced, renamed and its
 * directory synced, so a reader sees a whole file or none. A segment is
 * written before the manifest that names it; a manifest whose segment has
 * not arrived (a synced folder can deliver out of order) makes a restore
 * wait (spec `manifestBeforeSegment`).
 *
 * Juno touches only `g` folders. Deleting a generation's folder deletes the
 * only copy of its wrapped data key: that is the shredding (§14.4).
 */
import { closeSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Schema } from 'effect'
import { macMatches, manifestMac, sha256 } from './keys'

export const ManifestOwner = Schema.Struct({
  /** `ownership.device_id` of the Mac that wrote it. */
  device: Schema.String,
  /** That Mac's name, for "Juno is working on your other Mac". */
  name: Schema.String,
  epoch: Schema.Int,
  /** `released` only in a move's final manifest (§14.2). */
  state: Schema.Literals(['active', 'released']),
})
export type ManifestOwner = typeof ManifestOwner.Type

export const Manifest = Schema.Struct({
  v: Schema.Literal(1),
  gen: Schema.Int,
  /** When it was published. A restore shows it as the backup's time. */
  at: Schema.Number,
  /** The migration steps of the snapshot's schema, `set/step`. */
  schema: Schema.Array(Schema.String),
  snapshotHash: Schema.String,
  /** The last segment it names; 0 is the snapshot alone. */
  head: Schema.Int,
  headHash: Schema.String,
  /** The removals the generation excludes (`backup_progress.label`). */
  label: Schema.Int,
  /** The deletion record when it was written. */
  deletion: Schema.Int,
  owner: ManifestOwner,
  /** The generation's data key, wrapped by the backup key. */
  key: Schema.String,
  /** The backup key, wrapped by the recovery phrase. Absent until the owner exports one. */
  phrase: Schema.optionalKey(Schema.Struct({ salt: Schema.String, key: Schema.String })),
})
export type Manifest = typeof Manifest.Type

const Signed = Schema.Struct({ manifest: Schema.Unknown, mac: Schema.String })

/** Keys sorted at every level, so the MAC does not depend on property order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export const signManifest = (backupKey: Uint8Array, manifest: Manifest) => {
  const body = canonical(manifest)
  return JSON.stringify({ manifest: JSON.parse(body), mac: manifestMac(backupKey, body) })
}

/** The manifest's hash, which the move code shows. */
export const manifestHash = (text: string) => sha256(text)

/** The manifest in `text` if it parses, then whether `backupKey` authenticates it. */
export function parseManifest(text: string): { readonly manifest: Manifest; readonly verify: (backupKey: Uint8Array) => boolean } | undefined {
  try {
    const signed = Schema.decodeUnknownSync(Signed)(JSON.parse(text))
    const manifest = Schema.decodeUnknownSync(Manifest)(signed.manifest)
    const body = canonical(signed.manifest)
    return { manifest, verify: (backupKey) => macMatches(signed.mac, manifestMac(backupKey, body)) }
  } catch {
    return undefined
  }
}

const GENERATION = /^g(\d{6})$/

export const generationDir = (folder: string, gen: number) => join(folder, `g${String(gen).padStart(6, '0')}`)
export const manifestPath = (folder: string, gen: number) => join(generationDir(folder, gen), 'manifest.json')
/** Position 0 is the snapshot; position n > 0 the delta from n - 1 to n. */
export const segmentPath = (folder: string, gen: number, position: number) =>
  join(generationDir(folder, gen), position === 0 ? 'snapshot.bin' : `segment-${position}.bin`)

/** The generations in the folder, newest first. */
export function generations(folder: string): ReadonlyArray<number> {
  let names: string[]
  try {
    names = readdirSync(folder)
  } catch {
    return []
  }
  return names.flatMap((name) => {
    const match = GENERATION.exec(name)
    return match === null ? [] : [Number(match[1])]
  }).toSorted((a, b) => b - a)
}

export function readText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

export function readBytes(path: string): Buffer | undefined {
  try {
    return readFileSync(path)
  } catch {
    return undefined
  }
}

function syncDir(dir: string): void {
  const fd = openSync(dir, 'r')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

/** Writes `bytes` to `path` so a reader sees all of it or none, durable when it returns. */
export function writeDurable(path: string, bytes: Uint8Array | string): void {
  const dir = dirname(path)
  mkdirSync(dir, { recursive: true })
  const temp = `${path}.tmp`
  const fd = openSync(temp, 'w')
  try {
    const data = typeof bytes === 'string' ? Buffer.from(bytes) : bytes
    let written = 0
    while (written < data.byteLength) written += writeSync(fd, data, written, data.byteLength - written)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(temp, path)
  syncDir(dir)
}

export function removeGeneration(folder: string, gen: number): void {
  rmSync(generationDir(folder, gen), { recursive: true, force: true })
}
