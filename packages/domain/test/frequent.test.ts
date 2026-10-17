import { describe, expect, it } from 'vitest'
import { frequentDestinations, rankConversations } from '../src/frequent'

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

  it('lists people before channels, newest activity first in each group', () => {
    expect(frequentDestinations([
      channel('channel', now), { id: 'dm', kind: 'im', lastActivityAt: 1 },
      { id: 'group', kind: 'mpim', lastActivityAt: 2 }, channel('older', 1),
    ], [], now)).toEqual(['group', 'dm', 'channel', 'older'])
  })

  it('returns at most five people and five channels, including fill-ins', () => {
    const people = Array.from({ length: 7 }, (_, i) => ({ id: `dm${i}`, kind: 'im' as const, lastActivityAt: i }))
    const channels = Array.from({ length: 7 }, (_, i) => channel(String(i), i))
    expect(frequentDestinations([...channels, ...people], [{ channel: '0', at: now }], now))
      .toEqual(['dm6', 'dm5', 'dm4', 'dm3', 'dm2', '0', '6', '5', '4', '3'])
  })
})

describe('ranking conversations for the palette', () => {
  it('counts visits like sends, so a conversation only read still ranks', () => {
    const uses = [{ channel: 'read', at: now }, { channel: 'read', at: now - DAY }, { channel: 'sent', at: now - 2 * DAY }]
    expect(rankConversations([channel('sent'), channel('read'), channel('idle', now)], uses, now)).toEqual(['read', 'sent', 'idle'])
  })

  it('puts unused names that start with the query before other unused ones, and returns them all', () => {
    const conversations = [channel('a', now), channel('b', 1), channel('c', 2)]
    expect(rankConversations(conversations, [{ channel: 'c', at: now }], now, new Set(['b']))).toEqual(['c', 'b', 'a'])
  })
})
