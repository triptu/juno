import { describe, expect, it } from 'vitest'
import {
  closeAllTabs,
  closeOtherTabs,
  closeTab,
  closeTabsToRight,
  cycleTab,
  dividerIndex,
  historyTarget,
  homePlace,
  junoPagePlace,
  junoPlace,
  mountedTabs,
  newChatPlace,
  noTabs,
  openPlace,
  parseTabs,
  reopenClosedTab,
  savedTabs,
  setPinned,
  settleNewChat,
  stepHistory,
  tabByNumber,
  tabTopic,
  topicPlace,
  type OpenOptions,
  type Tabs,
} from '../src/tabs'

const open = (tabs: Tabs, topicId: string, options?: OpenOptions) => openPlace(tabs, topicPlace(topicId), options)
/** What each tab shows, left to right: a topic id, "new" for a New chat, "home" or "juno". */
const placeName = (tab: Tabs['tabs'][number]) => {
  const kind = tab.history.entries[tab.history.index]!.kind
  const place = tab.history.entries[tab.history.index]!
  return tabTopic(tab) ?? (place.kind === 'junoPage' ? place.page : kind === 'newChat' ? 'new' : kind)
}
const shown = (tabs: Tabs) => tabs.tabs.map(placeName)
const activeShows = (tabs: Tabs) => {
  const tab = tabs.tabs.find((other) => other.id === tabs.active)
  return tab === undefined ? undefined : placeName(tab)
}
/** The topics of the mounted tabs, the active first. */
const mounted = (tabs: Tabs) => [...mountedTabs(tabs)].map((id) => tabTopic(tabs.tabs.find((tab) => tab.id === id)!))
const idOf = (tabs: Tabs, topicId: string) => tabs.tabs.find((tab) => tabTopic(tab) === topicId)!.id

/** Tabs a, b, c with b active. */
const three = open(open(open(open(noTabs, 'a'), 'b', { newTab: true }), 'c', { newTab: true }), 'b')

describe('opening', () => {
  it('the first topic opens a tab; the next ones show in it', () => {
    const one = open(noTabs, 'a')
    expect(shown(one)).toEqual(['a'])
    const two = open(one, 'b')
    expect(shown(two)).toEqual(['b'])
    expect(two.tabs[0]!.id).toBe(one.tabs[0]!.id)
  })

  it('a new tab goes right after the current one and becomes active', () => {
    expect(shown(three)).toEqual(['a', 'b', 'c'])
    const opened = open(three, 'd', { newTab: true })
    expect(shown(opened)).toEqual(['a', 'b', 'd', 'c'])
    expect(activeShows(opened)).toBe('d')
    expect(mountedTabs(opened).size).toBe(4)
  })

  it('a topic another tab shows focuses that tab instead of opening another, in either mode', () => {
    expect(activeShows(open(three, 'c'))).toBe('c')
    expect(shown(open(three, 'a', { newTab: true }))).toEqual(['a', 'b', 'c'])
  })

  it('a New chat opens in a new tab, and the next open in that tab replaces it', () => {
    const chat = openPlace(three, newChatPlace, { newTab: true })
    expect(shown(chat)).toEqual(['a', 'b', 'new', 'c'])
    const filled = open(chat, 'd')
    expect(shown(filled)).toEqual(['a', 'b', 'd', 'c'])
    expect(historyTarget(filled, -1)).toBeUndefined()
  })
})

describe('Home', () => {
  it('opens in the current tab, and a second open focuses the tab that shows it', () => {
    const home = openPlace(three, homePlace)
    expect(shown(home)).toEqual(['a', 'home', 'c'])
    expect(historyTarget(home, -1)).toEqual(topicPlace('b'))
    const elsewhere = open(home, 'd', { newTab: true })
    const again = openPlace(elsewhere, homePlace, { newTab: true })
    expect(shown(again)).toEqual(['a', 'home', 'd', 'c'])
    expect(activeShows(again)).toBe('home')
  })

  it('with no tab open, opens a tab', () => {
    expect(shown(openPlace(noTabs, homePlace))).toEqual(['home'])
  })
})

