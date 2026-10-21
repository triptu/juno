import { describe, expect, it } from 'vitest'
import { rankConversations } from '../src/frequent'

const DAY = 86_400_000
const now = 40 * DAY
const channel = (id: string, lastActivityAt = 0) => ({ id, kind: 'public' as const, lastActivityAt })

describe('ranking conversations by use', () => {
  it('halves uses each week and leaves out uses older than 30 days', () => {
    const conversations = ['old', 'week', 'recent', 'outside'].map(id => channel(id))
    const uses = [
      { channel: 'recent', at: now },
      ...[1, 2, 3].map(() => ({ channel: 'old', at: now - 14 * DAY })),
      ...[1, 2, 3].map(() => ({ channel: 'week', at: now - 7 * DAY })),
      ...[1, 2, 3, 4, 5].map(() => ({ channel: 'outside', at: now - 31 * DAY })),
    ]
    expect(rankConversations(conversations, uses, now)).toEqual(['week', 'recent', 'old', 'outside'])
  })

  it('breaks equal scores by the latest use', () => {
    expect(rankConversations([channel('older'), channel('newer')], [
      { channel: 'older', at: now - 7 * DAY }, { channel: 'older', at: now - 7 * DAY },
      { channel: 'newer', at: now },
    ], now)).toEqual(['newer', 'older'])
  })

  it('puts unused people before unused channels, newest activity first in each', () => {
    expect(rankConversations([
      channel('channel', now), { id: 'dm', kind: 'im', lastActivityAt: 1 },
      { id: 'group', kind: 'mpim', lastActivityAt: 2 }, channel('older', 1),
    ], [], now)).toEqual(['group', 'dm', 'channel', 'older'])
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
