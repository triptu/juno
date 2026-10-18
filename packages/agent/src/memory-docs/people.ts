/**
 * Juno's person files on the trusted side (SPEC 13.8, "People you work
 * with"): one file per Slack user id, its relationship, the counts of what
 * the owner and they exchanged, and the split of the older People doc. The
 * rules are `@juno/agent-memory`'s (`mayKeepFile`, `checkPersonEntry`,
 * `peopleLine`, `peopleContext`, `splitPeopleNotes`); a file's entries are
 * `memory_entries` rows with a `person`, written through `writeEntry`.
 *
 * Memory is context, never authority: `check-deps` keeps the policy, the
 * grants, the auto-review and the owner's rules from importing this folder.
 */
import {
  peopleContext, peopleIn, peopleLine, docLimits, splitPeopleNotes,
  type Interaction, type PersonFile, type PersonSummary, type Relationship,
} from '@juno/agent-memory'
import type { ChatMention, SendContext } from '@juno/agent-contract'
import { transaction } from '../store/database'
import type { Store } from '../store/store'
import { bump, docEntries, entries, forget, outlineNow, type Entry } from './store'

const DAY = 24 * 60 * 60 * 1000

export interface Person {
  readonly id: string
  readonly name: string
  readonly relationship: Relationship | null
  readonly relationshipBy: 'juno' | 'owner' | null
  readonly reason: 'interaction' | 'asked' | 'split'
  /** Messages exchanged in DMs and threads in the last 60 days, as last counted. */
  readonly ownerCount: number
  readonly themCount: number
  readonly lastAt: number | null
  readonly learnedAt: number | null
  readonly version: number
}

type PersonRow = { id: string; name: string; relationship: Relationship | null; relationship_by: 'juno' | 'owner' | null; reason: Person['reason']; owner_count: number; them_count: number; last_at: number | null; learned_at: number | null; version: number }

const personOf = (row: PersonRow): Person => ({
  id: row.id, name: row.name, relationship: row.relationship, relationshipBy: row.relationship_by, reason: row.reason,
  ownerCount: row.owner_count, themCount: row.them_count, lastAt: row.last_at, learnedAt: row.learned_at, version: row.version,
})

/** The active files, most exchanged first. */
export function people(store: Store): ReadonlyArray<Person> {
  return (store.db.prepare("SELECT * FROM memory_people WHERE state = 'active' ORDER BY owner_count + them_count DESC, coalesce(last_at, 0) DESC, id").all() as unknown as PersonRow[]).map(personOf)
}

export function person(store: Store, id: string): Person | undefined {
  const row = store.db.prepare("SELECT * FROM memory_people WHERE id = ? AND state = 'active'").get(id) as PersonRow | undefined
  return row === undefined ? undefined : personOf(row)
}

/** Whether the owner deleted this person's file: Juno does not start it again on its own. */
export function deletedFile(store: Store, id: string): boolean {
  return store.db.prepare("SELECT 1 FROM memory_people WHERE id = ? AND state = 'deleted'").get(id) !== undefined
}

/** A file as the rules render it, with its entries. */
export function fileOf(target: Person, all: ReadonlyArray<Entry>): PersonFile {
  return {
    id: target.id, name: target.name,
    ...(target.relationship === null ? {} : { relationship: target.relationship }),
    ...(target.relationshipBy === null ? {} : { relationshipBy: target.relationshipBy }),
    entries: all.filter((entry) => entry.person === target.id).map((entry) => ({ id: `e${entry.id}`, section: entry.section ?? 'notes', text: entry.text })),
  }
}

/** A person's file named by user id, by full name, or by a first name only one file has. */
export function findPerson(store: Store, named: string): Person | undefined {
  const key = named.trim()
  const lower = key.toLowerCase()
  const all = people(store)
  const byId = all.find((p) => p.id === key)
  if (byId !== undefined) return byId
  const full = all.filter((p) => p.name.toLowerCase() === lower)
  if (full.length === 1) return full[0]
  const first = all.filter((p) => p.name.split(/\s+/)[0]?.toLowerCase() === lower)
  return first.length === 1 ? first[0] : undefined
}

export type RelationshipResult =
  | { readonly _tag: 'set'; readonly person: Person }
  /** `unknownPerson`: no such file. `ownerSet`: the owner chose it, and only they change it. `stale`: it changed since the page read it. */
  | { readonly _tag: 'refused'; readonly reason: 'unknownPerson' | 'ownerSet' | 'stale' }

