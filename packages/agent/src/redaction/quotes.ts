/**
 * Quotes of removed messages (plan v3 §4.5; SPEC 13.8). A reply or a
 * reaction carries the item it answers in full, as a `<quote>` element in
 * its own archived text (`router/input.ts`). When that item is removed, the
 * quote becomes the same placeholder a quote of a missing item gets,
 * `<quote from="…" removed="true"></quote>`, in the archive the model reads.
 * The quoting message keeps its own words; its version moves, so summaries
 * and pins built from the old text are rebuilt or moved.
 *
 * Runs inside the removal's transaction, before the messages are
 * tombstoned: it needs their text to know which bubbles and words they were.
 */
import type { ReplyTarget } from '@juno/agent-contract'
import { chunks } from '../projection/render'
import { parseOutput } from '../router/output'
import type { Store } from '../store/store'

const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(', ')

type Row = { readonly id: number; readonly text: string; readonly entry: string; readonly opId: string | null }

/** Rows grouped into pi entries, in archive order. */
function entries(rows: ReadonlyArray<Row>): ReadonlyArray<ReadonlyArray<Row>> {
  const out: Row[][] = []
  for (const row of rows) {
    const last = out.at(-1)
    if (last !== undefined && last[0]!.entry === row.entry) last.push(row)
    else out.push([row])
  }
  return out
}

/**
 * The Juno bubbles, `<runId>:<n>`, whose text is in the removed messages,
 * with that text. A bubble is numbered across its run's entries, as the
 * router and the chat number them.
 */
export function removedBubbles(store: Store, removed: ReadonlySet<number>): ReadonlyMap<string, string> {
  if (removed.size === 0) return new Map()
  const ids = [...removed]
  const runs = store.db
    .prepare(`SELECT DISTINCT run_inputs.run_id AS runId FROM messages JOIN run_inputs ON run_inputs.op_id = messages.origin_op WHERE messages.kind = 'juno' AND messages.id IN (${placeholders(ids.length)})`)
    .all(...ids) as Array<{ runId: string }>
  const found = new Map<string, string>()
  for (const { runId } of runs) {
    const rows = store.db
      .prepare(
        `SELECT id, text, incarnation || '/' || entry_id AS entry, origin_op AS opId FROM messages
         WHERE kind = 'juno' AND redacted_gen IS NULL AND origin_op IN (SELECT op_id FROM run_inputs WHERE run_id = ?) ORDER BY id`,
      )
      .all(runId) as unknown as Row[]
    let n = 0
    for (const entry of entries(rows)) {
      const bubbles = parseOutput(entry.map((row) => row.text).join('')).bubbles
      const gone = entry.every((row) => removed.has(row.id))
      for (const bubble of bubbles) {
        if (gone) found.set(`${runId}:${n}`, bubble.text)
        n += 1
      }
    }
  }
  return found
}

/** What a removal takes, as the quotes name it: owner ops with their words, and bubbles with their text. */
export interface Quoted {
  readonly ops: ReadonlyMap<string, string>
  readonly bubbles: ReadonlyMap<string, string>
}

function quotedTarget(data: string | null): ReplyTarget | undefined {
  if (data === null) return undefined
  const parsed = JSON.parse(data) as { replyTo?: ReplyTarget; target?: ReplyTarget }
  return parsed.replyTo ?? parsed.target
}

/**
 * Replaces each quote of a removed item in later inputs' archived text with
 * the placeholder. Returns the archive ids whose text changed; their version
 * moved by one.
 */
export function clearQuotes(store: Store, quoted: Quoted, removed: ReadonlySet<number>): ReadonlyArray<number> {
  const ops = store.db.prepare('SELECT op_id AS opId, data FROM inbox WHERE data IS NOT NULL').all() as Array<{ opId: string; data: string }>
  const rows = store.db.prepare(
    `SELECT id, text, incarnation || '/' || entry_id AS entry, origin_op AS opId FROM messages
     WHERE origin_op = ? AND kind IN ('user', 'card', 'wake', 'work') AND redacted_gen IS NULL ORDER BY id`,
  )
  const update = store.db.prepare('UPDATE messages SET text = ?, bytes = ?, version = version + 1 WHERE id = ?')
  const changed: number[] = []
  for (const op of ops) {
    const target = quotedTarget(op.data)
    if (target === undefined) continue
    const quote =
      target._tag === 'owner' && quoted.ops.has(target.opId) ? { from: 'owner', text: quoted.ops.get(target.opId)! }
      : target._tag === 'bubble' && quoted.bubbles.has(target.id) ? { from: 'juno', text: quoted.bubbles.get(target.id)! }
      : undefined
    if (quote === undefined) continue
    const exact = `<quote from="${quote.from}">${quote.text}</quote>`
    for (const entry of entries(rows.all(op.opId) as unknown as Row[])) {
      if (entry.some((row) => removed.has(row.id))) continue
      const text = entry.map((row) => row.text).join('')
      if (!text.includes(exact)) continue
      const parts = chunks(text.replace(exact, `<quote from="${quote.from}" removed="true"></quote>`))
      entry.forEach((row, i) => {
        const next = parts[i] ?? ''
        update.run(next, Buffer.byteLength(next, 'utf8'), row.id)
        changed.push(row.id)
      })
    }
  }
  return changed
}

/**
 * Pins whose source text moved: each finds its exact text again and takes
 * the new version, or is deactivated when the text is gone. Returns whether
 * any pin changed.
 */
export function movePins(store: Store, rewritten: ReadonlyArray<number>): boolean {
  if (rewritten.length === 0) return false
  const pins = store.db
    .prepare(`SELECT id, version, source_id AS sourceId, text FROM pins WHERE active = 1 AND source_id IN (${placeholders(rewritten.length)})`)
    .all(...rewritten) as Array<{ id: string; version: number; sourceId: number; text: string }>
  for (const pin of pins) {
    const row = store.db.prepare('SELECT text, version FROM messages WHERE id = ?').get(pin.sourceId) as { text: string; version: number }
    const at = row.text.indexOf(pin.text)
    if (at < 0) {
      store.db.prepare('UPDATE pins SET active = 0 WHERE id = ? AND version = ?').run(pin.id, pin.version)
      continue
    }
    const from = Buffer.byteLength(row.text.slice(0, at), 'utf8')
    store.db
      .prepare('UPDATE pins SET source_version = ?, from_byte = CASE WHEN from_byte IS NULL THEN NULL ELSE ? END, to_byte = CASE WHEN to_byte IS NULL THEN NULL ELSE ? END WHERE id = ? AND version = ?')
      .run(row.version, from, from + Buffer.byteLength(pin.text, 'utf8'), pin.id, pin.version)
  }
  return pins.length > 0
}
