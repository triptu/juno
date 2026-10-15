import { describe, expect, it } from 'vitest'
import {
  closeTab,
  historyTarget,
  homePlace,
  noTabs,
  openPlace,
  parseTabs,
  reopenClosedTab,
  savedTabs,
  setJunoPanel,
  setPinned,
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

/** Tabs a, b, c with b active. */
const three = open(open(open(open(noTabs, 'a'), 'b', { newTab: true }), 'c', { newTab: true }), 'b')

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

describe('the Juno panel per tab', () => {
  it('opens in one tab, stays closed in the others, and survives a switch, a close and reopen, and a save', () => {
    const two = open(open(noTabs, 'a'), 'b', { newTab: true })
    const [a, b] = two.tabs.map((tab) => tab.id)
    const opened = setJunoPanel(two, a!, true)
    const panelOf = (tabs: Tabs, id: string) => tabs.tabs.find((tab) => tab.id === id)?.junoPanel === true
    expect(panelOf(opened, a!)).toBe(true)
    expect(panelOf(opened, b!)).toBe(false)
    expect(setJunoPanel(opened, a!, true)).toBe(opened)
    const reopened = reopenClosedTab(closeTab(opened, a!))
    expect(panelOf(reopened, a!)).toBe(true)
    const restored = parseTabs(JSON.parse(JSON.stringify(savedTabs(opened))))
    expect(panelOf(restored, a!)).toBe(true)
    expect(panelOf(restored, b!)).toBe(false)
    expect(panelOf(setJunoPanel(opened, a!, false), a!)).toBe(false)
  })
})
