/**
 * Restore from a backup folder (plan v3 §14.3, §14.4; spec `beginRestore`,
 * `replay`, `install`).
 *
 * A restore runs in two halves, because the engine holds `agent.sqlite`
 * open while it runs:
 *
 * 1. **Stage**, in the running agent: find the newest manifest the backup
 *    key authenticates, decrypt its snapshot into `restore.sqlite.tmp`, and
 *    replay every segment the manifest names, in order and without a gap
 *    (each segment's associated data names the previous segment's hash).
 *    A segment the folder does not have yet makes the restore wait. Then
 *    rename the file to `restore.sqlite` and write `restore.json`. The
 *    agent then restarts.
 * 2. **Install**, at the next open, after the owner lock and before
 *    `agent.sqlite` opens: recheck the deletion record (G11), then replace
 *    `agent.sqlite` with the staged file. The ownership module finishes the
 *    install in the opened store (recovery mode) and deletes `restore.json`.
 *
 * The backup key comes from this Mac's keychain, or, on a new Mac, from the
 * recovery phrase main put in the keychain, through the wrap each manifest
 * carries.
 *
 * **The deletion record (G13).** A trusted record comes from this Mac's
 * keychain or from a move's final manifest. With one, a generation older
 * than the record is refused: it may hold removed messages. Without one,
 * Juno restores the newest authenticated generation and the Review page
 * says it cannot check that it is the newest (`trusted: false`). The strict
 * option that makes the recovery phrase a trusted record is off by default
 * (O4) and not built in v1.
 */
