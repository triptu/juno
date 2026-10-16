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
 *    deletion record is ahead of both the generation and the data (G13: a
 *    crash after the record was raised, before the removal committed; a
 *    removal that committed regenerates through its purge, after the node
 *    versions that depend on it are gone), the schema or the
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
import { accessSync, constants, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { crashPoint } from '../runtime/crash'
import { transaction } from '../store/database'
import type { Store } from '../store/store'
import { replicatedTables, snapshotInto, startCapture } from './capture'
import { generations, manifestHash, manifestPath, parseManifest, readText, removeGeneration, segmentPath, signManifest, writeDurable, type Manifest, type ManifestOwner } from './folder'
import { createBackupContext, type BackupContext, type Current } from './context'
import { counterNonce, moveCode, newKey, newPhrase, seal, sha256, unwrapKey, wrapKey, wrapWithPhrase } from './keys'

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
  /**
   * Starts a generation from a snapshot taken now, then deletes the older ones. The purge calls it
   * after the node versions that depend on removal `gen` are gone, so the snapshot holds nothing of
   * it. Safe to repeat.
   */
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
  /** Stops without exporting, for an engine that failed to open. The next start begins a generation. */
  readonly stop: () => void
}

/**
 * The folder holds a backup this Mac must not write over: one its key cannot open, or one from another
 * Mac at the same epoch (this Mac's own earlier install, or a second restore of one backup). Writing
 * would delete it.
 */
export class ForeignBackup extends Error {
  constructor(folder: string) {
    super(`${folder} holds another Juno backup`)
    this.name = 'ForeignBackup'
  }
}

/** Another Mac took Juno over: its manifest in the folder has a later epoch (G7). */
export class OwnedElsewhere extends Error {
  constructor() {
    super('Another Mac owns Juno now.')
    this.name = 'OwnedElsewhere'
  }
}

const SNAPSHOT_FILE = 'backup-snapshot.tmp'
const aad = (gen: number, position: number, prev: string) => `juno-backup:${gen}:${position}:${prev}`

export { defaultBackupFolder } from './context'

function backupPublication(context: BackupContext) {
  const { options, db, state, folder, owner, progress } = context
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
      // The same epoch from another Mac: this Mac's own older install, or a second restore of one
      // backup. Neither is a newer owner, and writing would delete that backup.
      if (theirs.epoch === me.epoch) throw new ForeignBackup(dir)
      state.stopped = true
      options.observed(theirs)
      return true
    }
    return false
  }

  /** The current generation as the folder has it, or undefined if it must start again. */
  const load = (key: Buffer): Current | undefined => {
    const p = progress()
    if (state.current !== undefined && state.current.folder === folder() && state.current.manifest.gen === p.gen) return state.current
    const text = readText(manifestPath(folder(), p.gen))
    const parsed = text === undefined ? undefined : parseManifest(text)
    if (parsed === undefined || !parsed.verify(key) || parsed.manifest.head !== p.head || parsed.manifest.headHash !== p.head_hash) return undefined
    state.current = { folder: folder(), manifest: parsed.manifest, dataKey: unwrapKey(key, parsed.manifest.key, `g${p.gen}`) }
    return state.current
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
    return text
  }

  /** A new phrase whose wrap no published manifest carries yet. Durable, so a restart publishes it. */
  const republish = () => {
    const p = progress()
    return p.phrase_at !== null && (p.last_at ?? 0) <= p.phrase_at
  }

  /** Earlier folders lose this Mac's generations once one is published in the current folder. */
  const clearRetired = () => {
    const retired = JSON.parse(progress().retired) as string[]
    if (retired.length === 0) return
    for (const dir of retired) if (dir !== folder()) for (const gen of generations(dir)) removeGeneration(dir, gen)
    transaction(db, () => db.prepare("UPDATE backup_progress SET retired = '[]' WHERE singleton = 1").run())
  }

  const ownerOf = (ownerState: ManifestOwner['state']): ManifestOwner => {
    const me = owner()
    return { device: me.device, name: options.deviceName, epoch: me.epoch, state: ownerState }
  }

  return { ownedElsewhere, load, reserveNonce, publish, republish, clearRetired, ownerOf }
}

function backupExports(context: BackupContext, publication: ReturnType<typeof backupPublication>) {
  const { options, store, db, local, strip, state, deletionRecord, folder, progress, memoryGen, labelNow, phraseWrap, schema } = context
  const { publish, clearRetired, ownerOf, republish, reserveNonce } = publication
  /** Spec `newGeneration`, `snapshot`, `publishManifest` at head 0, then `shred`. */
  const newGeneration = async (key: Buffer, ownerState: ManifestOwner['state']): Promise<string> => {
    const record = await deletionRecord()
    const dir = folder()
    const gen = Math.max(progress().gen, ...generations(dir), 0) + 1
    const snapshotPath = join(options.agentDir, SNAPSHOT_FILE)
    state.due = true
    // The snapshot and the sessions after it start with no write between them. Capture restarts even
    // if the snapshot fails, and `due` makes the next export try a generation again.
    state.capture?.close()
    try {
      snapshotInto(db, snapshotPath, strip)
    } finally {
      state.capture = startCapture(db, replicatedTables(db, local))
    }
    const atSnapshot = memoryGen()
    const label = labelNow(record)
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
      owner: ownerOf(ownerState), key: wrapKey(key, dataKey, `g${gen}`), ...(phrase ? { phrase } : {}),
    }
    const text = publish(key, manifest)
    state.current = { folder: dir, manifest, dataKey }
    state.due = false
    for (const old of generations(dir)) if (old < gen) removeGeneration(dir, old)
    clearRetired()
    options.changed?.()
    return text
  }

  /** Spec `encrypt` then `publishManifest` then `persistExport`, for the changes since the last cut. */
  const exportChanges = async (key: Buffer, at: Current): Promise<void> => {
    const segment = state.capture!.cut()
    if (segment === undefined && !republish()) return
    // From here a failure leaves cut changes outside the backup: the next export starts a generation.
    state.due = true
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
    state.current = { ...at, manifest }
    state.due = false
    options.changed?.()
  }

  return { newGeneration, exportChanges }
}

