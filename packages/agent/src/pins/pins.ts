/**
 * Pins on the trusted side (plan v3 §4.4, G3; spec `agent-memory.qnt`
 * `pinWith`, `editPin`). The rules are `@juno/agent-memory`'s; this module
 * reads their inputs and commits their results.
 *
 * Every change runs in one write transaction: it reads the active pins and
 * `memory_head.pin_rev`, computes the change, writes the pin rows and bumps
 * `pin_rev`. So the version and source checks, the 4 KB budget and the
 * revision bump are one atomic step, and a request built before the change
 * is refused at the guard (`dispatchWith`).
 *
 * - `rememberQuote`: the `remember` tool. The source is found among the
 *   owner messages admitted in this run (`[h, cutoff)`), never named by the
 *   model, and the text is copied from the stored bytes.
 * - `pinMessage`: "Remember this" on an owner message, an owner action. Any
 *   owner message, the whole message or a byte range, at most 280 bytes.
 * - `editPin`: an owner edit on "What Juno remembers". It names the version
 *   it replaces; a newer version or a removed source refuses it.
 * - `undoPin`: "Undo" and removal, with the same version check.
 */
import {
  deactivatePin, editPin as editRule, remember, utf8Bytes,
  type Pin, type PinChange, type Pins, type Source,
} from '@juno/agent-memory'
import { transaction } from '../store/database'
import type { Store } from '../store/store'

export type PinResult =
  | { readonly _tag: 'changed'; readonly pin: Pin; readonly revision: number }
  /**
   * `source`: no such owner message (or it was removed). `span`: the text is
   * not in it, splits a character or is over 280 bytes. `conflict`: the pin
   * changed since it was read. `budget`: active pins would pass 4 KB.
   */
  | { readonly _tag: 'refused'; readonly reason: 'source' | 'span' | 'conflict' | 'budget' }

type PinRow = {
  id: string; version: number; kind: 'span' | 'owner'; source_id: number; source_version: number
  from_byte: number | null; to_byte: number | null; text: string; supersedes: number | null
}
type MessageRow = { id: number; kind: Source['kind']; text: string; version: number; redacted_gen: number | null }

const pinOf = (row: PinRow): Pin =>
  row.kind === 'span'
    ? { kind: 'span', id: row.id, version: row.version, sourceId: row.source_id, sourceVersion: row.source_version, text: row.text, from: row.from_byte ?? 0, to: row.to_byte ?? 0 }
    : { kind: 'owner', id: row.id, version: row.version, sourceId: row.source_id, sourceVersion: row.source_version, text: row.text, supersedes: row.supersedes ?? 0 }

/** The active pins and their revision, oldest first. */
export function activePins(store: Store): Pins {
  const head = store.db.prepare('SELECT pin_rev AS rev FROM memory_head WHERE singleton = 1').get() as { rev: number }
  const rows = store.db.prepare('SELECT * FROM pins WHERE active = 1 ORDER BY at, id').all() as unknown as PinRow[]
  return { revision: head.rev, active: rows.map(pinOf) }
}

function source(store: Store, id: number): Source | undefined {
  const row = store.db.prepare('SELECT id, kind, text, version, redacted_gen FROM messages WHERE id = ?').get(id) as MessageRow | undefined
  if (row === undefined) return undefined
  const redacted = store.db.prepare('SELECT 1 FROM redactions WHERE message_id = ?').get(id) !== undefined
  return { id: row.id, kind: row.kind, text: row.text, version: row.version, removed: row.redacted_gen !== null || redacted }
}

const has = (pins: Pins, pin: Pin) => pins.active.some((p) => p.id === pin.id && p.version === pin.version)

/** Applies one pin change computed from the pins read in the same transaction. */
function commit(store: Store, change: (pins: Pins) => PinChange, changed: (pins: Pins) => Pin | undefined): PinResult {
  return transaction(store.db, (): PinResult => {
    const before = activePins(store)
    const result = change(before)
    if (result.kind === 'refused') return { _tag: 'refused', reason: result.reason }
    const after = result.pins
    for (const pin of before.active) {
      if (!has(after, pin)) store.db.prepare('UPDATE pins SET active = 0 WHERE id = ? AND version = ?').run(pin.id, pin.version)
    }
    for (const pin of after.active) {
      if (has(before, pin)) continue
      store.db
        .prepare(
          'INSERT INTO pins (id, version, kind, source_id, source_version, from_byte, to_byte, text, active, supersedes, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
        )
        .run(
          pin.id, pin.version, pin.kind, pin.sourceId, pin.sourceVersion,
          pin.kind === 'span' ? pin.from : null, pin.kind === 'span' ? pin.to : null, pin.text,
          pin.kind === 'owner' ? pin.supersedes : null, store.now(),
        )
    }
    const bumped = store.db.prepare('UPDATE memory_head SET pin_rev = ? WHERE singleton = 1 AND pin_rev = ?').run(after.revision, before.revision)
    if (bumped.changes !== 1) throw new Error('pin revision moved inside its own transaction')
    const pin = changed(after) ?? changed(before)
    if (pin === undefined) throw new Error('a pin change lost its pin')
    return { _tag: 'changed', pin, revision: after.revision }
  })
}