describe('Juno', () => {
  it('is one tab: a second open focuses it, and it reads back after a restart', () => {
    const juno = openPlace(three, junoPlace, { newTab: true })
    expect(shown(juno)).toEqual(['a', 'b', 'juno', 'c'])
    const again = openPlace(open(juno, 'd', { newTab: true }), junoPlace, { newTab: true })
    expect(shown(again)).toEqual(['a', 'b', 'juno', 'd', 'c'])
    expect(activeShows(again)).toBe('juno')
    expect(shown(parseTabs(JSON.parse(JSON.stringify(savedTabs(again)))))).toEqual(['a', 'b', 'juno', 'd', 'c'])
  })
})

describe('Juno pages', () => {
  it('each opens in one tab, and reads back after a restart', () => {
    const settings = openPlace(three, junoPagePlace('settings'), { newTab: true })
    const both = openPlace(settings, junoPagePlace('activity'), { newTab: true })
    expect(shown(both)).toEqual(['a', 'b', 'settings', 'activity', 'c'])
    const again = openPlace(both, junoPagePlace('settings'), { newTab: true })
    expect(activeShows(again)).toBe('settings')
    expect(shown(again)).toEqual(['a', 'b', 'settings', 'activity', 'c'])
    expect(shown(parseTabs(JSON.parse(JSON.stringify(savedTabs(again)))))).toEqual(['a', 'b', 'settings', 'activity', 'c'])
  })
})

describe('a New chat that sends', () => {
  it('becomes the topic in place of its own entry, so Back goes to what the tab showed before', () => {
    const chat = openPlace(open(noTabs, 'a'), newChatPlace)
    expect(historyTarget(chat, -1)).toEqual(topicPlace('a'))
    const sent = settleNewChat(chat, chat.active!, 'd')
    expect(shown(sent)).toEqual(['d'])
    expect(historyTarget(sent, -1)).toEqual(topicPlace('a'))
    expect(historyTarget(stepHistory(sent, -1), 1)).toEqual(topicPlace('d'))
  })

  it('closes and focuses the tab that already shows the topic, leaving nothing to reopen', () => {
    const chat = openPlace(three, newChatPlace, { newTab: true })
    const sent = settleNewChat(chat, chat.active!, 'c')
    expect(shown(sent)).toEqual(['a', 'b', 'c'])
    expect(activeShows(sent)).toBe('c')
    expect(sent.closed).toEqual(chat.closed)
  })

  it('changes nothing once the tab shows something else', () => {
    expect(settleNewChat(three, three.active!, 'd')).toBe(three)
  })

  it('a tab closed while sending comes back showing the topic', () => {
    const chat = openPlace(three, newChatPlace, { newTab: true })
    const closed = closeTab(chat, chat.active!)
    const sent = settleNewChat(closed, chat.active!, 'd')
    expect(shown(reopenClosedTab(sent))).toEqual(['a', 'b', 'd', 'c'])
  })
})

describe('history', () => {
  it('Back and Forward move through what the tab showed', () => {
    const tabs = open(open(open(noTabs, 'a'), 'b'), 'c')
    expect(historyTarget(tabs, -1)).toEqual(topicPlace('b'))
    expect(historyTarget(tabs, 1)).toBeUndefined()
    const back = stepHistory(stepHistory(tabs, -1), -1)
    expect(shown(back)).toEqual(['a'])
    expect(stepHistory(back, -1)).toBe(back)
    expect(shown(stepHistory(back, 1))).toEqual(['b'])
  })

  it('opening something after going back drops Forward', () => {
    const back = stepHistory(open(open(noTabs, 'a'), 'b'), -1)
    const branched = open(back, 'c')
    expect(historyTarget(branched, 1)).toBeUndefined()
    expect(historyTarget(branched, -1)).toEqual(topicPlace('a'))
  })

  it('each tab has its own history', () => {
    const tabs = open(open(open(open(noTabs, 'a'), 'b'), 'x', { newTab: true }), 'y')
    expect(historyTarget(tabs, -1)).toEqual(topicPlace('x'))
    expect(historyTarget(cycleTab(tabs, 1), -1)).toEqual(topicPlace('a'))
  })

  it('keeps the last 50 entries', () => {
    let tabs = open(noTabs, 't0')
    for (let i = 1; i < 60; i++) tabs = open(tabs, `t${i}`)
    expect(tabs.tabs[0]!.history.entries).toHaveLength(50)
    expect(tabs.tabs[0]!.history.entries[0]).toEqual(topicPlace('t10'))
  })
})