function backupExporter(context: BackupContext, publication: ReturnType<typeof backupPublication>, exports: ReturnType<typeof backupExports>) {
  const { state, owner, backupKey, progress, deletionRecord, memoryGen, schema, db, local } = context
  const { ownedElsewhere, load } = publication
  const { newGeneration, exportChanges } = exports
  const exportNow = async (): Promise<void> => {
    if (state.stopped || owner().state !== 'active') return
    const key = await backupKey()
    if (ownedElsewhere(key)) return
    const p = progress()
    const at = state.due ? undefined : load(key)
    const record = await deletionRecord()
    const stale =
      at === undefined ||
      (record > p.label && memoryGen() < record) ||
      at.manifest.schema.join() !== schema().join() ||
      replicatedTables(db, local).join() !== state.capture!.tables.join()
    if (stale) {
      await newGeneration(key, 'active')
      return
    }
    await exportChanges(key, at)
  }

  return exportNow
}

function backupCommands(context: BackupContext, publication: ReturnType<typeof backupPublication>, newGeneration: ReturnType<typeof backupExports>['newGeneration'], serial: <T>(f: () => Promise<T>) => Promise<T>, exportNow: () => Promise<void>): Pick<Backup, 'setFolder' | 'exportPhrase' | 'finalCheckpoint'> {
  const { options, store, db, state, folder, owner, backupKey } = context
  const { keychain } = options
  const { ownedElsewhere } = publication
  return {
    setFolder: (path) =>
      serial(async () => {
        if (!isAbsolute(path)) throw new Error('The backup folder must be an absolute path.')
        const old = folder()
        if (old === path) return
        // Checked before the setting changes, so a refused folder is never used.
        mkdirSync(path, { recursive: true })
        accessSync(path, constants.W_OK)
        if (owner().state === 'active' && ownedElsewhere(await backupKey(), path)) return
        transaction(db, () =>
          db.prepare("UPDATE backup_progress SET folder = ?, retired = json_insert(retired, '$[#]', ?) WHERE singleton = 1").run(path, old),
        )
        state.due = true
        state.current = undefined
        options.changed?.()
        await exportNow()
      }),
    exportPhrase: () =>
      serial(async () => {
        const phrase = newPhrase()
        const wrap = wrapWithPhrase(phrase, await backupKey())
        await keychain.set('recoveryPhrase', phrase)
        transaction(db, () => db.prepare('UPDATE backup_progress SET phrase = ?, phrase_at = ? WHERE singleton = 1').run(JSON.stringify(wrap), store.now()))
        options.changed?.()
        await exportNow()
      }),
    finalCheckpoint: () =>
      serial(async () => {
        if (owner().state !== 'released') throw new Error('The final checkpoint needs a released owner.')
        const key = await backupKey()
        if (ownedElsewhere(key)) throw new OwnedElsewhere()
        // A crash after publishing, before the code was recorded: the published manifest is the final one.
        const me = owner()
        const newest = generations(folder())[0]
        const text = newest === undefined ? undefined : readText(manifestPath(folder(), newest))
        const published = text === undefined ? undefined : parseManifest(text)
        if (text !== undefined && published?.verify(key) && published.manifest.owner.device === me.device && published.manifest.owner.state === 'released' && published.manifest.owner.epoch === me.epoch) {
          return moveCode(manifestHash(text))
        }
        return moveCode(manifestHash(await newGeneration(key, 'released')))
      }),
  }
}

export function createBackup(options: BackupOptions): Backup {
  const context = createBackupContext(options)
  const { db, state, folder, progress, owner, backupKey, deletionRecord } = context
  const { keychain } = options
  const report = options.onReport ?? (() => {})
  const publication = backupPublication(context)
  const { ownedElsewhere, load } = publication
  const exports = backupExports(context, publication)
  const { newGeneration } = exports
  const exportNow = backupExporter(context, publication, exports)
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(f: () => Promise<T>): Promise<T> => {
    const next = queue.then(f)
    queue = next.catch(() => {})
    return next
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
    ...backupCommands(context, publication, newGeneration, serial, exportNow),
    removal: {
      raiseDeletion: async (gen) => {
        if ((await deletionRecord()) < gen) await keychain.set('deletionRecord', String(gen))
      },
      regenerate: (gen) =>
        serial(async () => {
          if (state.stopped || owner().state !== 'active') return
          const key = await backupKey()
          if (!state.due && state.regenerated >= gen && load(key) !== undefined) return
          if (ownedElsewhere(key)) return
          await newGeneration(key, 'active')
          state.regenerated = Math.max(state.regenerated, gen)
        }),
    },
    stop: () => {
      if (timer) clearInterval(timer)
      state.stopped = true
      state.capture?.close()
      state.capture = undefined
    },
    close: async () => {
      if (timer) clearInterval(timer)
      await flush().catch(report)
      await queue
      if (!state.due) transaction(db, () => db.prepare('UPDATE backup_progress SET clean = 1 WHERE singleton = 1').run())
      state.capture?.close()
      state.capture = undefined
    },
  }
}
