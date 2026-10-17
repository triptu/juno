/**
 * Juno's memory of the owner on the trusted side (SPEC 13.8). The rules are
 * `@juno/agent-memory`'s (`checkEntry`, `outline`); this module reads their
 * inputs and commits their results, each change in one transaction that
 * also moves `memory_docs_state.rev`.
 *
 * Memory is context, never authority: nothing here is read by the policy,
 * the grants, the auto-review or the owner's rules (`check-deps` keeps
 * those folders from importing this one).
 *
 * - `writeEntry`: Juno's `memory_write` and the learning pass. The write's
 *   id is derived from the call, so a replayed call finds its write.
 * - `undoRun`: the chat note's Undo: every write of one run or pass, newest
 *   first, each only while its entry is as the write left it.
 * - `ownerAdd`, `ownerEdit`, `ownerDelete`: the owner on the memory page.
 *   An edit makes the entry the owner's words. A delete clears the entry's
 *   text and every earlier text of it.
 * - `forgetRuns`: a removal (WP16) takes what runs started by the removed
 *   messages wrote.
 */
import { checkEntry, isDoc, outline, type Doc, type DocEntry, type EntryRefusal } from '@juno/agent-memory'
import { transaction } from '../store/database'
import type { Store } from '../store/store'

export type SourceKind = 'owner' | 'slack' | 'connection'

export interface Entry {
  readonly id: number
  readonly doc: Doc
  readonly text: string
  readonly source: SourceKind
  /** The connection's name, for `connection`. */
  readonly connection: string | null
  /** Written in a run that had read outside content. */
  readonly tainted: boolean
  readonly version: number
  readonly createdAt: number
  readonly updatedAt: number
}

export interface Write {
  readonly id: string
  /** The chat run, `learn:<ask id>`, or null for the owner's own change. */
  readonly runId: string | null
  readonly entryId: number
  readonly doc: Doc
  readonly kind: 'add' | 'update' | 'remove'
  readonly by: 'juno' | 'owner'
  readonly before: string | null
  readonly after: string | null
  readonly source: SourceKind
  readonly connection: string | null
  readonly tainted: boolean
  readonly at: number
  readonly undone: boolean
}

export type WriteResult =
  | { readonly _tag: 'written'; readonly write: Write; readonly entry: Entry }
  /** `unknownEntry`: no active entry with that id. `stale`: it changed since the page read it. */
  | { readonly _tag: 'refused'; readonly reason: EntryRefusal | 'unknownEntry' | 'stale' }

type EntryRow = { id: number; doc: Doc; text: string; source: SourceKind; connection: string | null; tainted: number; version: number; active: number; created_at: number; updated_at: number }
type WriteRow = { id: string; run_id: string | null; entry_id: number; doc: Doc; kind: Write['kind']; by: Write['by']; before_text: string | null; after_text: string | null; before_version: number | null; after_version: number; source: SourceKind; connection: string | null; tainted: number; at: number; undone_at: number | null }

const entryOf = (row: EntryRow): Entry => ({
  id: row.id, doc: row.doc, text: row.text, source: row.source, connection: row.connection, tainted: row.tainted === 1,
  version: row.version, createdAt: row.created_at, updatedAt: row.updated_at,
})
const writeOf = (row: WriteRow): Write => ({
  id: row.id, runId: row.run_id, entryId: row.entry_id, doc: row.doc, kind: row.kind, by: row.by, before: row.before_text, after: row.after_text,
  source: row.source, connection: row.connection, tainted: row.tainted === 1, at: row.at, undone: row.undone_at !== null,
})

/** The active entries, oldest first. */
export function entries(store: Store): ReadonlyArray<Entry> {
  return (store.db.prepare('SELECT * FROM memory_entries WHERE active = 1 ORDER BY id').all() as unknown as EntryRow[]).map(entryOf)
}

/** The entries as the rules and the model name them: `e12`. */
export const docEntries = (all: ReadonlyArray<Entry>): ReadonlyArray<DocEntry> => all.map((entry) => ({ id: `e${entry.id}`, doc: entry.doc, text: entry.text }))

/** `e12` or `12` to 12. */
export function entryId(name: string): number | undefined {
  const match = /^e?(\d+)$/.exec(name.trim())
  return match === null ? undefined : Number(match[1])
}

export function rev(store: Store): number {
  return (store.db.prepare('SELECT rev FROM memory_docs_state WHERE singleton = 1').get() as { rev: number } | undefined)?.rev ?? 0
}

/** The outline as a request carries it now. */
export function outlineNow(store: Store): string {
  return outline(docEntries(entries(store)), rev(store))
}

function bump(store: Store): void {
  store.db.prepare('INSERT INTO memory_docs_state (singleton, rev) VALUES (1, 1) ON CONFLICT (singleton) DO UPDATE SET rev = rev + 1').run()
}

function activeEntry(store: Store, id: number): Entry | undefined {
  const row = store.db.prepare('SELECT * FROM memory_entries WHERE id = ? AND active = 1').get(id) as EntryRow | undefined
  return row === undefined ? undefined : entryOf(row)
}