/**
 * Sets or clears who a person is to the owner. Juno's guess never replaces
 * one the owner set; the owner's choice (on the page, or in their own words
 * in a clean run) always does.
 */
export function setRelationship(store: Store, input: { readonly person: string; readonly relationship: Relationship | null; readonly by: 'juno' | 'owner'; readonly expected?: number }): RelationshipResult {
  return transaction(store.db, (): RelationshipResult => {
    const before = person(store, input.person)
    if (before === undefined) return { _tag: 'refused', reason: 'unknownPerson' }
    if (input.expected !== undefined && input.expected !== before.version) return { _tag: 'refused', reason: 'stale' }
    if (input.by === 'juno' && before.relationshipBy === 'owner') return { _tag: 'refused', reason: 'ownerSet' }
    store.db.prepare('UPDATE memory_people SET relationship = ?, relationship_by = ?, version = version + 1, updated_at = ? WHERE id = ?')
      .run(input.relationship, input.relationship === null ? null : input.by, store.now(), input.person)
    return { _tag: 'set', person: person(store, input.person)! }
  })
}

/**
 * The owner deletes a person's file: every entry goes with every text it
 * had, as a note's Delete does, and the row stays as `deleted`, with no
 * name, so Juno starts a file on them again only when the owner asks.
 */
export function deletePerson(store: Store, input: { readonly person: string }): boolean {
  return transaction(store.db, () => {
    if (person(store, input.person) === undefined) return false
    for (const entry of entries(store).filter((e) => e.person === input.person)) forget(store, entry.id)
    store.db.prepare("UPDATE memory_people SET state = 'deleted', name = '', relationship = NULL, relationship_by = NULL, version = version + 1, updated_at = ? WHERE id = ?").run(store.now(), input.person)
    bump(store, true)
    return true
  })
}

/**
 * Keeps the counts on each file current from the latest interactions, at
 * most daily per file, so the outline's order holds between counts. A file
 * with no exchange in the window counts zero.
 */
export function recordCounts(store: Store, interactions: ReadonlyArray<Interaction>): void {
  const now = store.now()
  const byId = new Map(interactions.map((i) => [i.id, i]))
  transaction(store.db, () => {
    for (const row of store.db.prepare("SELECT id, counted_at FROM memory_people WHERE state = 'active'").all() as Array<{ id: string; counted_at: number | null }>) {
      if (row.counted_at !== null && now - row.counted_at < DAY) continue
      const seen = byId.get(row.id)
      store.db.prepare('UPDATE memory_people SET owner_count = ?, them_count = ?, last_at = coalesce(?, last_at), counted_at = ? WHERE id = ?')
        .run(seen?.owner ?? 0, seen?.them ?? 0, seen?.lastAt ?? null, now, row.id)
    }
  })
}

/** Juno updated the file in the background now, or a pass covered it: the next update waits a day. */
export function markLearned(store: Store, id: string, at: number = store.now()): void {
  store.db.prepare('UPDATE memory_people SET learned_at = ? WHERE id = ?').run(at, id)
}

/** The People line's files part of the outline: the count and the people most in touch, never their notes. */
export function filesLine(store: Store): string {
  const summaries: ReadonlyArray<PersonSummary> = people(store).map((p) => ({
    id: p.id, name: p.name, exchanged: p.ownerCount + p.themCount, ...(p.relationship === null ? {} : { relationship: p.relationship }),
  }))
  return peopleLine(summaries, docLimits.outlinePeople)
}

/** The outline a request carries now, with the person files. */
export const outlineWithPeople = (store: Store): string => outlineNow(store, filesLine(store))

/* The people a run involves -------------------------------------------------- */

/** What a run's first input says about who it involves: the person it is about, the DM's other person, tagged people, and the owner's words. */
export function involved(store: Store, input: { readonly text: string; readonly context?: SendContext; readonly mentions?: ReadonlyArray<ChatMention> }): ReadonlyArray<string> {
  const files = people(store)
  const ids: Array<string> = []
  const context = input.context
  if (context?._tag === 'person') ids.push(context.userId)
  if ((context?._tag === 'topic' || context?._tag === 'channel') && context.person !== undefined) ids.push(context.person)
  for (const mention of input.mentions ?? []) if (mention.kind === 'person') ids.push(mention.id)
  for (const id of peopleIn(input.text, files)) ids.push(id)
  const known = new Set(files.map((file) => file.id))
  return [...new Set(ids)].filter((id) => known.has(id))
}

/**
 * The `<people-now>` block for the live run with history cutoff `h`: the
 * files of the people its first input involves, or ''. It goes after the
 * recent messages, past the cached prefix, so an update to a file costs
 * only this block.
 */
