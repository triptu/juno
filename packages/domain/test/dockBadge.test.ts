import { expect, it } from 'vitest'
import { defaultNotificationSettings, dockBadgeActive, type BadgeTopic } from '../src/index'

const topics: ReadonlyArray<BadgeTopic> = [
  { id: 'm:D1', channel: 'D1', kind: 'im', person: 'U1', mentionsMe: false },
  { id: 'm:G1', channel: 'G1', kind: 'mpim', person: null, mentionsMe: false },
  { id: 'm:C1', channel: 'C1', kind: 'public', person: null, mentionsMe: true },
  { id: 't:C1:1', channel: 'C1', kind: 'public', person: null, mentionsMe: true },
  { id: 'm:C2', channel: 'C2', kind: 'private', person: null, mentionsMe: false },
]

it('badges unread DMs, group DMs and mentions, and ignores other channel activity', () => {
  for (const topic of topics.slice(0, 4)) expect(dockBadgeActive([topic], defaultNotificationSettings)).toBe(true)
  expect(dockBadgeActive(topics.slice(4), defaultNotificationSettings)).toBe(false)
  expect(dockBadgeActive([], defaultNotificationSettings)).toBe(false)
})

it('applies Never to threads, conversations and DM people, with Every message winning', () => {
  const settings = { ...defaultNotificationSettings, channels: { C1: 'never' as const, G1: 'never' as const }, people: { U1: 'never' as const } }
  expect(dockBadgeActive(topics, settings)).toBe(false)
  expect(dockBadgeActive(topics, { ...settings, threads: { 't:C1:1': 'every' }, channels: { ...settings.channels, D1: 'every' } })).toBe(true)
})

it('keeps Slack-muted conversations out of the dock badge', () => {
  expect(dockBadgeActive(topics, defaultNotificationSettings, new Set(['D1', 'G1', 'C1']))).toBe(false)
})
