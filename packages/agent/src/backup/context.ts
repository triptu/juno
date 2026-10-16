import { join } from 'node:path'
import { transaction } from '../store/database'
import { replicatedTables, startCapture, type Capture } from './capture'
import { newKey, type PhraseWrap } from './keys'
import type { Manifest } from './folder'
import type { BackupOptions, BackupKeychain } from './backup'

export const defaultBackupFolder = (agentDir: string) => join(agentDir, 'backup')

interface Progress {
  readonly folder: string | null
  readonly gen: number
  readonly head: number
  readonly head_hash: string
  readonly label: number
  readonly memory_gen: number
  readonly clean: number
  readonly last_at: number | null
  readonly phrase_at: number | null
  readonly phrase: string | null
  readonly retired: string
}

export interface Current {
  readonly folder: string
  readonly manifest: Manifest
  readonly dataKey: Buffer
}

interface BackupState {
  due: boolean
  capture: Capture | undefined
  current: Current | undefined
  stopped: boolean
  regenerated: number
}

function backupRecords(options: BackupOptions) {
  const { db } = options.store
  const progress = (): Progress => {
    db.prepare('INSERT OR IGNORE INTO backup_progress (singleton) VALUES (1)').run()
    return db.prepare('SELECT * FROM backup_progress WHERE singleton = 1').get() as unknown as Progress
  }
  const folder = () => progress().folder ?? defaultBackupFolder(options.agentDir)
  const owner = () => db.prepare('SELECT device_id AS device, epoch, state FROM ownership WHERE singleton = 1').get() as { device: string; epoch: number; state: string }
  const schema = () => (db.prepare('SELECT "set" || \'/\' || step AS step FROM schema_migrations ORDER BY "set", step').all() as Array<{ step: string }>).map((row) => row.step)
  const memoryGen = () => (db.prepare('SELECT gen FROM memory_head WHERE singleton = 1').get() as { gen: number }).gen
  /**
   * The removals a snapshot taken now excludes: up to the memory generation,
   * but not a removal whose node versions the purge has not deleted yet
   * (WP16's `nodes` step), and the deletion record when the removal behind
   * it never committed (G13).
   */
  const labelNow = (record: number) => {
    const gen = memoryGen()
    const unpurged = (db.prepare("SELECT min(gen) AS gen FROM redaction_purges WHERE step = 'nodes' AND done_at IS NULL").get() as { gen: number | null }).gen
    const excluded = unpurged === null ? gen : Math.min(gen, unpurged - 1)
    return gen < record ? Math.max(excluded, record) : excluded
  }
  const phraseWrap = (): PhraseWrap | undefined => {
    const text = progress().phrase
    return text === null ? undefined : (JSON.parse(text) as PhraseWrap)
  }

  return { progress, folder, owner, schema, memoryGen, labelNow, phraseWrap }
}

function backupSecrets(keychain: BackupKeychain) {
  const backupKey = async (): Promise<Buffer> => {
    const stored = await keychain.get('backupKey')
    if (stored !== undefined) return Buffer.from(stored, 'base64')
    const key = newKey()
    await keychain.set('backupKey', key.toString('base64'))
    return key
  }
  const deletionRecord = async () => Number((await keychain.get('deletionRecord')) ?? 0)

  return { backupKey, deletionRecord }
}

export type BackupContext = ReturnType<typeof createBackupContext>

export function createBackupContext(options: BackupOptions) {
  const records = backupRecords(options)
  const { db } = options.store
  const local = new Set(options.local)
  // The migration log is the snapshot's schema; the snapshot keeps it.
  const strip = options.local.filter((table) => table !== 'schema_migrations')
  const due = records.progress().clean === 0 || records.progress().gen === 0
  transaction(db, () => db.prepare('UPDATE backup_progress SET clean = 0 WHERE singleton = 1').run())
  const state: BackupState = { due, capture: startCapture(db, replicatedTables(db, local)), current: undefined, stopped: false, regenerated: 0 }
  return { options, store: options.store, db, local, strip, state, ...records, ...backupSecrets(options.keychain) }
}