export function peopleNow(store: Store, h: number): string {
  const run = store.db.prepare('SELECT op_id AS opId FROM runs WHERE h = ? AND ended_at IS NULL').get(h) as { opId: string } | undefined
  if (run === undefined) return ''
  const op = store.db.prepare('SELECT text, data FROM inbox WHERE op_id = ?').get(run.opId) as { text: string; data: string | null } | undefined
  if (op === undefined) return ''
  const data = (op.data === null ? {} : JSON.parse(op.data)) as { readonly context?: SendContext; readonly mentions?: ReadonlyArray<ChatMention> }
  const ids = involved(store, { text: op.text, ...(data.context === undefined ? {} : { context: data.context }), ...(data.mentions === undefined ? {} : { mentions: data.mentions }) })
  if (ids.length === 0) return ''
  const all = entries(store)
  return peopleContext(ids.flatMap((id) => {
    const found = person(store, id)
    return found === undefined ? [] : [fileOf(found, all)]
  }))
}

/* The split of the older People doc ------------------------------------------ */

/**
 * The names the older People doc's notes start with, for the host to look
 * up, or undefined once the split ran.
 */
export function splitNames(store: Store): ReadonlyArray<string> | undefined {
  const done = (store.db.prepare('SELECT people_split AS done FROM memory_docs_state WHERE singleton = 1').get() as { done: number } | undefined)?.done === 1
  if (done) return undefined
  const names = new Set<string>()
  splitPeopleNotes(docEntries(entries(store)).filter((entry) => entry.doc === 'people'), (name) => (names.add(name), []))
  return [...names]
}

/**
 * Splits the older People doc once: a "Name: …" note moves to that person's
 * file when `resolve` found exactly one workspace member by the name, and
 * every other note stays a general People note. The moved note keeps its
 * source and its mark, loses the name in front, and says so in the changes.
 */
export function applySplit(store: Store, resolve: (name: string) => ReadonlyArray<{ readonly id: string; readonly name: string }>): number {
  const { db } = store
  return transaction(db, () => {
    if (splitNames(store) === undefined) return 0
    const now = store.now()
    const all = entries(store)
    const { moves } = splitPeopleNotes(docEntries(all).filter((entry) => entry.doc === 'people'), resolve)
    let moved = 0
    for (const move of moves) {
      const entry = all.find((e) => `e${e.id}` === move.entry)
      if (entry === undefined || deletedFile(store, move.person)) continue
      db.prepare(
        `INSERT INTO memory_people (id, name, reason, state, version, created_at, updated_at) VALUES (?, ?, 'split', 'active', 1, ?, ?)
         ON CONFLICT (id) DO NOTHING`,
      ).run(move.person, move.name, now, now)
      if (move.relationship !== undefined) db.prepare("UPDATE memory_people SET relationship = ?, relationship_by = 'juno' WHERE id = ? AND relationship IS NULL").run(move.relationship, move.person)
      const version = entry.version + 1
      db.prepare('UPDATE memory_entries SET person = ?, section = ?, text = ?, version = ?, updated_at = ? WHERE id = ?').run(move.person, move.section, move.text, version, now, entry.id)
      db.prepare(
        `INSERT INTO memory_writes (id, run_id, entry_id, doc, person, kind, by, before_text, after_text, before_version, after_version, source, connection, tainted, at)
         VALUES (?, NULL, ?, 'people', ?, 'update', 'juno', ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(`split:${entry.id}`, entry.id, move.person, entry.text, move.text, entry.version, version, entry.source, entry.connection, entry.tainted ? 1 : 0, now)
      moved += 1
    }
    db.prepare('INSERT INTO memory_docs_state (singleton, rev, people_split) VALUES (1, 0, 1) ON CONFLICT (singleton) DO UPDATE SET people_split = 1').run()
    if (moved > 0) {
      bump(store)
      bump(store, true)
    }
    return moved
  })
}

/* Who may get a file --------------------------------------------------------- */

/** The latest interactions the host counted, kept in memory between counts: no file for anyone else. */
export interface Contacts {
  readonly get: (id: string) => Interaction | undefined
  readonly all: () => ReadonlyArray<Interaction>
  readonly set: (list: ReadonlyArray<Interaction>) => void
}

export function createContacts(): Contacts {
  let byId = new Map<string, Interaction>()
  return {
    get: (id) => byId.get(id),
    all: () => [...byId.values()],
    set: (list) => {
      byId = new Map(list.map((i) => [i.id, i]))
    },
  }
}
