import { describe, expect, it } from 'vitest'
import { closeTab, cycleTab, dividerIndex, endStealth, mountedTabs, noTabs, openTab, parseTabs, type Tabs } from '../src/tabs'

const ids = (tabs: Tabs) => tabs.tabs.map((tab) => tab.id)

/** Tabs a, b, c with b active. */
const three = openTab(openTab(openTab(openTab(noTabs, 'a'), 'b', { newTab: true }), 'c', { newTab: true }), 'b')

describe('opening', () => {
  it('the first topic opens a tab; the next ones replace it', () => {
    const one = openTab(noTabs, 'a')
    expect(one).toEqual({ tabs: [{ id: 'a', stealth: false }], active: 'a', recent: ['a'] })
    expect(openTab(one, 'b')).toEqual({ tabs: [{ id: 'b', stealth: false }], active: 'b', recent: ['b'] })
  })

  it('a new tab goes right after the current one and becomes active', () => {
    expect(ids(three)).toEqual(['a', 'b', 'c'])
    const opened = openTab(three, 'd', { newTab: true })
    expect(ids(opened)).toEqual(['a', 'b', 'd', 'c'])
    expect(opened.active).toBe('d')
    expect(opened.recent).toEqual(['d', 'b', 'c', 'a'])
  })

  it('an open topic focuses its tab instead of opening another, in either mode', () => {
    expect(openTab(three, 'c')).toEqual({ ...three, active: 'c', recent: ['c', 'b', 'a'] })
    expect(openTab(three, 'a', { newTab: true })).toEqual({ ...three, active: 'a', recent: ['a', 'b', 'c'] })
  })

  it('stealth is kept on the tab, and ends with Mark read', () => {
    const stealth = openTab(three, 'd', { stealth: true })
    expect(stealth.tabs[1]).toEqual({ id: 'd', stealth: true })
    expect(endStealth(stealth, 'd').tabs[1]).toEqual({ id: 'd', stealth: false })
    expect(endStealth(three, 'b')).toBe(three)
  })
})

describe('closing', () => {
  it('closing the active tab focuses its right neighbour, or the left one at the end', () => {
    expect(closeTab(three, 'b')).toMatchObject({ active: 'c' })
    expect(ids(closeTab(three, 'b'))).toEqual(['a', 'c'])
    const last = openTab(three, 'c')
    expect(closeTab(last, 'c')).toMatchObject({ active: 'b' })
  })

  it('closing another tab keeps the active one', () => {
    expect(closeTab(three, 'a')).toEqual({ tabs: three.tabs.slice(1), active: 'b', recent: ['b', 'c'] })
  })

  it('closing the last tab leaves none', () => {
    expect(closeTab(openTab(noTabs, 'a'), 'a')).toEqual(noTabs)
  })
})

describe('switching and mounting', () => {
  it('cycles through the strip and wraps', () => {
    expect(cycleTab(three, 1).active).toBe('c')
    expect(cycleTab(cycleTab(three, 1), 1).active).toBe('a')
    expect(cycleTab(three, -1).active).toBe('a')
  })

  it('keeps the active tab and the 4 most recent mounted', () => {
    let tabs = noTabs
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) tabs = openTab(tabs, id, { newTab: true })
    expect([...mountedTabs(tabs)]).toEqual(['g', 'f', 'e', 'd', 'c'])
    tabs = openTab(tabs, 'a')
    expect([...mountedTabs(tabs)]).toEqual(['a', 'g', 'f', 'e', 'd'])
  })
})

describe('the divider', () => {
  it('goes before the first message after the read pointer', () => {
    const order = ['1.000001', '1.000002', '1.000003']
    expect(dividerIndex(order, '1.000001')).toBe(1)
    expect(dividerIndex(order, '1.000003')).toBe(-1)
    expect(dividerIndex(order, undefined)).toBe(-1)
  })
})

describe('saved tabs', () => {
  it('read back as they were saved, stealth included', () => {
    const saved = { tabs: [{ id: 'a', stealth: false }, { id: 'b', stealth: true }], active: 'b', recent: ['b', 'a'] }
    expect(parseTabs(JSON.parse(JSON.stringify(saved)))).toEqual(saved)
  })

  it('anything unreadable is no tabs, and a lost active tab falls back to the first', () => {
    expect(parseTabs(null)).toEqual(noTabs)
    expect(parseTabs({ tabs: 'nope' })).toEqual(noTabs)
    expect(parseTabs({ tabs: [{ id: 'a', stealth: false }], active: 'gone', recent: ['gone'] })).toEqual({ tabs: [{ id: 'a', stealth: false }], active: 'a', recent: ['a'] })
  })
})
