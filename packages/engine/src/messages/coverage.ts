import { Effect } from 'effect'
import { StoreReader } from '@juno/store'
import { continuous, OPEN_FETCH_MAX, provenToEnd, rangeHolding, type ThreadRange } from '@juno/sync'
import { compareTs } from '@juno/domain'
import type { WindowMessage, WindowTarget } from './window'

/** What a thread window knows about its edges (`clipThread`). */
export interface ThreadCoverage {
  readonly ranges: ReadonlyArray<ThreadRange>
  /** The root, for its counters and whether it is only a stub. */
  readonly root: Pick<WindowMessage, 'reply_count' | 'latest_reply' | 'user_id' | 'text' | 'blocks_json'> | undefined
  /**
   * The replies stored in full, counted only while no page proves any stretch of the thread and its first open
   * reads it whole (`standInRanges`); undefined when nothing may stand in for proof.
   */
  readonly held?: number
}

/**
 * A thread's ranges and root, two primary-key reads, and, while no page proves any stretch of it, a count of its
 * stored replies.
 */
export const threadCoverage = (target: Extract<WindowTarget, { kind: 'thread' }>) =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const ranges = yield* sql<ThreadRange>`SELECT kind, from_ts, to_ts, tail, heard_ts FROM thread_ranges WHERE channel = ${target.channel} AND thread_ts = ${target.threadTs} ORDER BY from_ts`
    const roots = yield* sql<NonNullable<ThreadCoverage['root']>>`
      SELECT reply_count, latest_reply, user_id, text, blocks_json FROM messages WHERE channel = ${target.channel} AND ts = ${target.threadTs}`
    const root = roots[0]
    // A longer thread's first open reads from the read pointer only, so it would not prove what stood in above it.
    if (ranges.some((range) => range.kind === 'page') || (root?.reply_count ?? 0) > OPEN_FETCH_MAX) return { ranges, root } satisfies ThreadCoverage
    const counts = yield* sql<{ n: number }>`SELECT count(*) AS n FROM messages
      WHERE channel = ${target.channel} AND thread_ts = ${target.threadTs} AND ts <> ${target.threadTs} AND deleted = 0 AND partial = 0`
    return { ranges, root, held: counts[0]?.n ?? 0 } satisfies ThreadCoverage
  })

/**
 * What may stand in for proof while no page proves any stretch of a thread its first open reads whole, 500
 * replies or fewer (`LiveMeta.standIn`): a thread stored before ranges, or known only from Slack's thread list. The replies Slack's thread list vouched for (`view`
 * ranges), and every stored reply when the store holds as many as the root counts, as before ranges. Neither is
 * proof, and the window says so; the thread's first open lands every page it reads at once (`fetchThread` in
 * `@juno/sync`), and from then on the window keeps to what pages prove.
 */
function standInRanges(threadTs: string, rows: ReadonlyArray<WindowMessage>, coverage: ThreadCoverage): ReadonlyArray<ThreadRange> {
  const lent: Array<ThreadRange> = coverage.ranges.map((range) => ({ ...range, kind: 'page' as const }))
  const { root, held } = coverage
  const replies = root?.reply_count ?? 0
  if (held !== undefined && replies > 0 && held >= replies) lent.push({ kind: 'page', from_ts: threadTs, to_ts: root?.latest_reply ?? rows.at(-1)!.ts, tail: 'none' })
  return lent
}

interface ClipOptions {
  readonly threadTs: string
  readonly anchor: string | undefined
  readonly previous: WindowMessage | undefined
  readonly next: WindowMessage | undefined
  readonly atNewest: boolean
  readonly coverage: ThreadCoverage
  /** The user's own messages, which a window with no anchor keeps at its end as it keeps their pending sends. */
  readonly own: (row: WindowMessage) => boolean
}

interface Clipped {
  readonly rows: ReadonlyArray<WindowMessage>
  readonly previous: WindowMessage | undefined
  readonly gapBefore: boolean
  readonly gapAfter: string | undefined
}

/**
 * A thread's window cut to the stretch the store proves continuous
 * (`@juno/sync` `threadRanges.ts`): the rows around the anchor (without
 * one, the newest row a page range holds, else the newest row) up to the
 * first boundary on either side that no range covers. The view then asks across that boundary when it scrolls near it,
 * and the replies come in at the window's edge, so nothing inside it moves. While no page proves any stretch of the
 * thread, the window is cut by what may stand in for proof (`standInRanges`), and says so (`standIn`).
 *
 * `previous`: the message just before the rows, `next` the one just after
 * them, when the statements read one. `atNewest`: no stored row comes after
 * the rows. Returns the rows kept, whether the first stops at an unknown
 * boundary, and the last proven row when the end does (the user's own rows
 * may follow it); `previous` is dropped when it is across a boundary.
 */
