import { describe, expect, it } from 'bun:test'
import { closeTab, expireTabs, homePlace, noTabs, openPlace, parseTabs, reopenClosedTab, savedTabs, stampViewed, tabExpiryMs, tabTopic, topicPlace, type Tabs } from '../src/tabs'

const HOUR = 60 * 60 * 1000
const DAY = tabExpiryMs['1d']
const open = (tabs: Tabs, topicId: string) => openPlace(tabs, topicPlace(topicId), { newTab: true })
const shown = (tabs: Tabs) => tabs.tabs.map((tab) => tabTopic(tab) ?? 'home')
const idOf = (tabs: Tabs, topicId: string) => tabs.tabs.find((tab) => tabTopic(tab) === topicId)!.id

/** Tabs a, b, c with c active; a viewed two days ago, b an hour ago, c now. */
const now = 10 * DAY
const three = (() => {
  const tabs = open(open(open(noTabs, 'a'), 'b'), 'c')
  return stampViewed(stampViewed(stampViewed(tabs, [idOf(tabs, 'a')], now - 2 * DAY), [idOf(tabs, 'b')], now - HOUR), [idOf(tabs, 'c')], now)
})()

describe('tab expiry', () => {
  it('closes tabs not viewed in the time, onto the reopen stack', () => {
    const swept = expireTabs(three, now, DAY)
    expect(shown(swept)).toEqual(['b', 'c'])
    expect(swept.closed.map((closed) => tabTopic(closed.tab))).toEqual(['a'])
    expect(shown(reopenClosedTab(swept))).toEqual(['a', 'b', 'c'])
  })

  it('keeps the active tab however old', () => {
    const activeOld = stampViewed(three, [idOf(three, 'c')], now - 5 * DAY)
    expect(shown(expireTabs(activeOld, now, DAY))).toEqual(['b', 'c'])
  })

  it('keeps a tab with an unsent draft', () => {
    const swept = expireTabs(three, now, DAY, (tab) => tabTopic(tab) === 'a')
    expect(swept).toBe(three)
  })

  it('with Never closes nothing', () => {
    expect(expireTabs(three, now + 100 * DAY, tabExpiryMs.never)).toBe(three)
  })

  it('gives a tab saved without a time the full time from now', () => {
    const unstamped = openPlace(open(noTabs, 'a'), homePlace, { newTab: true })
    const swept = expireTabs(unstamped, now, DAY)
    expect(shown(swept)).toEqual(['a', 'home'])
    expect(swept.tabs.every((tab) => tab.lastViewedAt === now)).toBe(true)
  })

  it('leaves no tab only when the strip was empty: the active tab always stays', () => {
    const one = expireTabs(closeTab(closeTab(three, idOf(three, 'a')), idOf(three, 'b')), now + 9 * DAY, DAY)
    expect(shown(one)).toEqual(['c'])
  })

  it('the time is saved with the tabs and read back', () => {
    expect(parseTabs(JSON.parse(JSON.stringify(savedTabs(three)))).tabs.map((tab) => tab.lastViewedAt)).toEqual([now - 2 * DAY, now - HOUR, now])
  })
})
