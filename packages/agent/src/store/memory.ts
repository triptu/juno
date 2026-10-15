/**
 * Memory persistence (plan v3 §4.1, §4.2; spec `agent-memory.qnt`). The
 * rules are `@juno/agent-memory`'s; this module reads their inputs from
 * `agent.sqlite` in one snapshot and commits their results.
 *
 * - `enqueue` (spec `project`): projecting message m queues every aligned
 *   key that ends at m + 1, in the projection's transaction.
 * - `readyKeys` (spec `start` guards): `readyQueue` over the queue rows.
 * - `beginJob` (spec `start`): snapshots the inputs, the raw context window
 *   and `gen`, and returns the input digest.
 * - `publish` (spec `publish`, `extend`, `merge`, `finishBatch`): in one
 *   transaction, checks that `gen` and the input digest are still current
 *   and the key is within the run cutoff, inserts the node, and advances the
 *   head from the revision it reads in that transaction. A stale job is
 *   discarded and its key stays queued.
 * - `failJob` (spec `failJob`): the key waits `retryDelay`.
 * - `redactMemory` and `purgeNodes` (spec `redact`, `purge`): the memory
 *   part of a removal and its purge, called by `redaction/` (WP16).
 *
 * The model calls are WP11's compactor; `runJob` is the seam it calls.
 */
import { createHash } from 'node:crypto'
import {
  batch, children, compactionTask, complete, context as contextWindow, limits, mask, readyQueue, retryDelay, start, taintClosure, withinCutoff,
  type Completion, type Input, type Key, type Line, type Node, type Ref, type Source,
} from '@juno/agent-memory'
import { transaction } from './database'
import type { Store } from './store'

/** The keys that end at message `id + 1` (spec `project`: `k.a + k.w == n + 1`). Call inside the projection's transaction. */
export function enqueue(store: Store, id: number): void {
  const insert = store.db.prepare('INSERT OR IGNORE INTO queue (a, w, due_at) VALUES (?, ?, ?)')
  for (let w = 1; w <= id + 1; w *= 2) {
    const a = id + 1 - w
    if (a % w === 0) insert.run(a, w, store.now())
  }
}

type MessageRow = { id: number; kind: Source['kind']; text: string; version: number; redacted_gen: number | null }
type NodeRow = { a: number; w: number; ver: number; text: string; cut: number; sources: string; inputs: string; context: string; deps: string }

const sourceOf = (row: MessageRow, removed: ReadonlySet<number>): Source => ({
  id: row.id, version: row.version, text: row.text, kind: row.kind, removed: row.redacted_gen !== null || removed.has(row.id),
})
const nodeOf = (row: NodeRow): Node => ({
  ref: { a: row.a, w: row.w, v: row.ver },
  text: row.text,
  cut: row.cut === 1,
  sources: JSON.parse(row.sources) as number[],
  inputs: (JSON.parse(row.inputs) as Array<[number, number, number]>).map(([a, w, v]) => ({ a, w, v })),
  context: JSON.parse(row.context) as number[],
  deps: new Set(JSON.parse(row.deps) as number[]),
})

function removedIds(store: Store): ReadonlySet<number> {
  return new Set((store.db.prepare('SELECT message_id AS id FROM redactions').all() as Array<{ id: number }>).map((row) => row.id))
}

/** The newest node for `key` that depends on no removed message (spec `current`). */
function currentNode(store: Store, key: Key, removed: ReadonlySet<number>): Node | undefined {
  const rows = store.db.prepare('SELECT * FROM nodes WHERE a = ? AND w = ? ORDER BY ver DESC').all(key.a, key.w) as unknown as NodeRow[]
  return rows.map(nodeOf).find((node) => ![...node.deps].some((id) => removed.has(id)))
}

function head(store: Store) {
  return store.db.prepare('SELECT rev, gen, pin_rev AS pinRev, batch FROM memory_head WHERE singleton = 1').get() as { rev: number; gen: number; pinRev: number; batch: number }
}

export interface MemoryView {
  readonly rev: number
  readonly gen: number
  readonly pinRev: number
  readonly covered: number
  readonly lines: ReadonlyArray<Line>
}

type Entry = { node: [number, number, number] } | { masked: [number, number] }

/** The published view (§4.2: restart loads it; it is never rebuilt from the log). */
export function view(store: Store): MemoryView {
  const h = head(store)
  const row = store.db.prepare('SELECT covered, entries FROM view_rev WHERE rev = ?').get(h.rev) as { covered: number; entries: string }
  const node = store.db.prepare('SELECT * FROM nodes WHERE a = ? AND w = ? AND ver = ?')
  const lines = (JSON.parse(row.entries) as Entry[]).map((entry): Line =>
    'node' in entry
      ? { kind: 'node', node: nodeOf(node.get(...entry.node) as unknown as NodeRow) }
      : { kind: 'masked', key: { a: entry.masked[0], w: entry.masked[1] } },
  )
  return { rev: h.rev, gen: h.gen, pinRev: h.pinRev, covered: row.covered, lines }
}

