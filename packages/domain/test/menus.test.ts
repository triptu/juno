import { describe, expect, it } from 'bun:test'
import { channelMenuItems, followsThread, notifyChoiceOf, personMenuItems, tabMenuItems, threadNotifyChoice, topicMenuItems, type MenuItem, type TopicMenuState } from '../src/index'
import { eng, group, maya } from './fixtures'

const labels = (items: ReadonlyArray<MenuItem<string>>) => items.map((i) => (i.type === 'separator' ? '—' : i.label))

const base: TopicMenuState = {
  kind: 'thread',
  channel: eng,
  unread: false,
  pinned: false,
  resolved: false,
  notify: 'auto',
  canDraw: true,
}

describe('topic row menu', () => {
  it('lists the actions from spec section 5 in order', () => {
    expect(labels(topicMenuItems(base))).toEqual([
      'Open in new tab',
      '—',
      'Rename',
      'Redraw art',
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
      'Redraw art',
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

  it("puts a channel's huddle item after Open in new tab", () => {
    expect(labels(topicMenuItems({ ...base, huddle: 'start' })).slice(0, 3)).toEqual(['Open in new tab', 'Start huddle', '—'])
    expect(labels(topicMenuItems({ ...base, huddle: 'join' }))[1]).toBe('Join huddle')
  })

  it('has no Rename for Main, and no Ignore for DMs', () => {
    const main = labels(topicMenuItems({ ...base, kind: 'main' }))
    expect(main).not.toContain('Rename')
    expect(main).toContain('Notify me')
    expect(labels(topicMenuItems({ ...base, channel: maya }))).not.toContain('Ignore Maya Chen')
    expect(labels(topicMenuItems({ ...base, channel: group })).at(-1)).toBe('Notify me')
  })

  it('offers Redraw art only when a drawing can be made, and never on a DM Main, which shows the person', () => {
    expect(labels(topicMenuItems({ ...base, canDraw: false }))).not.toContain('Redraw art')
    expect(labels(topicMenuItems({ ...base, kind: 'main' }))).toContain('Redraw art')
    expect(labels(topicMenuItems({ ...base, channel: maya }))).toContain('Redraw art')
    expect(labels(topicMenuItems({ ...base, kind: 'main', channel: maya }))).not.toContain('Redraw art')
    expect(labels(topicMenuItems({ ...base, kind: 'main', channel: group }))).not.toContain('Redraw art')
  })

  it('offers the three Notify me choices with the current one checked and named in the hint', () => {
    const notify = topicMenuItems({ ...base, notify: threadNotifyChoice(false) }).find((i) => i.type === 'submenu')
    expect(notify?.type === 'submenu' ? { ...notify, items: notify.items.slice(0, 3) } : notify).toEqual({
      type: 'submenu',
      label: 'Notify me',
      hint: 'Never',
      items: [
        { type: 'item', id: 'notify-always', label: 'Always', checked: false },
        { type: 'item', id: 'notify-auto', label: 'Auto', checked: false },
        { type: 'item', id: 'notify-never', label: 'Never', checked: true },
      ],
    })
  })

  it('offers What Juno knows about the other person of a one-to-one DM, last', () => {
    expect(labels(topicMenuItems({ ...base, kind: 'main', channel: maya, knowsAbout: 'Maya Chen' })).slice(-2)).toEqual(['—', 'What Juno knows about Maya'])
    expect(labels(topicMenuItems({ ...base, kind: 'main', channel: maya }))).not.toContain('What Juno knows about Maya')
  })

  it('carries the hints and ids the shell needs', () => {
    const items = topicMenuItems(base)
    expect(items[0]).toEqual({ type: 'item', id: 'open-new-tab', label: 'Open in new tab', hint: '⌘ click' })
  })
})

describe('How Auto decides…', () => {
  it('ends every Notify me submenu, after a separator', () => {
    const submenus = [topicMenuItems(base), channelMenuItems({ channel: eng, hasMain: true, notify: 'auto' }), personMenuItems({ name: 'Maya Chen', notify: 'auto' })].map((items) => items.find((i) => i.type === 'submenu'))
    for (const notify of submenus) expect(notify?.type === 'submenu' && notify.items.slice(3)).toEqual([{ type: 'separator' }, { type: 'item', id: 'how-auto', label: 'How Auto decides…' }])
  })
})

describe('Notify me on a thread', () => {
  it('follows the thread for Always and Auto, and unfollows it for Never', () => {
    expect(followsThread(notifyChoiceOf('notify-always'))).toBe(true)
    expect(followsThread(notifyChoiceOf('notify-auto'))).toBe(true)
    expect(followsThread(notifyChoiceOf('notify-never'))).toBe(false)
  })

  it('shows a followed thread by its level, and one you do not follow as Never', () => {
    expect(threadNotifyChoice(true)).toBe('auto')
    expect(threadNotifyChoice(true, 'always')).toBe('always')
    expect(threadNotifyChoice(false, 'always')).toBe('never')
  })
})

describe('person menu', () => {
  it('names the person by first name and checks their level', () => {
    const [notify] = personMenuItems({ name: 'Maya Chen', notify: 'always' })
    expect(notify?.type === 'submenu' && notify.label).toBe('Notify me about Maya')
    expect(notify?.type === 'submenu' && notify.items.slice(0, 3).map((item) => item.type === 'item' && item.checked)).toEqual([true, false, false])
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

  it('offers Start huddle, or Join huddle while one runs, after Open Main', () => {
    expect(labels(channelMenuItems({ channel: eng, hasMain: true, huddle: 'start' })).slice(0, 4)).toEqual(['Show its topics', 'Open Main', 'Start huddle', '—'])
    expect(labels(channelMenuItems({ channel: eng, hasMain: true, huddle: 'join' }))).toContain('Join huddle')
  })

})


describe('Juno in the menus', () => {
  it('the channel menu has Notify me with its choice, and ends with Ask Juno while the Juno Agent is on', () => {
    expect(labels(channelMenuItems({ channel: eng, hasMain: true, notify: 'never', askJuno: true }))).toEqual([
      'Show its topics',
      'Open Main',
      '—',
      'Mark channel as read',
      'Mark channel as unread',
      '—',
      'Notify me',
      'Ignore channel',
      '—',
      'Ask Juno',
    ])
    expect(labels(channelMenuItems({ channel: eng, hasMain: true, askJuno: false }))).not.toContain('Ask Juno')
  })

  it('the person menu ends with Ask Juno and What Juno knows about them while the Juno Agent is on', () => {
    expect(labels(personMenuItems({ name: 'Maya Chen', notify: 'auto', askJuno: true }))).toEqual(['Notify me about Maya', '—', 'Ask Juno', 'What Juno knows about Maya'])
    expect(labels(personMenuItems({ name: 'Maya Chen', notify: 'auto' }))).toEqual(['Notify me about Maya'])
  })
})

describe('tab menu', () => {
  it('gives topic tabs the row menu and page tabs nothing', () => {
    expect(tabMenuItems({ kind: 'topic', topic: base })).toEqual(topicMenuItems(base))
    expect(tabMenuItems({ kind: 'all-topics' })).toEqual([])
  })
})
