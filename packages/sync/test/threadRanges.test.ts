// The thread range rules (`threadRanges.ts`, specs/threadranges.qnt): what a page proves, when ranges join,
// and when the view and the count may trust them.
import { describe, expect, it } from 'bun:test'
import { continuous, countExact, mergeRange, pageRange, provenToEnd, type ThreadRange } from '../src/threadRanges'

const ts = (n: number) => `1700000${String(n).padStart(3, '0')}.000100`
const ROOT = ts(0)
const range = (from: number, to: number, tail: ThreadRange['tail'] = 'none'): ThreadRange => ({ from_ts: ts(from), to_ts: ts(to), tail })
const merged = (ranges: ReadonlyArray<ThreadRange>, incoming: ThreadRange) => {
  const { range: next, replaced } = mergeRange(ranges, incoming)
  return [...ranges.filter((r) => !replaced.includes(r)), next].toSorted((a, b) => a.from_ts.localeCompare(b.from_ts))
}

describe('thread ranges', () => {
  it('a page proves from its bound to its last reply, to its latest bound, or on past now only on an unbroken connection', () => {
    const page = { threadTs: ROOT, replies: [ts(3), ts(4)], requestedAt: ts(9) }
    expect(pageRange({ ...page, hasMore: true, live: true })).toEqual(range(0, 4))
    expect(pageRange({ ...page, oldest: ts(2), latest: ts(6), hasMore: false, live: true })).toEqual(range(2, 6))
    expect(pageRange({ ...page, hasMore: false, live: true })).toEqual(range(0, 9, 'live'))
    // Juno's clock may run ahead of Slack's: without the socket, only up to the last reply.
    expect(pageRange({ ...page, hasMore: false, live: false })).toEqual(range(0, 4))
    expect(pageRange({ ...page, oldest: ts(4), replies: [], hasMore: true, live: true })).toBeUndefined()
  })

  it('a live tail shows later replies as continuous but never joins the pages above it, so a drop leaves that stretch unknown', () => {
    const live = merged([range(0, 2, 'live')], range(5, 7))
    expect(live).toEqual([range(0, 2, 'live'), range(5, 7)])
    expect(continuous(live, ts(2), ts(6))).toBe(true)
    const dropped = live.map((r) => ({ ...r, tail: 'none' as const }))
    expect(continuous(dropped, ts(2), ts(6))).toBe(false)
    // A page across the stretch joins all three, and its tail stays live.
    expect(merged(live, range(2, 5))).toEqual([range(0, 7, 'live')])
    expect(merged([range(0, 2, 'held')], range(2, 4))).toEqual([range(0, 4, 'held')])
  })

  it('the count is exact only from a range that holds the pointer and reaches the end', () => {
    // Read up to 3; the latest reply is 8.
    expect(countExact([range(0, 5)], ts(3), ts(8))).toBe(false)
    expect(countExact([range(0, 8)], ts(3), ts(8))).toBe(true)
    expect(countExact([range(0, 5, 'held')], ts(3), ts(8))).toBe(true)
    expect(countExact([range(4, 9, 'live')], ts(3), ts(8))).toBe(false)
    expect(countExact([], ts(8), ts(8))).toBe(true)
    // The view, unlike the count, does not show past a held tail.
    expect(provenToEnd([range(0, 5, 'held')], ts(3), ts(8))).toBe(false)
    expect(provenToEnd([range(0, 5, 'live')], ts(3), ts(8))).toBe(true)
  })
})