/** Keys a worker may start now (spec `start` guards, `readyQueue`). `active` are the keys already running. */
export function readyKeys(store: Store, options: { readonly now: number; readonly active: ReadonlyArray<Key>; readonly h: number | undefined }): ReadonlyArray<Key> {
  const rows = store.db.prepare('SELECT a, w, due_at AS dueAt FROM queue').all() as Array<{ a: number; w: number; dueAt: number }>
  const removed = removedIds(store)
  const built: Node[] = []
  for (const row of rows) {
    for (const child of children({ a: row.a, w: row.w }) ?? []) {
      const node = currentNode(store, child, removed)
      if (node) built.push(node)
    }
  }
  return readyQueue({ queue: rows.map((row) => ({ key: { a: row.a, w: row.w }, dueAt: row.dueAt })), active: options.active, built, now: options.now, h: options.h })
}

/** What a job read, for the publication check. */
export interface JobSnapshot {
  readonly ref: Ref
  readonly gen: number
  readonly digest: string
  readonly h: number | undefined
}

interface Inputs {
  readonly ref: Ref
  readonly input: Input
  readonly context: ReadonlyArray<Source>
  readonly digest: string
}

/** One consistent read of a key's inputs, or undefined while they are not all built. */
function readInputs(store: Store, key: Key, gen: number): Inputs | undefined {
  const removed = removedIds(store)
  const message = store.db.prepare('SELECT id, kind, text, version, redacted_gen FROM messages WHERE id = ?')
  const kids = children(key)
  let input: Input
  if (kids === undefined) {
    const row = message.get(key.a) as MessageRow | undefined
    if (row === undefined) return undefined
    input = { kind: 'leaf', source: sourceOf(row, removed) }
  } else {
    const left = currentNode(store, kids[0], removed)
    const right = currentNode(store, kids[1], removed)
    if (left === undefined || right === undefined) return undefined
    input = { kind: 'parent', children: [left, right] }
  }
  // The nearest 257 retained sources before the key always include the first that does not fit (agent-memory README).
  const before = (store.db.prepare('SELECT id, kind, text, version, redacted_gen FROM messages WHERE id < ? AND redacted_gen IS NULL ORDER BY id DESC LIMIT 257').all(key.a) as unknown as MessageRow[])
    .map((row) => sourceOf(row, removed))
    .filter((source) => !source.removed)
    .toReversed()
  const context = contextWindow(key, before)
  const maxVer = (store.db.prepare('SELECT max(ver) AS v FROM nodes WHERE a = ? AND w = ?').get(key.a, key.w) as { v: number | null }).v ?? 0
  const ref = { a: key.a, w: key.w, v: maxVer + 1 }
  const digest = createHash('sha256')
    .update(JSON.stringify({
      gen,
      ref,
      input: input.kind === 'leaf' ? [input.source.id, input.source.version, input.source.removed] : input.children.map((child) => [child.ref.a, child.ref.w, child.ref.v]),
      context: context.map((source) => [source.id, source.version]),
    }))
    .digest('hex')
  return { ref, input, context, digest }
}

/**
 * Snapshots a job's inputs (spec `start`) and makes its first step: a ready
 * node when the source is copied, or a compaction task for the model.
 * Undefined while the key's inputs are not built, or it has a current node.
 */
export function beginJob(store: Store, key: Key, h?: number): { readonly snapshot: JobSnapshot; readonly completion: Completion } | undefined {
  const { gen } = head(store)
  if (!withinCutoff(key, h) || currentNode(store, key, removedIds(store)) !== undefined) return undefined
  const inputs = readInputs(store, key, gen)
  if (inputs === undefined) return undefined
  return { snapshot: { ref: inputs.ref, gen, digest: inputs.digest, h }, completion: start(inputs.ref, inputs.input, inputs.context, h) }
}

/** Spec `fresh`: the job's inputs and `gen` are what it read, and the key has no current node. */
function isFresh(store: Store, snapshot: JobSnapshot): boolean {
  const { gen } = head(store)
  if (gen !== snapshot.gen || !withinCutoff(snapshot.ref, snapshot.h)) return false
  if (currentNode(store, snapshot.ref, removedIds(store)) !== undefined) return false
  return readInputs(store, snapshot.ref, gen)?.digest === snapshot.digest
}

