import { describe, expect, it } from 'vitest'
import {
  allTopicsList,
  canResolveOnHover,
  filterDots,
  rowTags,
  showsReopenedTag,
  showsResolvedCheck,
  sidebarEmptyState,
  sidebarList,
  sidebarPlacement,
  topicStatus,
  type RuleContext,
} from '../src/index'
import { DAY, HOUR, NOW, alerts, eng, group, hiring, maya, topic, ts } from './fixtures'

const ctx: RuleContext = { now: NOW }

describe('topic status', () => {
  it.each([
    ['active and untouched', topic({ ago: HOUR }), 'open'],
    ['no activity for 8 days', topic({ ago: 8 * DAY }), 'quiet'],
    ['no activity for 6 days', topic({ ago: 6 * DAY }), 'open'],
    ['8 days old but unread', topic({ ago: 8 * DAY, unread: 2 }), 'open'],
    ['8 days old but pinned', topic({ ago: 8 * DAY, overlay: { pinnedAt: NOW } }), 'open'],
    ['resolved with no new activity', topic({ ago: HOUR, overlay: { resolvedAt: NOW - 1, resolvedActivityTs: ts(NOW - HOUR) } }), 'resolved'],
    ['resolved, then a new message', topic({ ago: HOUR, overlay: { resolvedAt: NOW - DAY, resolvedActivityTs: ts(NOW - DAY) } }), 'open'],
    ['unsubscribed', topic({ ago: HOUR, overlay: { unsubscribedAt: NOW } }), 'unsubscribed'],
    ['unsubscribed and resolved', topic({ overlay: { unsubscribedAt: NOW, resolvedAt: NOW, resolvedActivityTs: ts(NOW - HOUR) } }), 'unsubscribed'],
    ['in an ignored channel', topic({ channel: alerts, unread: 3 }), 'ignored'],
    ['a Main with no recent activity', topic({ kind: 'main', ago: 10 * DAY }), 'quiet'],
  ] as const)('%s → %s', (_name, t, expected) => {
    expect(topicStatus(t, ctx)).toBe(expected)
  })

  it('uses the configured quiet window, capped at 14 days', () => {
    const tenDays = topic({ ago: 10 * DAY })
    expect(topicStatus(tenDays, { now: NOW, quietDays: 14 })).toBe('open')
    expect(topicStatus(tenDays, { now: NOW, quietDays: 7 })).toBe('quiet')
    expect(topicStatus(topic({ ago: 20 * DAY }), { now: NOW, quietDays: 30 })).toBe('quiet')
  })
})

describe('reopened tag', () => {
  it('shows after activity follows a resolve, and after the engine sets reopenedAt', () => {
    expect(showsReopenedTag(topic({ ago: HOUR, overlay: { resolvedAt: NOW - DAY, resolvedActivityTs: ts(NOW - DAY) } }))).toBe(true)
    expect(showsReopenedTag(topic({ ago: HOUR, overlay: { reopenedAt: NOW - HOUR } }))).toBe(true)
  })

  it('does not show on open, resolved or fresh topics', () => {
    expect(showsReopenedTag(topic())).toBe(false)
    expect(showsReopenedTag(topic({ overlay: { resolvedAt: NOW, resolvedActivityTs: ts(NOW - HOUR) } }))).toBe(false)
  })

  it('is listed after Main in the row tags', () => {
    expect(rowTags(topic({ kind: 'main', overlay: { reopenedAt: NOW, unsubscribedAt: NOW } }))).toEqual(['main', 'reopened', 'unsubscribed'])
    expect(rowTags(topic())).toEqual([])
  })
})

