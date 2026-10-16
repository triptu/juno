import { describe, expect, it } from 'vitest'
import {
  activateTab,
  acknowledgeTopic,
  closeAllTabs,
  closeOtherTabs,
  closeTab,
  closeTabsToRight,
  cycleTab,
  dividerIndex,
  ensureTab,
  historyTarget,
  homePlace,
  junoPagePlace,
  junoPlace,
  mountedTabs,
  newChatPlace,
  newTabPlace,
  noTabs,
  openPlace,
  openSettingsSection,
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

  it('a plain open of a topic another tab shows focuses that tab', () => {
    const focused = open(three, 'c')
    expect(shown(focused)).toEqual(['a', 'b', 'c'])
    expect(activeShows(focused)).toBe('c')
  })

  it('a new tab always opens, so one topic can show in several tabs', () => {
    const twice = open(three, 'a', { newTab: true })
    expect(shown(twice)).toEqual(['a', 'b', 'a', 'c'])
    expect(twice.active).not.toBe(idOf(three, 'a'))
  })

  it('a plain open focuses the tab that shows the topic and was active last', () => {
    // Two tabs show a: the one opened second was active more recently.
    const twice = open(three, 'a', { newTab: true })
    const second = twice.active!
    const back = open(open(twice, 'c'), 'a')
    expect(back.active).toBe(second)
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
  it('opens in the current tab, a plain open again focuses that tab, and a new tab shows a second Home', () => {
    const home = openPlace(three, homePlace)
    expect(shown(home)).toEqual(['a', 'home', 'c'])
    expect(historyTarget(home, -1)).toEqual(topicPlace('b'))
    const elsewhere = open(home, 'd', { newTab: true })
    const again = openPlace(elsewhere, homePlace)
    expect(shown(again)).toEqual(['a', 'home', 'd', 'c'])
    expect(activeShows(again)).toBe('home')
    expect(shown(openPlace(elsewhere, homePlace, { newTab: true }))).toEqual(['a', 'home', 'd', 'home', 'c'])
  })

  it('with no tab open, opens a tab', () => {
    expect(shown(openPlace(noTabs, homePlace))).toEqual(['home'])
  })
})

describe('Juno', () => {
  it('a plain open focuses its tab, a new tab shows it twice, and both read back after a restart', () => {
    const juno = openPlace(three, junoPlace, { newTab: true })
    expect(shown(juno)).toEqual(['a', 'b', 'juno', 'c'])
    const again = openPlace(open(juno, 'd', { newTab: true }), junoPlace)
    expect(shown(again)).toEqual(['a', 'b', 'juno', 'd', 'c'])
    expect(activeShows(again)).toBe('juno')
    const twice = openPlace(again, junoPlace, { newTab: true })
    expect(shown(twice)).toEqual(['a', 'b', 'juno', 'juno', 'd', 'c'])
    expect(shown(parseTabs(JSON.parse(JSON.stringify(savedTabs(twice)))))).toEqual(['a', 'b', 'juno', 'juno', 'd', 'c'])
  })
})

describe('Juno pages', () => {
  it('a plain open focuses the tab that shows the page, and the pages read back after a restart', () => {
    const scheduled = openPlace(three, junoPagePlace('scheduled'), { newTab: true })
    const both = openPlace(scheduled, junoPagePlace('activity'), { newTab: true })
    expect(shown(both)).toEqual(['a', 'b', 'scheduled', 'activity', 'c'])
    const again = openPlace(both, junoPagePlace('scheduled'))
    expect(activeShows(again)).toBe('scheduled')
    expect(shown(again)).toEqual(['a', 'b', 'scheduled', 'activity', 'c'])
    expect(shown(parseTabs(JSON.parse(JSON.stringify(savedTabs(again)))))).toEqual(['a', 'b', 'scheduled', 'activity', 'c'])
  })
})

describe('Settings', () => {
  const sectionOf = (tabs: Tabs) => {
    const place = tabs.tabs.find((tab) => tab.id === tabs.active)!.history.entries.at(-1)!
    return place.kind === 'settings' ? place.section : undefined
  }

  it('has one tab: opening another section focuses it and shows that section, with nothing added to Back', () => {
    const general = openSettingsSection(three, 'general', { newTab: true })
    expect(shown(general)).toEqual(['a', 'b', 'settings', 'c'])
    const away = activateTab(general, idOf(general, 'a'))
    const juno = openSettingsSection(away, 'juno')
    expect(shown(juno)).toEqual(['a', 'b', 'settings', 'c'])
    expect(activeShows(juno)).toBe('settings')
    expect(sectionOf(juno)).toBe('juno')
    expect(historyTarget(juno, -1)).toBeUndefined()
  })

  it('reads back old Preferences, Notifications, Settings › Juno and Connections tabs as the one Settings tab at their section', () => {
    const saved = {
      tabs: [
        { id: 'tab-1', pinned: false, place: { kind: 'topic', topicId: 'a' } },
        { id: 'tab-2', pinned: false, place: { kind: 'junoPage', page: 'connections' } },
        { id: 'tab-3', pinned: false, place: { kind: 'preferences' } },
        { id: 'tab-4', pinned: false, place: { kind: 'notifications' } },
        { id: 'tab-5', pinned: false, place: { kind: 'junoPage', page: 'activity' } },
      ],
      active: 'tab-4',
      recent: ['tab-4', 'tab-2'],
    }
    const restored = parseTabs(saved)
    expect(shown(restored)).toEqual(['a', 'settings', 'activity'])
    expect(restored.active).toBe('tab-1')
    expect(sectionOf(activateTab(restored, 'tab-2'))).toBe('connections')
    expect(sectionOf(activateTab(parseTabs({ ...saved, tabs: [{ id: 'tab-9', pinned: false, place: { kind: 'junoPage', page: 'settings' } }], active: 'tab-9' }), 'tab-9'))).toBe('juno')
    expect(sectionOf(activateTab(parseTabs({ ...saved, tabs: [saved.tabs[2]!], active: 'tab-3' }), 'tab-3'))).toBe('general')
  })
})

describe('a New chat left for a topic', () => {
  it('is replaced when empty, and kept for Back when it has a draft', () => {
    const chat = openPlace(noTabs, newChatPlace)
    expect(historyTarget(open(chat, 'a'), -1)).toBeUndefined()
    const kept = openPlace(chat, topicPlace('a'), { keepNewChat: true })
    expect(shown(kept)).toEqual(['a'])
    expect(historyTarget(kept, -1)).toEqual(newChatPlace)
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

  it('closing the last tab leaves one that shows what a new tab opens, and ⌘⇧T can still bring the closed one back', () => {
    const one = open(noTabs, 'a')
    const none = closeTab(one, one.tabs[0]!.id)
    expect(none.tabs).toEqual([])
    const chat = ensureTab(none, newTabPlace('newChat'))
    expect(shown(chat)).toEqual(['new'])
    expect(chat.active).toBe(chat.tabs[0]!.id)
    expect(chat.active).not.toBe(one.tabs[0]!.id)
    expect(shown(ensureTab(none, newTabPlace('home')))).toEqual(['home'])
    expect(shown(reopenClosedTab(chat))).toEqual(['a', 'new'])
    expect(ensureTab(three, newTabPlace('home'))).toBe(three)
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


it('acknowledges a pending thread in place, including closed history and saved view identity', () => {
  const pending = 'p:C1:client-1'
  const acknowledged = 't:C1:100.000001'
  const before = open(open(noTabs, 'm:C1'), pending)
  const after = acknowledgeTopic(before, pending, acknowledged)
  expect(after.active).toBe(before.active)
  expect(after.tabs[0]?.id).toBe(before.tabs[0]?.id)
  expect(after.tabs[0]?.history.index).toBe(before.tabs[0]?.history.index)
  expect(after.tabs[0]?.history.entries).toEqual([topicPlace('m:C1'), { kind: 'topic', topicId: acknowledged, viewId: pending }])
  expect(parseTabs(savedTabs(after)).tabs[0]?.history.entries).toEqual([{ kind: 'topic', topicId: acknowledged, viewId: pending }])
  const closed = closeTab(before, before.active!)
  const reopened = reopenClosedTab(acknowledgeTopic(closed, pending, acknowledged))
  expect(reopened.tabs[0]?.history).toEqual(after.tabs[0]?.history)
})
