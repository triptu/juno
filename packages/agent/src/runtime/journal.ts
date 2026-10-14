/**
 * The pi-durable journal of one incarnation (plan v3 §2.2, §3). This folder is
 * the only importer of pi-durable; the rest of the agent sees plain records.
 *
 * Opening is two steps, so recovery can decide before pi runs anything:
 *
 * 1. `openJournalFile` opens `pi-<incarnation>.sqlite` through Juno's FULL
 *    facade (pi's own Node adapter, switched to FULL and fullfsync before pi
 *    touches it, spikes S1) and reads the last committed position. It refuses
 *    a schema newer than this pi supports without writing (spec
 *    `unsupported`), and a file whose recorded incarnation is another one.
 * 2. `start` opens pi's storage and Harness on it. `resume()` is separate.
 *
 * `next_seq` in `durable_metadata` is pi's next free commit sequence, so the
 * last committed position is `next_seq - 1` (spec `nextSeq`). This reads a
 * pi-internal table, as does `commitsAfter` (`entries.commit_seq`); the
 * crash tests fail if pi renames them.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { createRegistry, Harness, ROOT_CONVERSATION_ID } from '@earendil-works/pi-durable'
import { CURRENT_SQLITE_SCHEMA_VERSION, SqliteStorage } from '@earendil-works/pi-durable/storage/sqlite'
import { openNodeSqliteDatabase, type NodeSqliteDatabase } from '@earendil-works/pi-durable/storage/sqlite/node'

const ctx = BACKGROUND_CONTEXT

type HarnessOptions = Parameters<typeof Harness.open>[1]
type HarnessInstance = Awaited<ReturnType<typeof Harness.open>>
type Root = Awaited<ReturnType<HarnessInstance['root']>>
/** pi-ai's model access. WP9's providers supply it; this folder may not import pi-ai. */
export type JournalModels = HarnessOptions['models']
export type Extension = Parameters<ReturnType<typeof createRegistry>['install']>[0]

export const journalFileName = (incarnation: string) => `pi-${incarnation}.sqlite`
export const JOURNAL_FILE = /^pi-(.+)\.sqlite(-wal|-shm|-journal)?$/

export interface JournalSettings {
  readonly models: JournalModels
  readonly model: { readonly provider: string; readonly modelId: string }
  /** WP11's request builder and guard, tools and sections. */
  readonly extensions?: ReadonlyArray<Extension>
  readonly onReport?: (error: unknown) => void
}

/** One commit of the root conversation with the entries it added, in commit order. */
export interface JournalCommit {
  readonly seq: number
  readonly entries: ReadonlyArray<JournalEntry>
}
export interface JournalEntry {
  readonly id: number
  readonly kind: string
  readonly data?: unknown
  /** pi-ai messages, as JSON. */
  readonly model?: ReadonlyArray<unknown>
}

export type Settled =
  | { readonly status: 'done' }
  | { readonly status: 'unanswered'; readonly reason: string }

export interface JournalFile {
  readonly incarnation: string
  readonly path: string
  /** `next_seq - 1`: the last commit position in this file. 0 for a new file. */
  readonly lastCommitted: number
  /** Opens pi on the file. */
  readonly start: (settings: JournalSettings) => Promise<Journal>
  /** Closes the facade without starting pi (a rollback, or the update-needed stop). */
  readonly close: () => Promise<void>
}

export type JournalOpen =
  | { readonly _tag: 'opened'; readonly file: JournalFile }
  /** pi refuses the file: it was written by a newer pi. Nothing was written. */
  | { readonly _tag: 'unsupported'; readonly version: number }
  /** The file records another incarnation: it was copied or renamed. Treated as behind the archive. */
  | { readonly _tag: 'foreign'; readonly recorded: string }

export async function openJournalFile(agentDir: string, incarnation: string): Promise<JournalOpen> {
  const path = join(agentDir, journalFileName(incarnation))
  const fresh = !existsSync(path)
  // pi's adapter waits 5 s for a file lock by default. The owner lock already excludes other processes.
  const db = await openNodeSqliteDatabase(path, { busyTimeoutMs: 0 })
  try {
    await db.exec('PRAGMA synchronous = FULL')
    await db.exec('PRAGMA fullfsync = ON')
    await db.exec('PRAGMA checkpoint_fullfsync = ON')
    if (!fresh) {
      const hasSchema = await db.get("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'durable_schema'")
      const version = hasSchema ? (await db.get<{ version: number }>('SELECT version FROM durable_schema WHERE singleton = 1'))?.version ?? 0 : 0
      if (version > CURRENT_SQLITE_SCHEMA_VERSION) {
        await db.close()
        return { _tag: 'unsupported', version }
      }
    }
    await db.exec('CREATE TABLE IF NOT EXISTS juno_incarnation (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), id TEXT NOT NULL) STRICT')
    await db.run('INSERT OR IGNORE INTO juno_incarnation (singleton, id) VALUES (1, ?)', incarnation)
    const recorded = (await db.get<{ id: string }>('SELECT id FROM juno_incarnation WHERE singleton = 1'))?.id ?? incarnation
    if (recorded !== incarnation) {
      await db.close()
      return { _tag: 'foreign', recorded }
    }
    const hasMetadata = await db.get("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'durable_metadata'")
    const nextSeq = hasMetadata ? Number((await db.get<{ next_seq: number }>('SELECT next_seq FROM durable_metadata WHERE singleton = 1'))?.next_seq ?? 1) : 1
    return {
      _tag: 'opened',
      file: { incarnation, path, lastCommitted: nextSeq - 1, start: (settings) => startJournal(db, incarnation, settings), close: () => db.close() },
    }
  } catch (error) {
    await db.close().catch(() => {})
    throw error
  }
}

