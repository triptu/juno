import { Effect } from 'effect'
import { StoreReader } from '@juno/store'
import { continuous, provenToEnd, rangeHolding, type ThreadRange } from '@juno/sync'
import { compareTs } from '@juno/domain'
import type { WindowMessage, WindowTarget } from './window'

/** What a thread window knows about its edges (`clipThread`). */
export interface ThreadCoverage {
  readonly ranges: ReadonlyArray<ThreadRange>
  /** The root, for its counters and whether it is only a stub. */
  readonly root: Pick<WindowMessage, 'reply_count' | 'latest_reply' | 'user_id' | 'text' | 'blocks_json'> | undefined
}

/** A thread's ranges and root, two primary-key reads. */
export const threadCoverage = (target: Extract<WindowTarget, { kind: 'thread' }>) =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const ranges = yield* sql<ThreadRange>`SELECT kind, from_ts, to_ts, tail, heard_ts FROM thread_ranges WHERE channel = ${target.channel} AND thread_ts = ${target.threadTs} ORDER BY from_ts`
    const roots = yield* sql<NonNullable<ThreadCoverage['root']>>`
      SELECT reply_count, latest_reply, user_id, text, blocks_json FROM messages WHERE channel = ${target.channel} AND ts = ${target.threadTs}`
    return { ranges, root: roots[0] } satisfies ThreadCoverage
  })

/**
 * A thread's window cut to the stretch the store proves continuous
 * (`@juno/sync` `threadRanges.ts`): the rows around the anchor (without
 * one, the newest row a page range holds, else the newest row) up to the
 * first boundary on either side that no range covers. The view then asks across that boundary when it scrolls near it,
 * and the replies come in at the window's edge, so nothing inside it moves.
 *
 * `previous`: the message just before the rows, `next` the one just after
 * them, when the statements read one. `atNewest`: no stored row comes after
 * the rows. Returns the rows kept, whether the first stops at an unknown
 * boundary, and the last proven row when the end does (the user's own rows
 * may follow it); `previous` is dropped when it is across a boundary.
 */
export function clipThread(
  rows: ReadonlyArray<WindowMessage>,
  options: {
    readonly threadTs: string
    readonly anchor: string | undefined
    readonly previous: WindowMessage | undefined
    readonly next: WindowMessage | undefined
    readonly atNewest: boolean
    readonly coverage: ThreadCoverage
    /** The user's own messages, which a window with no anchor keeps at its end as it keeps their pending sends. */
    readonly own: (row: WindowMessage) => boolean
  },
): { readonly rows: ReadonlyArray<WindowMessage>; readonly previous: WindowMessage | undefined; readonly gapBefore: boolean; readonly gapAfter: string | undefined } {
  const { ranges, root } = options.coverage
  if (rows.length === 0) return { rows, previous: options.previous, gapBefore: false, gapAfter: undefined }
  const joined = (older: string, newer: string) => continuous(ranges, older, newer)
  // With no anchor, the newest row a page proved: later rows that only an event or a search brought wait beyond
  // the window's end, so a reply stored across a gap never takes the window away from the rows shown.
  const anchor = options.anchor
  const found = anchor === undefined
    ? rows.findLastIndex((row) => rangeHolding(ranges, row.ts) !== undefined)
    : rows.findIndex((row) => compareTs(row.ts, anchor) >= 0)
  const start = found === -1 ? rows.length - 1 : found
  let low = start
  while (low > 0 && joined(rows[low - 1]!.ts, rows[low]!.ts)) low -= 1
  let high = start
  while (high < rows.length - 1 && joined(rows[high]!.ts, rows[high + 1]!.ts)) high += 1
  const first = rows[low]!
  const last = rows[high]!
  const below = low > 0 ? rows[low - 1] : options.previous
  const gapBefore = below === undefined ? first.ts !== options.threadTs : !joined(below.ts, first.ts)
  const above = high < rows.length - 1 ? rows[high + 1] : options.next
  const unknownAfter = above === undefined ? options.atNewest && !provenToEnd(ranges, last.ts, root?.latest_reply ?? undefined) : !joined(last.ts, above.ts)
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