describe('closing', () => {
  it('closing the active tab focuses its right neighbour, or the left one at the end', () => {
    expect(activeShows(closeTab(three, idOf(three, 'b')))).toBe('c')
    expect(shown(closeTab(three, idOf(three, 'b')))).toEqual(['a', 'c'])
    const last = open(three, 'c')
    expect(activeShows(closeTab(last, idOf(last, 'c')))).toBe('b')
  })

  it('closing another tab keeps the active one', () => {
    const closed = closeTab(three, idOf(three, 'a'))
    expect(shown(closed)).toEqual(['b', 'c'])
    expect(activeShows(closed)).toBe('b')
  })

  it('closing the last tab leaves none', () => {
    const one = open(noTabs, 'a')
    const none = closeTab(one, one.tabs[0]!.id)
    expect(none.tabs).toEqual([])
    expect(none.active).toBeUndefined()
  })

  it('close other, to the right and all leave pinned tabs open', () => {
    const tabs = setPinned(open(three, 'd', { newTab: true }), idOf(three, 'c'), true)
    expect(shown(tabs)).toEqual(['c', 'a', 'b', 'd'])
    expect(shown(closeOtherTabs(tabs, idOf(tabs, 'b')))).toEqual(['c', 'b'])
    expect(activeShows(closeOtherTabs(tabs, idOf(tabs, 'a')))).toBe('a')
    expect(shown(closeTabsToRight(tabs, idOf(tabs, 'a')))).toEqual(['c', 'a'])
    expect(shown(closeTabsToRight(tabs, idOf(tabs, 'c')))).toEqual(['c'])
    expect(shown(closeAllTabs(tabs))).toEqual(['c'])
    expect(shown(closeTab(tabs, idOf(tabs, 'c')))).toEqual(['a', 'b', 'd'])
  })
})

describe('reopening closed tabs', () => {
  it('brings back the last closed tab, then the one before, each at its place and with its history', () => {
    const withHistory = open(three, 'b2')
    const one = closeTab(withHistory, idOf(withHistory, 'b2'))
    const two = closeTab(one, idOf(one, 'a'))
    expect(shown(two)).toEqual(['c'])
    const first = reopenClosedTab(two)
    expect(shown(first)).toEqual(['a', 'c'])
    expect(activeShows(first)).toBe('a')
    const second = reopenClosedTab(first)
    expect(shown(second)).toEqual(['a', 'b2', 'c'])
    expect(activeShows(second)).toBe('b2')
    expect(historyTarget(second, -1)).toEqual(topicPlace('b'))
    expect(reopenClosedTab(reopenClosedTab(second))).toBe(reopenClosedTab(second))
  })

  it('after closing all, reopens them left to right', () => {
    let tabs = closeAllTabs(three)
    tabs = reopenClosedTab(reopenClosedTab(reopenClosedTab(tabs)))
    expect(shown(tabs)).toEqual(['a', 'b', 'c'])
  })

  it('keeps the last 20', () => {
    let tabs = noTabs
    for (let i = 0; i < 25; i++) tabs = open(tabs, `t${i}`, { newTab: true })
    tabs = closeAllTabs(tabs)
    expect(tabs.closed).toHaveLength(20)
  })

  it('a new tab never reuses the id of a closed one', () => {
    const closed = closeTab(three, idOf(three, 'c'))
    const opened = open(closed, 'd', { newTab: true })
    expect(new Set([...opened.tabs, ...opened.closed.map((entry) => entry.tab)].map((tab) => tab.id)).size).toBe(4)
  })
})

describe('pinning', () => {
  it('pins after the pinned tabs and unpins to the first unpinned place', () => {
    let tabs = setPinned(three, idOf(three, 'c'), true)
    expect(shown(tabs)).toEqual(['c', 'a', 'b'])
    tabs = setPinned(tabs, idOf(tabs, 'b'), true)
    expect(shown(tabs)).toEqual(['c', 'b', 'a'])
    expect(tabs.tabs.map((tab) => tab.pinned)).toEqual([true, true, false])
    tabs = setPinned(tabs, idOf(tabs, 'c'), false)
    expect(shown(tabs)).toEqual(['b', 'c', 'a'])
  })

  it('a new tab opened from a pinned tab goes after the pinned ones', () => {
    const tabs = setPinned(open(open(noTabs, 'a'), 'b', { newTab: true }), 'tab-1', true)
    const from = cycleTab(tabs, -1)
    expect(activeShows(from)).toBe('a')
    expect(shown(open(from, 'c', { newTab: true }))).toEqual(['a', 'c', 'b'])
  })
})

