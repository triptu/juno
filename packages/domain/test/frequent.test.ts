import { describe, expect, it } from 'vitest'
import { frequentDestinations } from '../src/frequent'

const DAY = 86_400_000
const now = 40 * DAY
const channel = (id: string, lastActivityAt = 0) => ({ id, kind: 'public' as const, lastActivityAt })

describe('frequent destinations', () => {
  it('halves sends each week and excludes sends outside the last 30 days', () => {
    const conversations = ['old', 'week', 'recent', 'outside'].map(id => channel(id))
    const sends = [
      { channel: 'recent', at: now },
      ...[1, 2, 3].map(() => ({ channel: 'old', at: now - 14 * DAY })),
      ...[1, 2, 3].map(() => ({ channel: 'week', at: now - 7 * DAY })),
      ...[1, 2, 3, 4, 5].map(() => ({ channel: 'outside', at: now - 31 * DAY })),
    ]
    expect(frequentDestinations(conversations, sends, now)).toEqual(['week', 'recent', 'old', 'outside'])
  })

  it('breaks equal scores by the most recent send', () => {
    expect(frequentDestinations([channel('older'), channel('newer')], [
      { channel: 'older', at: now - 7 * DAY }, { channel: 'older', at: now - 7 * DAY },
      { channel: 'newer', at: now },
    ], now)).toEqual(['newer', 'older'])
  })

  it('fills with DMs before channels, newest activity first in each group', () => {
    expect(frequentDestinations([
      channel('channel', now), { id: 'dm', kind: 'im', lastActivityAt: 1 },
      { id: 'group', kind: 'mpim', lastActivityAt: 2 }, channel('older', 1),
    ], [], now)).toEqual(['group', 'dm', 'channel', 'older'])
  })

  it('returns at most six destinations, including fill-ins', () => {
    expect(frequentDestinations(Array.from({ length: 10 }, (_, i) => channel(String(i), i)), [{ channel: '0', at: now }], now))
      .toEqual(['0', '9', '8', '7', '6', '5'])
  })
})
