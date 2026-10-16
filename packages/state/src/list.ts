/**
 * The renderer's copy of a `liveList` window (performance.md 5.2).
 *
 * Rows live in a `Map` by id. A delta replaces only the rows it carries, so a
 * row whose `rev` did not change keeps its object and `React.memo` holds.
 * `order` keeps its array when the contents did not change, so a container
 * that subscribes to `order` only does not re-render for a row edit. A
 * `reset` (a fresh snapshot after a reconnect or an engine restart) keeps
 * the objects of rows whose `rev` it repeats, so it re-renders only what
 * changed while the port was down.
 *
 * The people and channels rows name by id (`refs`, architecture 7) live in
 * two maps per window, upserted before the rows of the same delta. An entry
 * that arrives equal to the one held keeps the held object, so joins that
 * compare by identity stay put across a reset.
 */
import type { ChannelRef, ListDelta, LiveMeta, Person, Refs, TopicArt } from '@juno/contract'

export interface WindowRefs {
  readonly people: ReadonlyMap<string, Person>
  readonly channels: ReadonlyMap<string, ChannelRef>
  /** By topic id. An entry with an empty recipe means the topic's drawing is not shown (AI assist off). */
  readonly art: ReadonlyMap<string, TopicArt>
}

export interface ListWindow<Row> {
  readonly order: ReadonlyArray<string>
  readonly rows: ReadonlyMap<string, Row>
  readonly refs: WindowRefs
  readonly meta: LiveMeta
}

const noRefs: WindowRefs = { people: new Map(), channels: new Map(), art: new Map() }

export const emptyWindow = <Row>(): ListWindow<Row> => ({
  order: [],
  rows: new Map(),
  refs: noRefs,
  meta: { seq: 0, queryMs: 0, encodeMs: 0, at: 0 },
})

export function applyListDelta<Row extends { readonly id: string; readonly rev: number }>(
  previous: ListWindow<Row>,
  delta: ListDelta<Row>,
): ListWindow<Row> {
  const refs = applyRefs(previous.refs, delta.refs, delta.reset)
  const rows = new Map<string, Row>(delta.reset ? undefined : previous.rows)
  for (const id of delta.remove) rows.delete(id)
  for (const row of delta.upsert) {
    const existing = previous.rows.get(row.id)
    rows.set(row.id, existing !== undefined && existing.rev === row.rev ? existing : row)
  }
  const order = sameOrder(previous.order, delta.order) ? previous.order : delta.order
  return { order, rows, refs, meta: delta.meta }
}

/** Same ids in the same order. */
export function sameOrder(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/**
 * The side tables after a delta. A reset starts from what it carries, which
 * is everything its rows name; entries equal to the held ones keep their
 * objects. Without new entries the maps keep their identity.
 */
function applyRefs(previous: WindowRefs, incoming: Refs | undefined, reset: boolean): WindowRefs {
  const people = incoming?.people ?? []
  const channels = incoming?.channels ?? []
  const art = incoming?.art ?? []
  if (!reset && people.length === 0 && channels.length === 0 && art.length === 0) return previous
  return {
    people: upsertAll(previous.people, people, reset, samePerson),
    channels: upsertAll(previous.channels, channels, reset, sameChannel),
    art: upsertAll(previous.art, art, reset, sameArt),
  }
}

function upsertAll<A extends { readonly id: string }>(
  held: ReadonlyMap<string, A>,
  incoming: ReadonlyArray<A>,
  reset: boolean,
  same: (a: A, b: A) => boolean,
): ReadonlyMap<string, A> {
  if (!reset && incoming.length === 0) return held
  const next = new Map<string, A>(reset ? undefined : held)
  for (const entry of incoming) {
    const old = held.get(entry.id)
    next.set(entry.id, old !== undefined && same(old, entry) ? old : entry)
  }
  return next
}

export const samePerson = (a: Person, b: Person): boolean => a === b || (a.id === b.id && a.name === b.name && a.avatarUrl === b.avatarUrl && a.avatarSmallUrl === b.avatarSmallUrl && a.avatarLargeUrl === b.avatarLargeUrl && a.color === b.color)

const sameChannel = (a: ChannelRef, b: ChannelRef): boolean =>
  a === b ||
  (a.id === b.id &&
    a.kind === b.kind &&
    a.name === b.name &&
    a.label === b.label &&
    a.tint === b.tint &&
    a.icon === b.icon &&
    a.color === b.color &&
    a.partnerId === b.partnerId &&
    (a.memberIds ?? []).join() === (b.memberIds ?? []).join())

const sameArt = (a: TopicArt, b: TopicArt): boolean => a === b || (a.id === b.id && a.recipe === b.recipe)