/** The first version of pin `id`, if it was ever written. */
function written(store: Store, id: string): Pin | undefined {
  const row = store.db.prepare('SELECT * FROM pins WHERE id = ? ORDER BY version LIMIT 1').get(id) as PinRow | undefined
  return row === undefined ? undefined : pinOf(row)
}

/** Byte offsets of the first occurrence of `quote` in `text`, if any. */
function find(text: string, quote: string): { readonly from: number; readonly to: number } | undefined {
  if (quote === '') return undefined
  const bytes = Buffer.from(text, 'utf8')
  const needle = Buffer.from(quote, 'utf8')
  const from = bytes.indexOf(needle)
  return from < 0 ? undefined : { from, to: from + needle.length }
}

/**
 * The `remember` tool (§4.4, Tier 1). `quote` must be exact words from an
 * owner message admitted in this run, `[h, cutoff)`; the newest one that
 * holds it is the source. `id` is stable for the tool call, so a replayed
 * call finds the pin it already wrote.
 */
export function rememberQuote(store: Store, input: { readonly id: string; readonly quote: string; readonly h: number; readonly cutoff: number }): PinResult {
  const earlier = written(store, input.id)
  if (earlier !== undefined) return { _tag: 'changed', pin: earlier, revision: activePins(store).revision }
  const rows = store.db
    .prepare("SELECT id FROM messages WHERE kind = 'user' AND id >= ? AND id < ? ORDER BY id DESC")
    .all(input.h, input.cutoff) as Array<{ id: number }>
  for (const { id } of rows) {
    const candidate = source(store, id)
    if (candidate === undefined || candidate.removed) continue
    const span = find(candidate.text, input.quote)
    if (span === undefined) continue
    return commit(
      store,
      (pins) => remember({ pins, id: input.id, source: candidate, h: input.h, cutoff: input.cutoff, ...span }),
      (pins) => pins.active.find((p) => p.id === input.id),
    )
  }
  return { _tag: 'refused', reason: rows.length === 0 ? 'source' : 'span' }
}

/** "Remember this" on an owner message: the selection `[from, to)`, or the whole message. */
export function pinMessage(store: Store, input: { readonly id: string; readonly messageId: number; readonly from?: number; readonly to?: number }): PinResult {
  const found = source(store, input.messageId)
  if (found === undefined || found.removed || found.kind !== 'user') return { _tag: 'refused', reason: 'source' }
  const from = input.from ?? 0
  const to = input.to ?? utf8Bytes(found.text)
  return commit(
    store,
    (pins) => remember({ pins, id: input.id, source: found, h: found.id, cutoff: found.id + 1, from, to }),
    (pins) => pins.active.find((p) => p.id === input.id),
  )
}

/** An owner edit: replaces version `expected.version` of pin `expected.id` with `text`. */
export function editPin(store: Store, expected: { readonly id: string; readonly version: number }, text: string): PinResult {
  return commit(
    store,
    (pins) => {
      const current = pins.active.find((p) => p.id === expected.id)
      if (current === undefined || current.version !== expected.version) return { kind: 'refused', reason: 'conflict' }
      const from = source(store, current.sourceId)
      if (from === undefined) return { kind: 'refused', reason: 'source' }
      return editRule({ pins, expected: current, source: from, text })
    },
    (pins) => pins.active.find((p) => p.id === expected.id),
  )
}

/** Undo or removal of version `expected.version` of pin `expected.id`. */
export function undoPin(store: Store, expected: { readonly id: string; readonly version: number }): PinResult {
  return commit(
    store,
    (pins) => {
      const current = pins.active.find((p) => p.id === expected.id && p.version === expected.version)
      return current === undefined ? { kind: 'refused', reason: 'conflict' } : deactivatePin(pins, current)
    },
    (pins) => pins.active.find((p) => p.id === expected.id && p.version === expected.version),
  )
}