/** Run policy (spikes S1, finding 2). Compaction is Juno's own; retries are the router's. */
const SETTINGS = {
  compaction: { enabled: false, backgroundTokens: 0 },
  retry: { maxRetries: 0 },
  progress: { partialIntervalMs: 250, outputIntervalMs: 250 },
} as const

export interface Journal {
  readonly incarnation: string
  /** Starts pi's scheduler: interrupted runs continue (spec `resume`). */
  readonly resume: () => void
  /** `next_seq - 1` now. */
  readonly lastCommitted: () => Promise<number>
  /** Starts a new context for the next run (spec `reset`). Only when the conversation is idle. */
  readonly reset: () => Promise<void>
  /**
   * Admits input with `requestId = opId` (spec `submit`). pi returns the existing submission for
   * an op it already has, so a resubmit after a crash adds nothing. `steer` joins the running run.
   */
  readonly submit: (input: { readonly opId: string; readonly text: string; readonly kind: string; readonly steer: boolean }) => Promise<string>
  /** The submission pi holds for `opId`, if it was admitted. */
  readonly submissionFor: (opId: string) => Promise<string | undefined>
  /** Resolves when the submission is answered or given up. */
  readonly wait: (submissionId: string) => Promise<Settled>
  /** Stops the current run: queued input is withdrawn and running work aborted. */
  readonly abort: () => Promise<void>
  /** The root conversation's commits after `seq` that added entries, oldest first. */
  readonly commitsAfter: (seq: number, limit: number) => Promise<ReadonlyArray<JournalCommit>>
  /** Called after each commit that changes the root conversation. */
  readonly onCommit: (listener: () => void) => () => void
  /** Stops pi. Running tasks get their abort signal; their state stays in the file. */
  readonly close: () => Promise<void>
}

/** The kind of the transcript entry an inbox op becomes. The projection reads it back. */
export const INPUT_ENTRY = 'juno.input'

async function startJournal(db: NodeSqliteDatabase, incarnation: string, settings: JournalSettings): Promise<Journal> {
  const storage = await SqliteStorage.open(db)
  // Juno's own index on pi's table, so projection reads commits in order without a scan.
  await db.exec('CREATE INDEX IF NOT EXISTS juno_entries_by_commit ON entries (conversation_id, commit_seq)')
  const registry = createRegistry()
  for (const extension of settings.extensions ?? []) registry.install(extension)
  const harness = await Harness.open(
    storage,
    { models: settings.models, registry, settings: SETTINGS, ...(settings.onReport ? { onReport: settings.onReport } : {}) },
    ctx,
  )
  const root: Root = await harness.root(ctx, { agent: { model: settings.model } })
  const listeners = new Set<() => void>()
  const view = await root.viewState(ctx)
  const unsubscribe = view.subscribe(() => {
    for (const listener of listeners) listener()
  })
  return {
    incarnation,
    resume: () => harness.resume(),
    lastCommitted: async () => Number((await db.get<{ next_seq: number }>('SELECT next_seq FROM durable_metadata WHERE singleton = 1'))?.next_seq ?? 1) - 1,
    reset: () => root.reset(undefined, ctx),
    submit: async ({ opId, text, kind, steer }) => {
      const submission = await root.submit(
        { type: 'input', content: text, requestId: opId, entry: { kind: INPUT_ENTRY, data: { opId, kind } }, ...(steer ? { whenBusy: 'steer' as const } : {}) },
        ctx,
      )
      return String(submission.id)
    },
    submissionFor: async (opId) => {
      const record = await storage.submissionByRequest(ROOT_CONVERSATION_ID, opId, ctx)
      return record === undefined ? undefined : String(record.id)
    },
    wait: async (submissionId) => {
      const submission = await harness.submission(Number(submissionId) as never, ctx)
      if (submission === undefined) return { status: 'unanswered', reason: 'missing' }
      const settled = await submission.wait(ctx)
      return settled.status === 'done' ? { status: 'done' } : { status: 'unanswered', reason: settled.reason }
    },
    abort: () => root.abort(ctx),
    commitsAfter: async (seq, limit) => {
      const rows = await db.all<{ id: number; commit_seq: number; record: string }>(
        `SELECT id, commit_seq, record FROM entries
         WHERE conversation_id = ?1 AND commit_seq IN (
           SELECT DISTINCT commit_seq FROM entries WHERE conversation_id = ?1 AND commit_seq > ?2 ORDER BY commit_seq LIMIT ?3)
         ORDER BY commit_seq, id`,
        ROOT_CONVERSATION_ID, seq, limit,
      )
      const commits: Array<{ seq: number; entries: JournalEntry[] }> = []
      for (const row of rows) {
        const record = JSON.parse(row.record) as { kind: string; data?: unknown; model?: unknown[] }
        const entry: JournalEntry = { id: Number(row.id), kind: record.kind, data: record.data, ...(record.model ? { model: record.model } : {}) }
        const last = commits.at(-1)
        if (last?.seq === Number(row.commit_seq)) last.entries.push(entry)
        else commits.push({ seq: Number(row.commit_seq), entries: [entry] })
      }
      return commits
    },
    onCommit: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    close: async () => {
      unsubscribe()
      view.dispose()
      listeners.clear()
      await harness.close(ctx)
    },
  }
}
