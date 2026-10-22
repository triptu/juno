import { describe, expect, it } from 'vitest'
import type { TopicDetail, TopicRow } from '@juno/contract'
import { emptyWindow } from '../src/list'
import { retainOpenTopics, type SidebarWindow } from '../src/sidebar'
import { activateTab, closeTab, noTabs, openPlace, topicPlace } from '../src/tabs'

const topicRow = (id: string): TopicRow => ({
  id, rev: 1, kind: 'thread', section: 'recent', status: 'open', title: id, titleSource: 'fallback',
  preview: { sender: 'Dev', text: 'Hello' }, messageCount: 2, unreadCount: 1, unreadExact: true,
  mentionsMe: true, tags: [], pinned: false, resolved: false,
  subscribed: true, newThreads: 0, lastActivityTs: '1.000000', lastActivityAt: 1000,
  channel: { id: 'C1', kind: 'public', name: 'eng', label: '#eng', tint: 'public', icon: 'hash', color: 'cyan' },
  participants: [],
})
const a = topicRow('a')
const b = topicRow('b')
const c = topicRow('c')
const window = (...rows: TopicRow[]): SidebarWindow => ({
  ...emptyWindow<TopicRow>(), order: rows.map((row) => row.id), rows: new Map(rows.map((row) => [row.id, row])),
  filter: { kind: 'all', unreadOnly: true }, quietDays: 7,
})
const read: TopicDetail = { ...a, unreadCount: 0, mentionsMe: false }
const details = new Map([['a', read]])

describe('open topics in read-dependent sidebar lists', () => {
  it('returns the source window and its rows when nothing needs retention', () => {
    const source = window(a, b)
    const tabs = openPlace(openPlace(noTabs, topicPlace('a')), topicPlace('b'), { newTab: true })
    const switched = activateTab(tabs, tabs.tabs[0]!.id)
    expect(retainOpenTopics(source, source, tabs, details)).toBe(source)
    expect(retainOpenTopics(source, source, switched, details)).toBe(source)
  })

  it('reuses a retained window until a row, order, retention or source metadata changes', () => {
    const source = window(b, c)
    const tabs = openPlace(openPlace(noTabs, topicPlace('a')), topicPlace('b'), { newTab: true })
    const kept = retainOpenTopics(window(a, b, c), source, tabs, details)
    const switched = activateTab(tabs, tabs.tabs[0]!.id)
    expect(retainOpenTopics(kept, source, switched, details)).toBe(kept)
    expect(retainOpenTopics(kept, source, closeTab(tabs, tabs.active!), details)).toBe(kept)
    const changed = { ...source, rows: new Map([['b', { ...b, rev: 2 }], ['c', c]]) }
    expect(retainOpenTopics(kept, changed, tabs, details)).not.toBe(kept)
    expect(retainOpenTopics(kept, source, tabs, new Map([['a', { ...read, unreadCount: 1 }]]))).not.toBe(kept)
    expect(retainOpenTopics(kept, { ...source, meta: { ...source.meta, total: 4 } }, tabs, details).meta.total).toBe(4)

    const unreadSource = { ...source, order: ['a', 'b', 'c'], rows: new Map([['a', a], ['b', b], ['c', c]]) }
    const unread = retainOpenTopics(kept, unreadSource, tabs, details)
    expect(unread.rows).toBe(unreadSource.rows)
    const closed = retainOpenTopics(unread, unreadSource, closeTab(tabs, tabs.tabs[0]!.id), details)
    expect(closed).not.toBe(unread)
    expect(closed.retained?.size ?? 0).toBe(0)
  })

  it('keeps the read row in place until the last tab leaves, ignoring history', () => {
    const first = openPlace(noTabs, topicPlace('a'))
    const both = openPlace(first, topicPlace('a'), { newTab: true })
    const kept = retainOpenTopics(window(b, a, c), window(c, b), both, details)
    expect(kept.order).toEqual(['b', 'a', 'c'])
    expect(kept.rows.get('a')).toMatchObject({ unreadCount: 0, mentionsMe: false })
    const one = closeTab(both, both.active!)
    expect(retainOpenTopics(kept, window(c, b), one, details).order).toEqual(['b', 'a', 'c'])
    const navigated = openPlace(one, topicPlace('b'))
    expect(retainOpenTopics(kept, window(c, b), navigated, details).order).toEqual(['b', 'c'])
    expect(retainOpenTopics(kept, window(c, b), closeTab(one, one.active!), details).rows.has('a')).toBe(false)
  })

  it('keeps a topic that becomes unread again and does not add unseen open topics', () => {
    const tabs = openPlace(noTabs, topicPlace('a'))
    const kept = retainOpenTopics(window(b, a), window(b), tabs, details)
    const unread = retainOpenTopics(kept, window(a, b), tabs, new Map())
    expect(unread.order).toEqual(['b', 'a'])
    expect(unread.rows.get('a')?.unreadCount).toBe(1)
    expect(retainOpenTopics(window(b), window(b), tabs, details).order).toEqual(['b'])
    expect(retainOpenTopics(window(a, b), window(b), noTabs, details).order).toEqual(['b'])
  })

  it('applies to unread views and mention-only membership, but not ordinary read rows', () => {
    const tabs = openPlace(noTabs, topicPlace('a'))
    const view = { ...window(a, b), filter: { kind: 'all', unreadOnly: true, view: 'view-1' } } satisfies SidebarWindow
    expect(retainOpenTopics(view, window(b), tabs, details).order).toEqual(['a', 'b'])
    const all = { ...window(a, b), filter: { kind: 'all', unreadOnly: false } } satisfies SidebarWindow
    expect(retainOpenTopics(all, window(b), tabs, details).order).toEqual(['a', 'b'])
    const mentioned = { ...window({ ...a, subscribed: false }, b), filter: { kind: 'all', unreadOnly: false } } satisfies SidebarWindow
    const kept = retainOpenTopics(mentioned, window(b), tabs, details)
    expect(retainOpenTopics(kept, window(b), tabs, details).order).toEqual(['a', 'b'])
    const ordinary = { ...window({ ...a, unreadCount: 0, mentionsMe: false }, b), filter: mentioned.filter }
    expect(retainOpenTopics(ordinary, window(b), tabs, details).order).toEqual(['b'])
    expect(retainOpenTopics(view, window(b), tabs, new Map([['a', { ...read, resolved: true }]])).order).toEqual(['b'])
  })
})
