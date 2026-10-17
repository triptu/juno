import { describe, expect, it } from 'vitest'
import type { TopicRow } from '@juno/contract'
import { emptyWindow, type ListWindow } from '../src/list'
import { holdOrder } from '../src/holdOrder'

const topicRow = (id: string, rev = 1, section: TopicRow['section'] = 'recent'): TopicRow => ({
  id, rev, kind: 'thread', section, status: 'open', title: id, titleSource: 'fallback',
  preview: { sender: 'Dev', text: `Hello ${rev}` }, messageCount: 2, unreadCount: rev - 1, unreadExact: true,
  mentionsMe: false, tags: [], pinned: section === 'pinned', resolved: false, canResolveOnHover: true,
  subscribed: true, newThreads: 0, lastActivityTs: '1.000000', lastActivityAt: 1000,
  channel: { id: 'C1', kind: 'public', name: 'eng', label: '#eng', tint: 'public', icon: 'hash', color: 'cyan' },
  participants: [],
})
const window = (...rows: TopicRow[]): ListWindow<TopicRow> => ({
  ...emptyWindow<TopicRow>(), order: rows.map((row) => row.id), rows: new Map(rows.map((row) => [row.id, row])),
})
const none = new Set<string>()
const a = topicRow('a')
const b = topicRow('b')
const c = topicRow('c')
const d = topicRow('d')

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

  it('moves a released row to its live place at once', () => {
    const c2 = topicRow('c', 2)
    expect(holdOrder(window(a, b, c), window(c2, a, b), new Set(['c'])).order).toEqual(['c', 'a', 'b'])
    // Placed after the nearest row above it in the live order that is shown.
    expect(holdOrder(window(a, b, c), window(d, a, c, b), new Set(['c'])).order).toEqual(['a', 'c', 'b'])
  })

  it('adds a released new row and removes a released row that left', () => {
    expect(holdOrder(window(a, b, c), window(d, a, b, c), new Set(['d'])).order).toEqual(['d', 'a', 'b', 'c'])
    const held = holdOrder(window(a, b, c), window(a, c), new Set(['b']))
    expect(held.order).toEqual(['a', 'c'])
    expect(held.rows.has('b')).toBe(false)
  })

  it('takes everything but the order and rows from the live window', () => {
    const live = { ...window(b, a), meta: { ...emptyWindow<TopicRow>().meta, seq: 9 } }
    expect(holdOrder(window(a, b), live, none).meta.seq).toBe(9)
  })
})
