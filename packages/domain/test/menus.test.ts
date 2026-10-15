import { describe, expect, it } from 'vitest'
import { channelMenuItems, personMenuItems, followsThread, notifyChoiceOf, tabMenuItems, threadNotifyChoice, topicMenuItems, type MenuItem, type TopicMenuState } from '../src/index'
import { eng, group, maya } from './fixtures'

const labels = (items: ReadonlyArray<MenuItem<string>>) => items.map((i) => (i.type === 'separator' ? '—' : i.label))

const base: TopicMenuState = {
  kind: 'thread',
  channel: eng,
  unread: false,
  pinned: false,
  resolved: false,
  notify: 'matters',
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
      'Open in Slack',
      'Notify me',
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
      'Open in Slack',
      'Notify me',
      'Ignore #eng',
    ])
  })

  it('has no Rename or Notify me for Main, and no Ignore for DMs', () => {
    const main = labels(topicMenuItems({ ...base, kind: 'main' }))
    expect(main).not.toContain('Rename')
    expect(main).not.toContain('Notify me')
    expect(labels(topicMenuItems({ ...base, channel: maya }))).not.toContain('Ignore Maya Chen')
    expect(labels(topicMenuItems({ ...base, channel: group })).at(-1)).toBe('Notify me')
  })

  it('offers the three Notify me choices with the current one checked and named in the hint', () => {
    const notify = topicMenuItems({ ...base, notify: threadNotifyChoice(false) }).find((i) => i.type === 'submenu')
    expect(notify).toEqual({
      type: 'submenu',
      label: 'Notify me',
      hint: 'Never',
      items: [
        { type: 'item', id: 'notify-every', label: 'Every message', checked: false },
        { type: 'item', id: 'notify-matters', label: 'When it matters', checked: false },
        { type: 'item', id: 'notify-never', label: 'Never', checked: true },
      ],
    })
  })

  it('carries the hints and ids the shell needs', () => {
    const items = topicMenuItems(base)
    expect(items[0]).toEqual({ type: 'item', id: 'open-new-tab', label: 'Open in new tab', hint: '⌘ click' })
  })
})

describe('Notify me on a thread', () => {
  it('follows the thread for Every message and When it matters, and unfollows it for Never', () => {
    expect(followsThread(notifyChoiceOf('notify-every'))).toBe(true)
    expect(followsThread(notifyChoiceOf('notify-matters'))).toBe(true)
    expect(followsThread(notifyChoiceOf('notify-never'))).toBe(false)
  })

  it('shows a followed thread as When it matters and one you do not follow as Never', () => {
    expect(threadNotifyChoice(true)).toBe('matters')
    expect(threadNotifyChoice(false)).toBe('never')
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

  it('ends with Ask Juno while the Juno Agent is on', () => {
    expect(labels(channelMenuItems({ channel: maya, hasMain: true, askJuno: true })).slice(-2)).toEqual(['—', 'Ask Juno'])
    expect(labels(channelMenuItems({ channel: eng, hasMain: true, askJuno: false }))).not.toContain('Ask Juno')
  })
})

describe('person menu', () => {
  it('offers Ask Juno only while the Juno Agent is on', () => {
    expect(labels(personMenuItems({ askJuno: true }))).toEqual(['Ask Juno'])
    expect(personMenuItems({ askJuno: false })).toEqual([])
  })
})

describe('tab menu', () => {
  it('gives topic tabs the row menu and page tabs nothing', () => {
    expect(tabMenuItems({ kind: 'topic', topic: base })).toEqual(topicMenuItems(base))
    expect(tabMenuItems({ kind: 'all-topics' })).toEqual([])
  })
})