export type Publication = 'published' | 'stale'

/** Spec `publish`. `meta` records which model and prompt built the node. */
export function publish(store: Store, snapshot: JobSnapshot, node: Node, meta: { readonly model?: string; readonly promptVer?: number } = {}): Publication {
  return transaction(store.db, (): Publication => {
    if (!isFresh(store, snapshot) || node.ref.a !== snapshot.ref.a || node.ref.w !== snapshot.ref.w || node.ref.v !== snapshot.ref.v) return 'stale'
    const { db, now } = store
    db.prepare(
      'INSERT INTO nodes (a, w, ver, text, bytes, cut, sources, inputs, context, deps, input_digest, model, prompt_ver, gen, built_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      node.ref.a, node.ref.w, node.ref.v, node.text, Buffer.byteLength(node.text, 'utf8'), node.cut ? 1 : 0,
      JSON.stringify(node.sources), JSON.stringify(node.inputs.map((r) => [r.a, r.w, r.v])), JSON.stringify(node.context), JSON.stringify([...node.deps]),
      snapshot.digest, meta.model ?? null, meta.promptVer ?? null, snapshot.gen, now(),
    )
    db.prepare('DELETE FROM queue WHERE a = ? AND w = ?').run(node.ref.a, node.ref.w)
    advanceView(store, snapshot.h)
    return 'published'
  })
}

/**
 * Brings the head up to date with the nodes (spec `publish` replace and
 * extend, `extend`, `merge`, `finishBatch`), reading the head inside the
 * caller's transaction, so its revision is the one it advances from.
 */
function advanceView(store: Store, h: number | undefined): void {
  const current = view(store)
  const removed = removedIds(store)
  let changed = false
  // A masked line whose key now has a clean node shows it again.
  let lines: Line[] = current.lines.map((line) => {
    if (line.kind !== 'masked') return line
    const node = currentNode(store, line.key, removed)
    if (node === undefined) return line
    changed = true
    return { kind: 'node', node }
  })
  // A built leaf becomes visible once the prefix reaches it, never past the run cutoff.
  let covered = current.covered
  for (;;) {
    if (h !== undefined && covered >= h) break
    const leaf = currentNode(store, { a: covered, w: 1 }, removed)
    if (leaf === undefined) break
    lines.push({ kind: 'node', node: leaf })
    covered += 1
    changed = true
  }
  const n = (store.db.prepare('SELECT count(*) AS n FROM messages').get() as { n: number }).n
  const parents: Node[] = []
  for (let i = 0; i + 1 < lines.length; i++) {
    const left = lines[i]!
    if (left.kind !== 'node') continue
    const parent = currentNode(store, { a: left.node.ref.a, w: left.node.ref.w * 2 }, removed)
    if (parent) parents.push(parent)
  }
  const batched = batch(lines, parents, Math.max(n, covered), head(store).batch === 1)
  if (batched.lines !== lines) {
    lines = [...batched.lines]
    changed = true
  }
  store.db.prepare('UPDATE memory_head SET batch = ? WHERE singleton = 1').run(batched.pending ? 1 : 0)
  if (!changed) return
  const rev = current.rev + 1
  const entries: Entry[] = lines.map((line) => (line.kind === 'node' ? { node: [line.node.ref.a, line.node.ref.w, line.node.ref.v] } : { masked: [line.key.a, line.key.w] }))
  store.db.prepare('INSERT INTO view_rev (rev, gen, covered, entries) VALUES (?, ?, ?, ?)').run(rev, current.gen, covered, JSON.stringify(entries))
  const advanced = store.db.prepare('UPDATE memory_head SET rev = ? WHERE singleton = 1 AND rev = ?').run(rev, current.rev)
  if (advanced.changes !== 1) throw new Error('memory head moved inside its own transaction')
}

/**
 * Spec `redact`, the memory part, inside the removal's transaction (plan v3
 * §4.5 step 1): tombstones the messages (their text is gone, the ids stay),
 * records them in `redactions` at `gen + 1`, masks every view line whose node
 * depends on a removed message through its recorded inputs (`taintClosure`),
 * writes that view at `rev + 1` with the new `gen`, and queues a rebuild of
 * each tainted key that has no clean node left. A job that read the old
 * generation is discarded at publication. Messages already removed are
 * skipped; with none left, nothing changes.
 */
