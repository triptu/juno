import { describe, expect, it } from 'vitest'
import { channelMenuItems, tabMenuItems, topicMenuItems, type MenuItem, type TopicMenuState } from '../src/index'
import { eng, group, maya } from './fixtures'

const labels = (items: ReadonlyArray<MenuItem<string>>) => items.map((i) => (i.type === 'separator' ? '—' : i.label))

const base: TopicMenuState = {
  kind: 'thread',
  channel: eng,
  unread: false,
  pinned: false,
  resolved: false,
}

describe('topic row menu', () => {
  it('lists the actions from spec section 5 in order', () => {
    expect(labels(topicMenuItems(base))).toEqual([
      'Open in new tab',
      '—',
      'Rename',
      'Mark as unread',
      'Pin',
      'Resolve',
      '—',
      'Copy Slack link',
      'Ignore #eng',
    ])
  })

  it('flips the toggles by state', () => {
    expect(labels(topicMenuItems({ ...base, unread: true, pinned: true, resolved: true }))).toEqual([
      'Open in new tab',
      '—',
      'Rename',
      'Mark as read',
      'Unpin',
      'Reopen',
      '—',
      'Copy Slack link',
      'Ignore #eng',
    ])
  })

  it('has no Rename for Main, and no Ignore for DMs', () => {
    const main = labels(topicMenuItems({ ...base, kind: 'main' }))
    expect(main).not.toContain('Rename')
    expect(labels(topicMenuItems({ ...base, channel: maya }))).not.toContain('Ignore Maya Chen')
    expect(labels(topicMenuItems({ ...base, channel: group })).at(-1)).toBe('Copy Slack link')
  })

  it('carries the hints and ids the shell needs', () => {
    const items = topicMenuItems(base)
    expect(items[0]).toEqual({ type: 'item', id: 'open-new-tab', label: 'Open in new tab', hint: '⌘ click' })
  })
})

describe('channel menu', () => {
  it('lists the Browse actions and hides Ignore for DMs', () => {
    expect(labels(channelMenuItems({ channel: eng, hasMain: true }))).toEqual([
      'Show its topics',
      'Open Main',
      '—',
      'Mark channel as read',
      'Mark channel as unread',
      '—',
      'Ignore channel',
    ])
    expect(labels(channelMenuItems({ channel: maya, hasMain: true }))).toEqual(['Show its topics', 'Open Main', '—', 'Mark channel as read', 'Mark channel as unread'])
    expect(labels(channelMenuItems({ channel: eng, hasMain: false }))).not.toContain('Open Main')
  })
})

describe('tab menu', () => {
  it('gives topic tabs the row menu and page tabs nothing', () => {
    expect(tabMenuItems({ kind: 'topic', topic: base })).toEqual(topicMenuItems(base))
    expect(tabMenuItems({ kind: 'all-topics' })).toEqual([])
  })
})