export function clipThread(rows: ReadonlyArray<WindowMessage>, options: ClipOptions): Clipped & { readonly standIn: boolean } {
  const proven = clipWith(rows, options, options.coverage.ranges)
  if (rows.length === 0 || options.coverage.held === undefined) return { ...proven, standIn: false }
  // A reply a search match stored has no reactions or files yet: it never stands in, or the row would grow when its
  // page landed.
  const stood = clipWith(rows, options, standInRanges(options.threadTs, rows, options.coverage), (row) => row.partial === 0)
  const same = stood.rows.length === proven.rows.length && stood.rows[0] === proven.rows[0] && stood.gapBefore === proven.gapBefore && stood.gapAfter === proven.gapAfter
  // What the store holds of a thread's end stands in too, alone (one reply claims nothing), when only replies above
  // it can come in. A root alone does not: its replies would come in below it.
  const tail = proven.gapBefore && proven.gapAfter === undefined
  // A stand-in at the thread's end that stops before a reply the store holds or the root counts would see it land
  // below its rows: it waits for the open instead.
  const below = options.anchor === undefined && stood.gapAfter !== undefined
  if (below || stood.rows.some((row) => row.partial !== 0) || (same && !tail)) return { ...proven, standIn: false }
  return { ...stood, standIn: true }
}

/** `clipThread` with `ranges`; a row `usable` refuses is a boundary, as a reply no range covers is. */
function clipWith(rows: ReadonlyArray<WindowMessage>, options: ClipOptions, ranges: ReadonlyArray<ThreadRange>, usable: (row: WindowMessage) => boolean = () => true): Clipped {
  const { root } = options.coverage
  if (rows.length === 0) return { rows, previous: options.previous, gapBefore: false, gapAfter: undefined }
  const covered = (row: WindowMessage) => usable(row) && rangeHolding(ranges, row.ts) !== undefined
  const joined = (older: WindowMessage, newer: WindowMessage) => usable(older) && usable(newer) && continuous(ranges, older.ts, newer.ts)
  // With no anchor, the newest row a page proved: later rows that only an event or a search brought wait beyond
  // the window's end, so a reply stored across a gap never takes the window away from the rows shown.
  const anchor = options.anchor
  const found = anchor === undefined
    ? rows.findLastIndex(covered)
    : rows.findIndex((row) => compareTs(row.ts, anchor) >= 0)
  const start = found === -1 ? rows.length - 1 : found
  let low = start
  while (low > 0 && joined(rows[low - 1]!, rows[low]!)) low -= 1
  let high = start
  while (high < rows.length - 1 && joined(rows[high]!, rows[high + 1]!)) high += 1
  const first = rows[low]!
  const last = rows[high]!
  const below = low > 0 ? rows[low - 1] : options.previous
  const gapBefore = below === undefined ? first.ts !== options.threadTs : !joined(below, first)
  const above = high < rows.length - 1 ? rows[high + 1] : options.next
  const unknownAfter = above === undefined ? options.atNewest && !provenToEnd(ranges, last.ts, root?.latest_reply ?? undefined) : !joined(last, above)
  const gapAfter = unknownAfter ? last.ts : undefined
  // Juno's own replies come in at once, before a page proves them: they stay at the end of a window at the bottom.
  const tail = anchor === undefined ? rows.slice(high + 1).filter(options.own) : []
  const kept = low === 0 && high === rows.length - 1 ? rows : [...rows.slice(low, high + 1), ...tail]
  return { rows: kept, previous: gapBefore ? undefined : below, gapBefore, gapAfter }
}

/**
 * The window shows fetched history, not only messages that arrived alone
 * (an event, a search match): for Main, the channel has a synced range; for
 * a thread, a range holds the window's first row, or the root has no reply
 * at all. Socket messages can extend a cached Main window beyond its range.
 */
export const windowCovered = (target: WindowTarget, first: string | undefined, coverage: ThreadCoverage | undefined) =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    if (target.kind === 'thread' && target.threadTs.startsWith('pending:')) return true
    if (first === undefined) return false
    if (target.kind === 'main') {
      const ranges = yield* sql<{ covered: number }>`SELECT 1 AS covered FROM synced_ranges
        WHERE channel = ${target.channel} LIMIT 1`
      return ranges.length > 0
    }
    const root = coverage?.root
    if (root === undefined || (root.user_id === null && root.text === '' && root.blocks_json === null)) return false
    if (first === target.threadTs && root.reply_count === 0 && root.latest_reply === null) return true
    return rangeHolding(coverage?.ranges ?? [], first) !== undefined
  })