function writeRow(store: Store, id: string): Write | undefined {
  const row = store.db.prepare('SELECT * FROM memory_writes WHERE id = ?').get(id) as WriteRow | undefined
  return row === undefined ? undefined : writeOf(row)
}

export interface WriteInput {
  /** Derived from the call: the same call writes once. */
  readonly id: string
  readonly runId: string | null
  readonly by: 'juno' | 'owner'
  /** An entry to change or remove; none adds one. */
  readonly entry?: number
  readonly doc?: Doc
  readonly text?: string
  readonly remove?: boolean
  readonly source: SourceKind
  readonly connection?: string
  readonly tainted: boolean
  /** The owner's edit names the version the page showed. */
  readonly expected?: number
}

/** Adds, changes or removes one entry, and records the write. */
export function writeEntry(store: Store, input: WriteInput): WriteResult {
  const { db, now } = store
  return transaction(db, (): WriteResult => {
    const done = writeRow(store, input.id)
    if (done !== undefined) {
      const entry = db.prepare('SELECT * FROM memory_entries WHERE id = ?').get(done.entryId) as EntryRow
      return { _tag: 'written', write: done, entry: entryOf(entry) }
    }
    const all = entries(store)
    const at = now()
    const connection = input.source === 'connection' ? (input.connection ?? null) : null
    const tainted = input.tainted ? 1 : 0
    const record = (target: number, doc: Doc, kind: Write['kind'], before: Entry | undefined, after: { text: string; version: number }) => {
      db.prepare(
        `INSERT INTO memory_writes (id, run_id, entry_id, doc, kind, by, before_text, after_text, before_version, after_version, source, connection, tainted, at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(input.id, input.runId, target, doc, kind, input.by, before?.text ?? null, kind === 'remove' ? null : after.text, before?.version ?? null, after.version, input.source, connection, tainted, at)
      bump(store)
      return { _tag: 'written' as const, write: writeRow(store, input.id)!, entry: entryOf(db.prepare('SELECT * FROM memory_entries WHERE id = ?').get(target) as EntryRow) }
    }

    if (input.entry === undefined) {
      const doc = input.doc
      if (doc === undefined || !isDoc(doc)) return { _tag: 'refused', reason: 'unknownEntry' }
      const text = (input.text ?? '').trim()
      const refusal = checkEntry(doc, text, docEntries(all))
      if (refusal !== undefined) return { _tag: 'refused', reason: refusal }
      const id = Number(
        db.prepare('INSERT INTO memory_entries (doc, text, source, connection, tainted, version, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?)')
          .run(doc, text, input.source, connection, tainted, at, at).lastInsertRowid,
      )
      return record(id, doc, 'add', undefined, { text, version: 1 })
    }

    const before = activeEntry(store, input.entry)
    if (before === undefined) return { _tag: 'refused', reason: 'unknownEntry' }
    if (input.expected !== undefined && input.expected !== before.version) return { _tag: 'refused', reason: 'stale' }
    const version = before.version + 1
    if (input.remove === true) {
      db.prepare('UPDATE memory_entries SET active = 0, version = ?, updated_at = ? WHERE id = ?').run(version, at, before.id)
      return record(before.id, before.doc, 'remove', before, { text: before.text, version })
    }
    const doc = input.doc !== undefined && isDoc(input.doc) ? input.doc : before.doc
    const text = (input.text ?? '').trim()
    const refusal = checkEntry(doc, text, docEntries(all.filter((entry) => entry.id !== before.id)))
    if (refusal !== undefined) return { _tag: 'refused', reason: refusal }
    db.prepare('UPDATE memory_entries SET doc = ?, text = ?, source = ?, connection = ?, tainted = ?, version = ?, updated_at = ? WHERE id = ?')
      .run(doc, text, input.source, connection, tainted, version, at, before.id)
    return record(before.id, doc, 'update', before, { text, version })
  })
}

/**
 * The note's Undo: puts back every write of `runId` not undone yet, newest
 * first, while its entry is as the write left it. Answers how many it put back.
 */
export function undoRun(store: Store, runId: string): number {
  const { db, now } = store
  return transaction(db, () => {
    const writes = db.prepare('SELECT * FROM memory_writes WHERE run_id = ? AND undone_at IS NULL ORDER BY at DESC, rowid DESC').all(runId) as unknown as WriteRow[]
    let undone = 0
    for (const row of writes) {
      const entry = db.prepare('SELECT * FROM memory_entries WHERE id = ?').get(row.entry_id) as EntryRow | undefined
      if (entry === undefined || entry.version !== row.after_version) continue
      const version = entry.version + 1
      if (row.kind === 'add') db.prepare('UPDATE memory_entries SET active = 0, text = ?, version = ?, updated_at = ? WHERE id = ?').run('', version, now(), entry.id)
      else db.prepare('UPDATE memory_entries SET active = 1, text = ?, version = ?, updated_at = ? WHERE id = ?').run(row.before_text ?? '', version, now(), entry.id)
      db.prepare('UPDATE memory_writes SET undone_at = ? WHERE id = ?').run(now(), row.id)
      undone += 1
    }
    if (undone > 0) bump(store)
    return undone
  })
}

/** The owner adds an entry on the memory page: their own words. */
export const ownerAdd = (store: Store, input: { readonly opId: string; readonly doc: Doc; readonly text: string }): WriteResult =>
  writeEntry(store, { id: `owner:${input.opId}`, runId: null, by: 'owner', doc: input.doc, text: input.text, source: 'owner', tainted: false })

/** The owner edits an entry: it becomes their words. */
export const ownerEdit = (store: Store, input: { readonly opId: string; readonly entry: number; readonly version: number; readonly text: string }): WriteResult =>
  writeEntry(store, { id: `owner:${input.opId}`, runId: null, by: 'owner', entry: input.entry, expected: input.version, text: input.text, source: 'owner', tainted: false })

/**
 * The owner deletes an entry: it goes, and so does every text it had,
 * in the entry and in its writes. Nothing can bring it back.
 */
export function ownerDelete(store: Store, input: { readonly entry: number; readonly version: number }): WriteResult {
  const { db, now } = store
  return transaction(db, (): WriteResult => {
    const before = activeEntry(store, input.entry)
    if (before === undefined) return { _tag: 'refused', reason: 'unknownEntry' }
    if (before.version !== input.version) return { _tag: 'refused', reason: 'stale' }
    forget(store, before.id)
    bump(store)
    const entry = entryOf(db.prepare('SELECT * FROM memory_entries WHERE id = ?').get(before.id) as EntryRow)
    const write: Write = { id: `delete:${before.id}`, runId: null, entryId: before.id, doc: before.doc, kind: 'remove', by: 'owner', before: null, after: null, source: 'owner', connection: null, tainted: false, at: now(), undone: false }
    return { _tag: 'written', write, entry }
  })
}

function forget(store: Store, id: number): void {
  const { db, now } = store
  db.prepare("UPDATE memory_entries SET active = 0, text = '', version = version + 1, updated_at = ? WHERE id = ?").run(now(), id)
  db.prepare('UPDATE memory_writes SET before_text = NULL, after_text = NULL WHERE entry_id = ?').run(id)
}

/**
 * Inside a removal's transaction: what runs started by the removed messages
 * wrote goes. An entry such a run added goes with all its texts; an entry it
 * changed goes back to its earlier text while nothing changed it since. The
 * writes keep no text.
 */
export function forgetRuns(store: Store, runIds: ReadonlyArray<string>): void {
  if (runIds.length === 0) return
  const { db, now } = store
  const writes = db.prepare(`SELECT * FROM memory_writes WHERE run_id IN (${runIds.map(() => '?').join(', ')}) ORDER BY at DESC, rowid DESC`).all(...runIds) as unknown as WriteRow[]
  for (const row of writes) {
    const entry = db.prepare('SELECT * FROM memory_entries WHERE id = ?').get(row.entry_id) as EntryRow | undefined
    if (entry === undefined) continue
    if (row.kind === 'add') forget(store, entry.id)
    else if (entry.version === row.after_version && row.kind === 'update') {
      db.prepare('UPDATE memory_entries SET text = ?, version = version + 1, updated_at = ? WHERE id = ?').run(row.before_text ?? '', now(), entry.id)
    }
    db.prepare('UPDATE memory_writes SET before_text = NULL, after_text = NULL, undone_at = coalesce(undone_at, ?) WHERE id = ?').run(now(), row.id)
  }
  if (writes.length > 0) bump(store)
}

/** The newest writes, newest first, for the memory page. */
export function recentWrites(store: Store, limit = 30): ReadonlyArray<Write> {
  return (store.db.prepare('SELECT * FROM memory_writes ORDER BY at DESC, rowid DESC LIMIT ?').all(limit) as unknown as WriteRow[]).map(writeOf)
}

/** One run's or pass's writes, for its chat note: the docs it touched, when, and whether any can still be undone. */
export interface RunWrites {
  readonly runId: string
  readonly docs: ReadonlyArray<Doc>
  readonly firstAt: number
  readonly lastAt: number
  readonly undoable: boolean
  readonly undone: boolean
}

export function runWrites(store: Store): ReadonlyArray<RunWrites> {
  const rows = store.db
    .prepare("SELECT run_id AS runId, doc, at, undone_at AS undoneAt FROM memory_writes WHERE run_id IS NOT NULL AND by = 'juno' ORDER BY at, rowid")
    .all() as Array<{ runId: string; doc: Doc; at: number; undoneAt: number | null }>
  const byRun = new Map<string, Array<(typeof rows)[number]>>()
  for (const row of rows) byRun.set(row.runId, [...(byRun.get(row.runId) ?? []), row])
  return [...byRun.entries()].map(([runId, writes]) => ({
    runId,
    docs: [...new Set(writes.map((write) => write.doc))],
    firstAt: writes[0]!.at,
    lastAt: writes.at(-1)!.at,
    undoable: writes.some((write) => write.undoneAt === null),
    undone: writes.every((write) => write.undoneAt !== null),
  }))
}
