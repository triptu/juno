import { describe, expect, it } from 'vitest'
import type { TopicRow } from '@juno/contract'
import { emptyWindow, type ListWindow } from '../src/list'
import { holdOrder } from '../src/holdOrder'

const topicRow = (id: string, rev = 1, section: TopicRow['section'] = 'recent', at = 1000): TopicRow => ({
  id, rev, kind: 'thread', section, status: 'open', title: id, titleSource: 'fallback',
  preview: { sender: 'Dev', text: `Hello ${rev}` }, messageCount: 2, unreadCount: rev - 1, unreadExact: true,
  mentionsMe: false, tags: [], pinned: section === 'pinned', resolved: false,
  subscribed: true, newThreads: 0, lastActivityTs: '1.000000', lastActivityAt: at,
  channel: { id: 'C1', kind: 'public', name: 'eng', label: '#eng', tint: 'public', icon: 'hash', color: 'cyan' },
  participants: [],
})
const window = (...rows: TopicRow[]): ListWindow<TopicRow> => ({
  ...emptyWindow<TopicRow>(), order: rows.map((row) => row.id), rows: new Map(rows.map((row) => [row.id, row])),
})
const none = new Set<string>()
const a = topicRow('a', 1, 'recent', 4000)
const b = topicRow('b', 1, 'recent', 3000)
const c = topicRow('c', 1, 'recent', 2000)
const d = topicRow('d', 1, 'recent', 1000)

describe('the held sidebar order', () => {
  it('keeps the order shown while new activity would move a row to the top', () => {
    const c2 = topicRow('c', 2)
    const held = holdOrder(window(a, b, c), window(c2, a, b), none)
    expect(held.order).toEqual(['a', 'b', 'c'])
    // The row's contents still update in place.
    expect(held.rows.get('c')).toBe(c2)
    expect(held.rows.get('a')).toBe(a)
  })

  it('keeps the shown order array when nothing moved, so the list does not re-render', () => {
    const shown = window(a, b, c)
    expect(holdOrder(shown, window(b, a, c), none).order).toBe(shown.order)
  })

  it('queues new rows and keeps leaving rows with their last contents', () => {
    const held = holdOrder(window(a, b, c), window(d, a, c), none)
    expect(held.order).toEqual(['a', 'b', 'c'])
    expect(held.rows.has('d')).toBe(false)
    expect(held.rows.get('b')).toBe(b)
  })

  it('keeps a row in its section until the hold ends', () => {
    const pinned = topicRow('b', 2, 'pinned')
    const held = holdOrder(window(a, b), window(pinned, a), none)
    expect(held.rows.get('b')).toMatchObject({ section: 'recent', rev: 2 })
    // The same live row gives the same held object, so the row does not re-render on every delta.
    expect(holdOrder(held, window(pinned, a), none).rows.get('b')).toBe(held.rows.get('b'))
  })

  it('moves a released row to its place by recency at once', () => {
    const c2 = topicRow('c', 2, 'recent', 5000)
    expect(holdOrder(window(a, b, c), window(c2, a, b), new Set(['c'])).order).toEqual(['c', 'a', 'b'])
    // A held row with newer activity, still low in the list, does not pull it down.
    const b2 = topicRow('b', 2, 'recent', 6000)
    expect(holdOrder(window(a, b, c), window(b2, c2, a), new Set(['c'])).order).toEqual(['c', 'a', 'b'])
  })

  it('adds a released new row and removes a released row that left', () => {
    const d2 = topicRow('d', 2, 'recent', 3500)
    expect(holdOrder(window(a, b, c), window(a, d2, b, c), new Set(['d'])).order).toEqual(['a', 'd', 'b', 'c'])
    const held = holdOrder(window(a, b, c), window(a, c), new Set(['b']))
    expect(held.order).toEqual(['a', 'c'])
    expect(held.rows.has('b')).toBe(false)
  })

  it('takes everything but the order and rows from the live window', () => {
    const live = { ...window(b, a), meta: { ...emptyWindow<TopicRow>().meta, seq: 9 } }
    expect(holdOrder(window(a, b), live, none).meta.seq).toBe(9)
  })
})
