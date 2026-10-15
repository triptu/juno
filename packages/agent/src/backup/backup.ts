/**
 * The encrypted backup (plan v3 §14.4, §14.5; spec `agent-recovery.qnt`
 * `snapshot`, `encrypt`, `publishManifest`, `persistExport`,
 * `raiseDeletion`, `newGeneration`, `shred`, `observeOwner`).
 *
 * One generation at a time. A generation is a snapshot under a fresh data
 * key, then delta segments, each named by the next manifest. Every export:
 *
 * 1. reads the newest manifest in the folder first: one from another Mac
 *    with a higher epoch means that Mac owns Juno now, and this one stops
 *    (G7, spec `observeOwner`);
 * 2. starts a new generation when one is due: none yet, the last close was
 *    not clean (changes made before a crash were never captured), the
 *    deletion record is ahead of the generation (G13), the schema or the
 *    set of tables changed (a patchset holds no schema), the folder
 *    changed, or an earlier export failed after its cut;
 * 3. otherwise cuts the changes since the last segment, writes the
 *    segment, then renames the manifest, and only then moves the export
 *    cursor (spec `exportAfterManifest`);
 * 4. after a new generation's manifest is renamed, deletes every older
 *    generation, and with it the only copy of its wrapped data key
 *    (crypto-shredding, spec `shred`).
 *
 * Only an active owner exports. A released Mac writes one more generation,
 * the move's final checkpoint (§14.2). A Mac in recovery writes nothing
 * until it is activated.
 *
 * Exports run one at a time, every minute while something changed, so the
 * recovery point stays within the 5 minutes §14.3 states.
 */
import { readFileSync, rmSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { crashPoint } from '../runtime/crash'
import { transaction } from '../store/database'
import type { Store } from '../store/store'
import { replicatedTables, snapshotInto, startCapture, type Capture } from './capture'
import { generations, manifestHash, manifestPath, parseManifest, readText, removeGeneration, segmentPath, signManifest, writeDurable, type Manifest, type ManifestOwner } from './folder'
import { counterNonce, moveCode, newKey, newPhrase, seal, sha256, unwrapKey, wrapKey, wrapWithPhrase, type PhraseWrap } from './keys'

/** Names under which main's keychain keeps Juno's backup secrets. */
export type BackupSecret = 'backupKey' | 'deletionRecord' | 'recoveryPhrase'

/**
 * Main's keychain, over the agent's port. The values never reach SQLite,
 * the renderer or a log.
 *
 * - `backupKey`: the key that wraps data keys and authenticates manifests.
 * - `deletionRecord`: the latest removal's generation (§14.4). It only grows.
 * - `recoveryPhrase`: the phrase Juno made for Export recovery phrase, for
 *   main to show the owner; on a new Mac, the phrase the owner typed, for a
 *   restore to read.
 */
export interface BackupKeychain {
  readonly get: (name: BackupSecret) => Promise<string | undefined>
  /** Durable before it resolves. */
  readonly set: (name: BackupSecret, value: string) => Promise<void>
}

/**
 * The hooks a removal calls (WP16's `RemovalBackup`). `gen` is the memory
 * generation the removal moves to.
 */
export interface RemovalHooks {
  /** Raises the keychain deletion record to at least `gen`. Durable before it resolves. */
  readonly raiseDeletion: (gen: number) => Promise<void>
  /** Starts a generation from a snapshot taken at memory generation `gen` or later, then deletes the older ones. Idempotent. */
  readonly regenerate: (gen: number) => Promise<void>
}

export interface BackupOptions {
  readonly store: Store
  readonly agentDir: string
  readonly keychain: BackupKeychain
  /** This Mac's name, written into each manifest for the other Mac's banner. */
  readonly deviceName: string
  /** Tables a backup never carries: every folder's local tables. */
  readonly local: ReadonlyArray<string>
  /** A manifest from another Mac with a higher epoch is in the folder (G7). */
  readonly observed: (owner: ManifestOwner) => void
  /** How often to export what changed. 0 exports only on `flush`. Default one minute. */
  readonly intervalMs?: number
  /** The backup's rows on Settings may have changed. */
  readonly changed?: () => void
  readonly onReport?: (error: unknown) => void
}

export interface Backup {
  readonly folder: () => string
  readonly lastAt: () => number | undefined
  readonly phraseExportedAt: () => number | undefined
  /** Exports what changed, starting a generation when one is due. */
  readonly flush: () => Promise<void>
  /** Moves the backup to `path`: a new generation there, then this Mac's generations leave the old folder. */
  readonly setFolder: (path: string) => Promise<void>
  /** Makes a new recovery phrase, gives it to the keychain for main to show, and carries its wrap in every later manifest. */
  readonly exportPhrase: () => Promise<void>
  /**
   * The move's final checkpoint and its publication (§14.2 steps 3 and 4):
   * a new generation whose manifest says `released`. The ownership row
   * must already be `released`. Returns the move code.
   */
  readonly finalCheckpoint: () => Promise<string>
  readonly removal: RemovalHooks
  readonly close: () => Promise<void>
}

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
}

