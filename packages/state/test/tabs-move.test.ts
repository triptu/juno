import { describe, expect, it } from 'vitest'
import { moveTab, noTabs, openPlace, parseTabs, savedTabs, setPinned, tabTopic, topicPlace, type Tabs } from '../src/tabs'

const open = (tabs: Tabs, topicId: string, newTab = false) => openPlace(tabs, topicPlace(topicId), { newTab })
const shown = (tabs: Tabs) => tabs.tabs.map((tab) => tabTopic(tab))
const activeShows = (tabs: Tabs) => tabTopic(tabs.tabs.find((tab) => tab.id === tabs.active)!)
const idOf = (tabs: Tabs, topicId: string) => tabs.tabs.find((tab) => tabTopic(tab) === topicId)!.id

/** Tabs a, b, c with b active. */
const three = open(open(open(open(noTabs, 'a'), 'b', true), 'c', true), 'b')

describe('moving', () => {
  it('moves a tab to another place, keeping the active tab and the history', () => {
    const tabs = moveTab(three, idOf(three, 'c'), 0)
    expect(shown(tabs)).toEqual(['c', 'a', 'b'])
    expect(activeShows(tabs)).toBe('b')
    expect(tabs.tabs[0]).toBe(three.tabs[2])
    expect(shown(moveTab(tabs, idOf(tabs, 'c'), 2))).toEqual(['a', 'b', 'c'])
  })

  it('moving to where the tab is, or an unknown tab, changes nothing', () => {
    expect(moveTab(three, idOf(three, 'b'), 1)).toBe(three)
    expect(moveTab(three, 'tab-99', 0)).toBe(three)
  })

  it('clamps to the ends of the strip', () => {
    expect(shown(moveTab(three, idOf(three, 'a'), 9))).toEqual(['b', 'c', 'a'])
    expect(shown(moveTab(three, idOf(three, 'c'), -4))).toEqual(['c', 'a', 'b'])
  })

  it('keeps pinned tabs first and unpinned tabs after them', () => {
    const pinned = setPinned(setPinned(three, idOf(three, 'a'), true), idOf(three, 'b'), true)
    expect(shown(pinned)).toEqual(['a', 'b', 'c'])
    // An unpinned tab stops at the first unpinned place.
    expect(moveTab(pinned, idOf(pinned, 'c'), 0)).toBe(pinned)
    // A pinned tab moves among the pinned ones and stops at the last of them.
    expect(shown(moveTab(pinned, idOf(pinned, 'a'), 2))).toEqual(['b', 'a', 'c'])
    expect(shown(moveTab(pinned, idOf(pinned, 'b'), 0))).toEqual(['b', 'a', 'c'])
  })

  it('the new order is saved and read back', () => {
    const moved = moveTab(three, idOf(three, 'c'), 0)
    expect(shown(parseTabs(JSON.parse(JSON.stringify(savedTabs(moved)))))).toEqual(['c', 'a', 'b'])
  })
})