describe('switching and mounting', () => {
  it('cycles through the strip and wraps', () => {
    expect(activeShows(cycleTab(three, 1))).toBe('c')
    expect(activeShows(cycleTab(cycleTab(three, 1), 1))).toBe('a')
    expect(activeShows(cycleTab(three, -1))).toBe('a')
  })

  it('numbers the tabs from 1, with 9 the last', () => {
    const tabs = open(three, 'd', { newTab: true })
    expect(tabTopic(tabByNumber(tabs, 1)!)).toBe('a')
    expect(tabTopic(tabByNumber(tabs, 3)!)).toBe('d')
    expect(tabByNumber(tabs, 8)).toBeUndefined()
    expect(tabTopic(tabByNumber(tabs, 9)!)).toBe('c')
  })

  it('keeps the active tab and the 4 most recent mounted', () => {
    let tabs = noTabs
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) tabs = open(tabs, id, { newTab: true })
    expect(mounted(tabs)).toEqual(['g', 'f', 'e', 'd', 'c'])
    tabs = open(tabs, 'a')
    expect(mounted(tabs)).toEqual(['a', 'g', 'f', 'e', 'd'])
  })
})

describe('the divider', () => {
  it('goes before the first message after the read pointer', () => {
    const order = ['1.000001', '1.000002', '1.000003']
    expect(dividerIndex(order, '1.000001')).toBe(1)
    expect(dividerIndex(order, '1.000003')).toBe(-1)
    expect(dividerIndex(order, undefined)).toBe(-1)
  })

  it('never goes before the user’s own messages, sent or still sending', () => {
    const order = ['1.000001', '1.000002', 'pending:c1', '1.000003']
    const mine = (ts: string) => ts === '1.000002' || ts === 'pending:c1'
    expect(dividerIndex(order, '1.000001', mine)).toBe(3)
    expect(dividerIndex(order.slice(0, 3), '1.000001', mine)).toBe(-1)
  })
})

describe('saved tabs', () => {
  it('read back as they were saved, pinned flags included, each showing its place', () => {
    const tabs = setPinned(open(open(three, 'b2'), 'd', { newTab: true }), 'tab-3', true)
    const restored = parseTabs(JSON.parse(JSON.stringify(savedTabs(tabs))))
    expect(shown(restored)).toEqual(shown(tabs))
    expect(restored.tabs.map((tab) => [tab.id, tab.pinned])).toEqual(tabs.tabs.map((tab) => [tab.id, tab.pinned]))
    expect(restored.active).toBe(tabs.active)
    expect(historyTarget(restored, -1)).toBeUndefined()
  })

  it('tabs saved before history read back as topic tabs, with or without the old stealth flag', () => {
    for (const saved of [
      { tabs: [{ id: 'a' }, { id: 'b' }], active: 'b', recent: ['b', 'a'] },
      { tabs: [{ id: 'a', stealth: false }, { id: 'b', stealth: true }], active: 'b', recent: ['b', 'a'] },
    ]) {
      const restored = parseTabs(saved)
      expect(shown(restored)).toEqual(['a', 'b'])
      expect(restored.tabs.map((tab) => Object.keys(tab).toSorted())).toEqual([
        ['history', 'id', 'pinned'],
        ['history', 'id', 'pinned'],
      ])
      expect(activeShows(restored)).toBe('b')
    }
  })

  it('a tab saved with the old stealth flag and a place still reads back', () => {
    const restored = parseTabs({ tabs: [{ id: 'tab-1', pinned: true, stealth: true, place: { kind: 'topic', topicId: 'a' } }], active: 'tab-1', recent: [] })
    expect(shown(restored)).toEqual(['a'])
    expect(restored.tabs[0]!.pinned).toBe(true)
  })

  it('anything unreadable is no tabs, and a lost active tab falls back to the first', () => {
    const home = parseTabs(JSON.parse(JSON.stringify(savedTabs(openPlace(noTabs, homePlace)))))
    expect(shown(home)).toEqual(['home'])
    expect(parseTabs(null)).toEqual(noTabs)
    expect(parseTabs({ tabs: 'nope' })).toEqual(noTabs)
    const lost = parseTabs({ tabs: [{ id: 'a' }], active: 'gone', recent: ['gone'] })
    expect(lost.active).toBe('a')
    expect(lost.recent).toEqual(['a'])
  })
})