describe('sidebar placement', () => {
  it('shows open topics in Recent', () => {
    expect(sidebarPlacement(topic(), ctx)).toBe('recent')
  })

  it('hides quiet, resolved and unsubscribed topics', () => {
    expect(sidebarPlacement(topic({ ago: 9 * DAY }), ctx)).toBe('hidden')
    expect(sidebarPlacement(topic({ overlay: { resolvedAt: NOW, resolvedActivityTs: ts(NOW - HOUR) } }), ctx)).toBe('hidden')
    expect(sidebarPlacement(topic({ overlay: { unsubscribedAt: NOW } }), ctx)).toBe('hidden')
  })

  it('brings a quiet topic back when it is marked unread', () => {
    expect(sidebarPlacement(topic({ ago: 9 * DAY, unread: 1 }), ctx)).toBe('recent')
  })

  it('keeps every pinned topic in Pinned, even quiet or resolved', () => {
    expect(sidebarPlacement(topic({ overlay: { pinnedAt: NOW } }), ctx)).toBe('pinned')
    expect(sidebarPlacement(topic({ ago: 20 * DAY, overlay: { pinnedAt: NOW } }), ctx)).toBe('pinned')
    const pinnedResolved = topic({ overlay: { pinnedAt: NOW, resolvedAt: NOW, resolvedActivityTs: ts(NOW - HOUR) } })
    expect(sidebarPlacement(pinnedResolved, ctx)).toBe('pinned')
    expect(showsResolvedCheck(pinnedResolved, ctx)).toBe(true)
    expect(canResolveOnHover(pinnedResolved)).toBe(false)
    expect(showsResolvedCheck(topic({ overlay: { pinnedAt: NOW } }), ctx)).toBe(false)
  })

  it('never shows ignored channels, pinned or not', () => {
    expect(sidebarPlacement(topic({ channel: alerts, overlay: { pinnedAt: NOW } }), ctx)).toBe('hidden')
  })
})

describe('sidebar list', () => {
  const t1 = topic({ ago: 5 * HOUR })
  const t2 = topic({ ago: HOUR, channel: hiring })
  const dm = topic({ ago: 2 * HOUR, channel: maya, kind: 'main', unread: 1 })
  const mpim = topic({ ago: 3 * HOUR, channel: group, kind: 'main' })
  const pinnedOld = topic({ ago: 3 * DAY, channel: eng, kind: 'main', overlay: { pinnedAt: NOW } })
  const quiet = topic({ ago: 10 * DAY, channel: hiring, kind: 'main' })
  const all = [t1, t2, dm, mpim, pinnedOld, quiet]

  it('puts Pinned first, then Recent by latest activity', () => {
    const list = sidebarList(all, { kind: 'all', unreadOnly: false }, ctx)
    expect(list.pinned.map((t) => t.id)).toEqual([pinnedOld.id])
    expect(list.recent.map((t) => t.id)).toEqual([t2.id, dm.id, mpim.id, t1.id])
  })

  it('filters by Channels and DMs, where DMs include group DMs', () => {
    expect(sidebarList(all, { kind: 'channels', unreadOnly: false }, ctx).recent.map((t) => t.id)).toEqual([t2.id, t1.id])
    expect(sidebarList(all, { kind: 'dms', unreadOnly: false }, ctx).recent.map((t) => t.id)).toEqual([dm.id, mpim.id])
    expect(sidebarList(all, { kind: 'dms', unreadOnly: false }, ctx).pinned).toEqual([])
  })

  it('shows only unread with the Unread toggle, including pinned rows', () => {
    const list = sidebarList(all, { kind: 'all', unreadOnly: true }, ctx)
    expect(list.recent.map((t) => t.id)).toEqual([dm.id])
    expect(list.pinned).toEqual([])
  })

  it('narrows to one channel with a scope', () => {
    const list = sidebarList(all, { kind: 'all', unreadOnly: false, scope: hiring.id }, ctx)
    expect(list.recent.map((t) => t.id)).toEqual([t2.id])
  })

  it('shows a dot next to the group with unread topics that is not selected', () => {
    expect(filterDots(all, { kind: 'all', unreadOnly: false }, ctx)).toEqual({ channels: false, dms: true })
    expect(filterDots(all, { kind: 'dms', unreadOnly: false }, ctx)).toEqual({ channels: false, dms: false })
    expect(filterDots([...all, topic({ unread: 2 })], { kind: 'dms', unreadOnly: false }, ctx)).toEqual({ channels: true, dms: false })
  })

  it('explains an empty list and offers one next step', () => {
    const empty = { pinned: [], recent: [] }
    expect(sidebarEmptyState(empty, { kind: 'all', unreadOnly: true }, ctx)).toMatchObject({ title: 'No unread topics', actionLabel: 'Clear filters' })
    expect(sidebarEmptyState(empty, { kind: 'dms', unreadOnly: false }, ctx)).toMatchObject({ title: 'No recent topics here', actionLabel: 'Clear filters' })
    expect(sidebarEmptyState(empty, { kind: 'all', unreadOnly: false }, ctx)).toMatchObject({
      title: 'No recent topics here',
      body: 'Topics with activity in the last 7 days show up here.',
      actionLabel: 'View all topics',
    })
    expect(sidebarEmptyState(sidebarList(all, { kind: 'all', unreadOnly: false }, ctx), { kind: 'all', unreadOnly: false }, ctx)).toBeUndefined()
  })
})