interface Current {
  readonly folder: string
  readonly manifest: Manifest
  readonly dataKey: Buffer
}

/** The folder holds a backup this Mac's key cannot open. Juno does not write over it. */
export class ForeignBackup extends Error {
  constructor(folder: string) {
    super(`${folder} holds another Juno backup`)
    this.name = 'ForeignBackup'
  }
}

const SNAPSHOT_FILE = 'backup-snapshot.tmp'
const aad = (gen: number, position: number, prev: string) => `juno-backup:${gen}:${position}:${prev}`

export const defaultBackupFolder = (agentDir: string) => join(agentDir, 'backup')

export function createBackup(options: BackupOptions): Backup {
  const { store, keychain } = options
  const { db } = store
  const local = new Set(options.local)
  // The migration log is the snapshot's schema; it is never captured, but the snapshot keeps it.
  const strip = options.local.filter((table) => table !== 'schema_migrations')
  const report = options.onReport ?? (() => {})

  const progress = (): Progress => {
    db.prepare('INSERT OR IGNORE INTO backup_progress (singleton) VALUES (1)').run()
    return db.prepare('SELECT * FROM backup_progress WHERE singleton = 1').get() as unknown as Progress
  }
  const folder = () => progress().folder ?? defaultBackupFolder(options.agentDir)
  const owner = () => db.prepare('SELECT device_id AS device, epoch, state FROM ownership WHERE singleton = 1').get() as { device: string; epoch: number; state: string }
  const schema = () => (db.prepare('SELECT "set" || \'/\' || step AS step FROM schema_migrations ORDER BY "set", step').all() as Array<{ step: string }>).map((row) => row.step)
  const memoryGen = () => (db.prepare('SELECT gen FROM memory_head WHERE singleton = 1').get() as { gen: number }).gen
  const phraseWrap = (): PhraseWrap | undefined => {
    const text = progress().phrase
    return text === null ? undefined : (JSON.parse(text) as PhraseWrap)
  }

  // A start after a crash cannot know what changed since the last segment: begin a new generation.
  let due = progress().clean === 0 || progress().gen === 0
  transaction(db, () => db.prepare('UPDATE backup_progress SET clean = 0 WHERE singleton = 1').run())
  let capture: Capture | undefined = startCapture(db, replicatedTables(db, local))
  let current: Current | undefined
  // The manifest must be written again although nothing changed (a new phrase).
  let republish = false
  let stopped = false

  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(f: () => Promise<T>): Promise<T> => {
    const next = queue.then(f)
    queue = next.catch(() => {})
    return next
  }

  const backupKey = async (): Promise<Buffer> => {
    const stored = await keychain.get('backupKey')
    if (stored !== undefined) return Buffer.from(stored, 'base64')
    const key = newKey()
    await keychain.set('backupKey', key.toString('base64'))
    return key
  }
  const deletionRecord = async () => Number((await keychain.get('deletionRecord')) ?? 0)

  /**
   * Reads the newest manifest before a write. Spec `observeOwner`: another
   * Mac at this epoch or later owns Juno, so this one stops and returns
   * true. A manifest this key cannot verify is another Juno's backup (a new
   * Mac pointed at the old Mac's folder before restoring it): writing would
   * delete it, so the export fails.
   */
  const ownedElsewhere = (key: Buffer, dir = folder()): boolean => {
    const me = owner()
    for (const gen of generations(dir)) {
      const text = readText(manifestPath(dir, gen))
      const parsed = text === undefined ? undefined : parseManifest(text)
      if (parsed === undefined) continue
      if (!parsed.verify(key)) throw new ForeignBackup(dir)
      const theirs = parsed.manifest.owner
      if (theirs.device === me.device || theirs.epoch < me.epoch) return false
      stopped = true
      options.observed(theirs)
      return true
    }
    return false
  }

  /** The current generation as the folder has it, or undefined if it must start again. */
  const load = (key: Buffer): Current | undefined => {
    const p = progress()
    if (current !== undefined && current.folder === folder() && current.manifest.gen === p.gen) return current
    const text = readText(manifestPath(folder(), p.gen))
    const parsed = text === undefined ? undefined : parseManifest(text)
    if (parsed === undefined || !parsed.verify(key) || parsed.manifest.head !== p.head || parsed.manifest.headHash !== p.head_hash) return undefined
    current = { folder: folder(), manifest: parsed.manifest, dataKey: unwrapKey(key, parsed.manifest.key, `g${p.gen}`) }
    return current
  }

  const reserveNonce = (): number =>
    transaction(db, () => (db.prepare('UPDATE backup_progress SET nonce = nonce + 1 WHERE singleton = 1 RETURNING nonce').get() as { nonce: number }).nonce)

  const publish = (key: Buffer, manifest: Manifest): string => {
    const text = signManifest(key, manifest)
    writeDurable(manifestPath(folder(), manifest.gen), text)
    crashPoint('backup.manifestRenamed')
    transaction(db, () =>
      db.prepare('UPDATE backup_progress SET head = ?, head_hash = ?, last_at = ? WHERE singleton = 1').run(manifest.head, manifest.headHash, manifest.at),
    )
    republish = false
    return text
  }

  const ownerOf = (state: ManifestOwner['state']): ManifestOwner => {
    const me = owner()
    return { device: me.device, name: options.deviceName, epoch: me.epoch, state }
  }

  /** Spec `newGeneration`, `snapshot`, `publishManifest` at head 0, then `shred`. */
  const newGeneration = async (key: Buffer, state: ManifestOwner['state']): Promise<string> => {
    const record = await deletionRecord()
    const dir = folder()
    const gen = Math.max(progress().gen, ...generations(dir), 0) + 1
    const snapshotPath = join(options.agentDir, SNAPSHOT_FILE)
    // The snapshot and the sessions after it start with no write between them.
    capture?.close()
    snapshotInto(db, snapshotPath, strip)
    const tables = replicatedTables(db, local)
    capture = startCapture(db, tables)
    const atSnapshot = memoryGen()
    due = true
    const label = Math.max(atSnapshot, record)
    transaction(db, () =>
      db.prepare("UPDATE backup_progress SET gen = ?, head = 0, head_hash = '', label = ?, memory_gen = ?, nonce = 1 WHERE singleton = 1").run(gen, label, atSnapshot),
    )
    const dataKey = newKey()
    const sealed = seal(dataKey, readFileSync(snapshotPath), aad(gen, 0, ''), counterNonce(1))
    rmSync(snapshotPath, { force: true })
    writeDurable(segmentPath(dir, gen, 0), sealed)
    crashPoint('backup.segmentWritten')
    const hash = sha256(sealed)
    const phrase = phraseWrap()
    const manifest: Manifest = {
      v: 1, gen, at: store.now(), schema: schema(), snapshotHash: hash, head: 0, headHash: hash, label, deletion: record,
      owner: ownerOf(state), key: wrapKey(key, dataKey, `g${gen}`), ...(phrase ? { phrase } : {}),
    }
    const text = publish(key, manifest)
    current = { folder: dir, manifest, dataKey }
    due = false
    for (const old of generations(dir)) if (old < gen) removeGeneration(dir, old)
    options.changed?.()
    return text
  }

  /** Spec `encrypt` then `publishManifest` then `persistExport`, for the changes since the last cut. */
  const exportChanges = async (key: Buffer, at: Current): Promise<void> => {
    const segment = capture!.cut()
    if (segment === undefined && !republish) return
    // From here a failure leaves cut changes outside the backup: the next export starts a generation.
    due = true
    const p = progress()
    const record = await deletionRecord()
    let head = p.head
    let headHash = p.head_hash
    if (segment !== undefined) {
      head = p.head + 1
      const sealed = seal(at.dataKey, segment, aad(p.gen, head, p.head_hash), counterNonce(reserveNonce()))
      writeDurable(segmentPath(at.folder, p.gen, head), sealed)
      crashPoint('backup.segmentWritten')
      headHash = sha256(sealed)
    }
    const phrase = phraseWrap()
    // A phrase is replaced, never removed, so the newest wrap always overrides.
    const manifest: Manifest = { ...at.manifest, at: store.now(), head, headHash, deletion: Math.max(record, at.manifest.deletion), owner: ownerOf('active'), ...(phrase ? { phrase } : {}) }
    publish(key, manifest)
    current = { ...at, manifest }
    due = false
    options.changed?.()
  }

  const exportNow = async (): Promise<void> => {
    if (stopped || owner().state !== 'active') return
    const key = await backupKey()
    if (ownedElsewhere(key)) return
    const p = progress()
    const at = due ? undefined : load(key)
    const stale =
      at === undefined ||
      (await deletionRecord()) > p.label ||
      at.manifest.schema.join() !== schema().join() ||
      replicatedTables(db, local).join() !== capture!.tables.join()
    if (stale) {
      await newGeneration(key, 'active')
      return
    }
    await exportChanges(key, at)
  }

  const flush = () => serial(exportNow)

  const intervalMs = options.intervalMs ?? 60_000
  const timer = intervalMs > 0 ? setInterval(() => void flush().catch(report), intervalMs) : undefined
  timer?.unref()

  return {
    folder,
    lastAt: () => progress().last_at ?? undefined,
    phraseExportedAt: () => progress().phrase_at ?? undefined,
    flush,
    setFolder: (path) =>
      serial(async () => {
        if (!isAbsolute(path)) throw new Error('The backup folder must be an absolute path.')
        const old = folder()
        if (old === path) return
        // Checked before the setting changes, so a refused folder is never used.
        if (owner().state === 'active' && ownedElsewhere(await backupKey(), path)) return
        transaction(db, () => db.prepare('UPDATE backup_progress SET folder = ? WHERE singleton = 1').run(path))
        due = true
        current = undefined
        options.changed?.()
        await exportNow()
        if (!due) for (const gen of generations(old)) removeGeneration(old, gen)
      }),
    exportPhrase: () =>
      serial(async () => {
        const phrase = newPhrase()
        const wrap = wrapWithPhrase(phrase, await backupKey())
        await keychain.set('recoveryPhrase', phrase)
        transaction(db, () => db.prepare('UPDATE backup_progress SET phrase = ?, phrase_at = ? WHERE singleton = 1').run(JSON.stringify(wrap), store.now()))
        republish = true
        options.changed?.()
        await exportNow()
      }),
    finalCheckpoint: () =>
      serial(async () => {
        if (owner().state !== 'released') throw new Error('The final checkpoint needs a released owner.')
        const key = await backupKey()
        if (ownedElsewhere(key)) throw new Error('Another Mac owns Juno now.')
        const text = await newGeneration(key, 'released')
        return moveCode(manifestHash(text))
      }),
    removal: {
      raiseDeletion: async (gen) => {
        if ((await deletionRecord()) < gen) await keychain.set('deletionRecord', String(gen))
      },
      regenerate: (gen) =>
        serial(async () => {
          if (stopped || owner().state !== 'active') return
          const key = await backupKey()
          if (!due && progress().memory_gen >= gen && load(key) !== undefined) return
          if (ownedElsewhere(key)) return
          await newGeneration(key, 'active')
        }),
    },
    close: async () => {
      if (timer) clearInterval(timer)
      await flush().catch(report)
      await queue
      if (!due) transaction(db, () => db.prepare('UPDATE backup_progress SET clean = 1 WHERE singleton = 1').run())
      capture?.close()
      capture = undefined
    },
  }
}