export function redactMemory(store: Store, ids: ReadonlyArray<number>): { readonly gen: number; readonly removed: ReadonlyArray<number>; readonly masked: number } {
  if (!store.db.isTransaction) throw new Error('redactMemory runs inside the removal transaction')
  const before = head(store)
  const known = removedIds(store)
  const fresh = [...new Set(ids)].filter((id) => !known.has(id)).sort((a, b) => a - b)
  if (fresh.length === 0) return { gen: before.gen, removed: [], masked: 0 }
  const gen = before.gen + 1
  const { db, now } = store
  const tombstone = db.prepare("UPDATE messages SET text = '', bytes = 0, redacted_gen = ? WHERE id = ?")
  const record = db.prepare('INSERT INTO redactions (message_id, gen, at) VALUES (?, ?, ?)')
  for (const id of fresh) {
    tombstone.run(gen, id)
    record.run(id, gen, now())
  }
  const removed = new Set([...known, ...fresh])
  const current = view(store)
  const lines = mask(current.lines, removed)
  const masked = lines.filter((line, i) => line !== current.lines[i]).length
  const entries: Entry[] = lines.map((line) => (line.kind === 'node' ? { node: [line.node.ref.a, line.node.ref.w, line.node.ref.v] } : { masked: [line.key.a, line.key.w] }))
  const rev = current.rev + 1
  db.prepare('INSERT INTO view_rev (rev, gen, covered, entries) VALUES (?, ?, ?, ?)').run(rev, gen, current.covered, JSON.stringify(entries))
  const advanced = db.prepare('UPDATE memory_head SET rev = ?, gen = ? WHERE singleton = 1 AND rev = ?').run(rev, gen, current.rev)
  if (advanced.changes !== 1) throw new Error('memory head moved inside the removal transaction')
  const all = (db.prepare('SELECT * FROM nodes').all() as unknown as NodeRow[]).map(nodeOf)
  const queue = db.prepare('INSERT OR IGNORE INTO queue (a, w, due_at) VALUES (?, ?, ?)')
  for (const node of taintClosure(all, removed)) {
    if (currentNode(store, node.ref, removed) === undefined) queue.run(node.ref.a, node.ref.w, now())
  }
  return { gen, removed: fresh, masked }
}

/**
 * Spec `purge`: deletes node versions that depend on a removed message. The
 * view masks every one of them since the removal, so none is in use. The
 * tombstones stay. Idempotent; returns how many versions it deleted.
 */
export function purgeNodes(store: Store): number {
  return transaction(store.db, () => {
    const removed = removedIds(store)
    const all = (store.db.prepare('SELECT * FROM nodes').all() as unknown as NodeRow[]).map(nodeOf)
    const drop = store.db.prepare('DELETE FROM nodes WHERE a = ? AND w = ? AND ver = ?')
    let deleted = 0
    for (const node of taintClosure(all, removed)) deleted += Number(drop.run(node.ref.a, node.ref.w, node.ref.v).changes)
    return deleted
  })
}

/** Spec `failJob`: the key waits 30 s, 2 min, 10 min, then hourly. */
export function failJob(store: Store, key: Key, error: unknown): void {
  transaction(store.db, () => {
    const row = store.db.prepare('SELECT attempts FROM queue WHERE a = ? AND w = ?').get(key.a, key.w) as { attempts: number } | undefined
    if (row === undefined) return
    const attempts = row.attempts + 1
    store.db
      .prepare('UPDATE queue SET attempts = ?, due_at = ?, last_error = ? WHERE a = ? AND w = ?')
      .run(attempts, store.now() + retryDelay(attempts), String((error as Error)?.message ?? error), key.a, key.w)
  })
}

/** The compaction model, as WP11's compactor provides it. One call answers one task; it may fail. */
export interface CompactionModel {
  readonly id: string
  readonly summarize: (task: ReadonlyArray<string>) => Promise<string>
}

/** The prompt version stored with each node; bump it when `compactionTask` changes. */
export const PROMPT_VERSION = 1

/**
 * One job from start to publication. Each retry is a fresh bounded task and
 * runs only while the inputs are still current (spec `complete`). The
 * caller runs at most `limits.workers` at once.
 */
export async function runJob(store: Store, key: Key, model: CompactionModel, h?: number): Promise<Publication | 'failed' | 'unavailable'> {
  const begun = beginJob(store, key, h)
  if (begun === undefined) return 'unavailable'
  let completion = begun.completion
  try {
    while (completion.kind === 'retry') {
      if (completion.state.attempts > 0 && !isFresh(store, begun.snapshot)) return 'stale'
      completion = complete(completion.state, await model.summarize(compactionTask(completion.state)))
    }
  } catch (error) {
    failJob(store, key, error)
    return 'failed'
  }
  return publish(store, begun.snapshot, completion.node, { model: model.id, promptVer: PROMPT_VERSION })
}

export { limits as memoryLimits }