describe('All topics', () => {
  const open = topic({ ago: HOUR, messages: 3, firstMessageText: 'Postgres 16 migration plan' })
  const resolved = topic({ ago: 2 * HOUR, messages: 9, channel: hiring, overlay: { resolvedAt: NOW, resolvedActivityTs: ts(NOW - 2 * HOUR) } })
  const quiet = topic({ ago: 20 * DAY, messages: 1, channel: maya, kind: 'main' })
  const unsubscribed = topic({ ago: 3 * HOUR, messages: 30, overlay: { unsubscribedAt: NOW, aiTitle: 'Pricing page copy' } })
  const ignored = topic({ channel: alerts })
  const all = [open, resolved, quiet, unsubscribed, ignored]

  it('lists everything except ignored channels, with status counts', () => {
    const list = allTopicsList(all, { status: 'all', kind: 'all', sort: 'recent' }, ctx)
    expect(list.counts).toEqual({ all: 4, open: 1, resolved: 1, quiet: 1, unsubscribed: 1 })
    expect(list.rows.map((r) => [r.topic.id, r.status])).toEqual([
      [open.id, 'open'],
      [resolved.id, 'resolved'],
      [unsubscribed.id, 'unsubscribed'],
      [quiet.id, 'quiet'],
    ])
  })

  it('filters by status chip', () => {
    expect(allTopicsList(all, { status: 'resolved', kind: 'all', sort: 'recent' }, ctx).rows.map((r) => r.topic.id)).toEqual([resolved.id])
  })

  it('sorts oldest first and by most messages', () => {
    expect(allTopicsList(all, { status: 'all', kind: 'all', sort: 'oldest' }, ctx).rows.map((r) => r.topic.id)).toEqual([quiet.id, unsubscribed.id, resolved.id, open.id])
    expect(allTopicsList(all, { status: 'all', kind: 'all', sort: 'messages' }, ctx).rows.map((r) => r.topic.id)).toEqual([unsubscribed.id, resolved.id, open.id, quiet.id])
  })

  it('filters by kind, channel and text; counts follow those filters', () => {
    expect(allTopicsList(all, { status: 'all', kind: 'dms', sort: 'recent' }, ctx).rows.map((r) => r.topic.id)).toEqual([quiet.id])
    expect(allTopicsList(all, { status: 'all', kind: 'all', scope: hiring.id, sort: 'recent' }, ctx).counts.all).toBe(1)
    const byText = allTopicsList(all, { status: 'all', kind: 'all', sort: 'recent', query: 'pricing' }, ctx)
    expect(byText.rows.map((r) => r.topic.id)).toEqual([unsubscribed.id])
    expect(byText.counts).toEqual({ all: 1, open: 0, resolved: 0, quiet: 0, unsubscribed: 1 })
    expect(allTopicsList(all, { status: 'all', kind: 'all', sort: 'recent', query: 'postgres' }, ctx).rows.map((r) => r.topic.id)).toEqual([open.id])
  })
})
