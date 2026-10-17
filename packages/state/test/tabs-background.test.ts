import { describe, expect, it } from 'vitest'
import { noTabs, openPlace, tabTopic, topicPlace, type OpenOptions, type Tabs } from '../src/tabs'

const open = (tabs: Tabs, topicId: string, options?: OpenOptions) => openPlace(tabs, topicPlace(topicId), options)
const shown = (tabs: Tabs) => tabs.tabs.map((tab) => tabTopic(tab))

/** Tabs a, b, c with b active. */
const three = open(open(open(open(noTabs, 'a'), 'b', { newTab: true }), 'c', { newTab: true }), 'b')

describe('a background tab', () => {
  it('goes right after the current one, which stays active and keeps its place among the recent tabs', () => {
    const opened = open(three, 'd', { newTab: true, background: true })
    expect(shown(opened)).toEqual(['a', 'b', 'd', 'c'])
    expect(opened.active).toBe(three.active)
    expect(opened.recent).toEqual(three.recent)
  })

  it('opens even when another tab shows the topic', () => {
    const opened = open(three, 'c', { newTab: true, background: true })
    expect(shown(opened)).toEqual(['a', 'b', 'c', 'c'])
    expect(opened.active).toBe(three.active)
  })

  it('goes right after the tab it is opened from, when that is not the active one', () => {
    const first = three.tabs[0]!.id
    const opened = open(three, 'd', { newTab: true, background: true, after: first })
    expect(shown(opened)).toEqual(['a', 'd', 'b', 'c'])
    expect(opened.active).toBe(three.active)
  })
})