import { closeSync, existsSync, fsyncSync, openSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { AGENT_DATABASE_FILE } from '../runtime/core'
import { crashPoint } from '../runtime/crash'
import { applySegment } from './capture'
import type { BackupKeychain } from './backup'
import { generations, manifestHash, manifestPath, parseManifest, readBytes, readText, segmentPath, writeDurable, type Manifest } from './folder'
import { BackupUnreadable, moveCode, sha256, unseal, unwrapKey, unwrapWithPhrase, type PhraseWrap } from './keys'

export const RESTORE_DATABASE = 'restore.sqlite'
export const RESTORE_RECORD = 'restore.json'
const AGENT_DATABASE = AGENT_DATABASE_FILE

/** What a staged restore installs. Written to `restore.json`. */
export interface StagedRestore {
  readonly folder: string
  readonly gen: number
  readonly label: number
  /** When the backup was taken (its manifest's time). */
  readonly backupAt: number
  /** The deletion record the install checks against: this Mac's, or the move's. */
  readonly deletion: number
  readonly trusted: boolean
  /** The move code of a move's final manifest. */
  readonly moveCode?: string
  readonly epoch: number
  /** The Mac that wrote the backup. */
  readonly from: string
  /** This Mac's `ownership.device_id`, kept across the install. */
  readonly device: string
  readonly phrase?: PhraseWrap
}

export type StageResult =
  | { readonly _tag: 'staged'; readonly restore: StagedRestore }
  /** The newest manifest names a segment the folder does not have yet. */
  | { readonly _tag: 'waiting' }
  | { readonly _tag: 'refused'; readonly reason: 'noBackup' | 'noKey' | 'stale' }

const aad = (gen: number, position: number, prev: string) => `juno-backup:${gen}:${position}:${prev}`

/** The newest manifest a key authenticates, with that key. */
async function newest(folder: string, keychain: BackupKeychain): Promise<{ readonly manifest: Manifest; readonly text: string; readonly key: Buffer; readonly fromPhrase: boolean } | 'noBackup' | 'noKey'> {
  const gens = generations(folder)
  if (gens.length === 0) return 'noBackup'
  const stored = await keychain.get('backupKey')
  const phrase = await keychain.get('recoveryPhrase')
  for (const gen of gens) {
    const text = readText(manifestPath(folder, gen))
    const parsed = text === undefined ? undefined : parseManifest(text)
    if (text === undefined || parsed === undefined) continue
    if (stored !== undefined) {
      const key = Buffer.from(stored, 'base64')
      if (parsed.verify(key)) return { manifest: parsed.manifest, text, key, fromPhrase: false }
    }
    if (phrase !== undefined && parsed.manifest.phrase !== undefined) {
      try {
        const key = unwrapWithPhrase(phrase, parsed.manifest.phrase)
        if (parsed.verify(key)) return { manifest: parsed.manifest, text, key, fromPhrase: true }
      } catch (error) {
        if (!(error instanceof BackupUnreadable)) throw error
      }
    }
  }
  return 'noKey'
}

function syncDir(dir: string): void {
  const fd = openSync(dir, 'r')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

/** Stage 1. `device` is this Mac's `ownership.device_id`. */
export async function stageRestore(input: { readonly agentDir: string; readonly folder: string; readonly keychain: BackupKeychain; readonly device: string }): Promise<StageResult> {
  const { agentDir, folder, keychain } = input
  const found = await newest(folder, keychain)
  if (typeof found === 'string') return { _tag: 'refused', reason: found }
  const { manifest, key } = found
  const moved = manifest.owner.state === 'released'
  const record = await keychain.get('deletionRecord')
  const trusted = record !== undefined || moved
  const deletion = Math.max(Number(record ?? 0), moved ? manifest.deletion : 0)
  // Spec `install`'s guard, checked first here and again at install.
  if (trusted && manifest.label < deletion) return { _tag: 'refused', reason: 'stale' }

  const dataKey = unwrapKey(key, manifest.key, `g${manifest.gen}`)
  const temp = join(agentDir, `${RESTORE_DATABASE}.tmp`)
  rmSync(temp, { force: true })
  const snapshot = readBytes(segmentPath(folder, manifest.gen, 0))
  if (snapshot === undefined || sha256(snapshot) !== manifest.snapshotHash) return { _tag: 'waiting' }
  writeDurable(temp, unseal(dataKey, snapshot, aad(manifest.gen, 0, ''), 'the snapshot'))
  const db = new DatabaseSync(temp, { enableForeignKeyConstraints: false })
  let complete = false
  try {
    let prev = manifest.snapshotHash
    for (let position = 1; position <= manifest.head; position++) {
      const sealed = readBytes(segmentPath(folder, manifest.gen, position))
      if (sealed === undefined) return { _tag: 'waiting' }
      let segment: Buffer
      try {
        segment = unseal(dataKey, sealed, aad(manifest.gen, position, prev), `segment ${position}`)
      } catch (error) {
        // An older copy of the file, not yet replaced by the folder's sync.
        if (error instanceof BackupUnreadable) return { _tag: 'waiting' }
        throw error
      }
      applySegment(db, segment)
      prev = sha256(sealed)
    }
    complete = prev === manifest.headHash
    if (!complete) return { _tag: 'waiting' }
  } finally {
    db.close()
    if (!complete) rmSync(temp, { force: true })
  }

  if (found.fromPhrase && (await keychain.get('backupKey')) === undefined) await keychain.set('backupKey', key.toString('base64'))
  renameSync(temp, join(agentDir, RESTORE_DATABASE))
  syncDir(agentDir)
  const restore: StagedRestore = {
    folder, gen: manifest.gen, label: manifest.label, backupAt: manifest.at, deletion, trusted,
    ...(moved ? { moveCode: moveCode(manifestHash(found.text)) } : {}),
    epoch: manifest.owner.epoch, from: manifest.owner.name, device: input.device,
    ...(manifest.phrase ? { phrase: manifest.phrase } : {}),
  }
  writeDurable(join(agentDir, RESTORE_RECORD), JSON.stringify(restore))
  crashPoint('restore.staged')
  return { _tag: 'staged', restore }
}

export function stagedRestore(agentDir: string): StagedRestore | undefined {
  const text = readText(join(agentDir, RESTORE_RECORD))
  return text === undefined ? undefined : (JSON.parse(text) as StagedRestore)
}

export const clearStagedRestore = (agentDir: string) => {
  rmSync(join(agentDir, RESTORE_RECORD), { force: true })
  rmSync(join(agentDir, RESTORE_DATABASE), { force: true })
}

export type Install =
  | { readonly _tag: 'none' }
  /** `agent.sqlite` is the staged database now; the ownership module finishes the install. */
  | { readonly _tag: 'installed'; readonly restore: StagedRestore }
  /** A removal after staging made the candidate older than the deletion record (G11). It was dropped. */
  | { readonly _tag: 'quarantined' }

/**
 * Stage 2, before `agent.sqlite` opens. Idempotent: a crash at any point
 * leaves either the staged file (install again) or the installed one with
 * `restore.json` (finish again).
 */
export async function installStaged(agentDir: string, keychain: BackupKeychain | undefined): Promise<Install> {
  rmSync(join(agentDir, `${RESTORE_DATABASE}.tmp`), { force: true })
  const restore = stagedRestore(agentDir)
  const staged = join(agentDir, RESTORE_DATABASE)
  if (restore === undefined) {
    rmSync(staged, { force: true })
    return { _tag: 'none' }
  }
  if (existsSync(staged)) {
    const record = Number((await keychain?.get('deletionRecord')) ?? 0)
    if ((restore.trusted || record > 0) && restore.label < Math.max(record, restore.deletion)) {
      clearStagedRestore(agentDir)
      return { _tag: 'quarantined' }
    }
    // An old WAL beside the new file would be replayed into it.
    for (const suffix of ['-wal', '-shm']) rmSync(join(agentDir, `${AGENT_DATABASE}${suffix}`), { force: true })
    renameSync(staged, join(agentDir, AGENT_DATABASE))
    syncDir(agentDir)
    crashPoint('restore.swapped')
  }
  return { _tag: 'installed', restore }
}
