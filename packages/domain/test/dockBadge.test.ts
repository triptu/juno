import { expect, it } from 'vitest'
import { defaultNotificationSettings, dockBadgeActive, type BadgeTopic } from '../src/index'

const context = { aiAssist: false, at: { weekday: 1 as const, minutes: 600 } }

const topics: ReadonlyArray<BadgeTopic> = [
  { id: 'm:D1', channel: 'D1', kind: 'im', person: 'U1', mentionsMe: false },
  { id: 'm:G1', channel: 'G1', kind: 'mpim', person: null, mentionsMe: false },
  { id: 'm:C1', channel: 'C1', kind: 'public', person: null, mentionsMe: true },
  { id: 't:C1:1', channel: 'C1', kind: 'public', person: null, mentionsMe: true },
  { id: 'm:C2', channel: 'C2', kind: 'private', person: null, mentionsMe: false },
]

it('badges unread DMs, group DMs and mentions, and ignores other channel activity', () => {
  for (const topic of topics.slice(0, 4)) expect(dockBadgeActive([topic], defaultNotificationSettings, context)).toBe(true)
  expect(dockBadgeActive(topics.slice(4), defaultNotificationSettings, context)).toBe(false)
  expect(dockBadgeActive([], defaultNotificationSettings, context)).toBe(false)
})

it('applies Never to threads, conversations and DM people, with Every message winning', () => {
  const settings = { ...defaultNotificationSettings, channels: { C1: 'never' as const, G1: 'never' as const }, people: { U1: 'never' as const } }
  expect(dockBadgeActive(topics, settings, context)).toBe(false)
  expect(dockBadgeActive(topics, { ...settings, threads: { 't:C1:1': 'every' }, channels: { ...settings.channels, D1: 'every' } }, context)).toBe(true)
})

it('does not badge a kept-out DM unless it mentions the owner', () => {
  const dm = { ...topics[0]!, sidebarVisible: false }
  expect(dockBadgeActive([dm], defaultNotificationSettings, context)).toBe(false)
  expect(dockBadgeActive([{ ...dm, mentionsMe: true }], defaultNotificationSettings, context)).toBe(true)
})

it('does not treat a broadcast mention as the sidebar mention exception in a kept-out channel', () => {
  const broadcast = { ...topics[2]!, sidebarVisible: false, mentionsMeDirectly: false }
  expect(dockBadgeActive([broadcast], defaultNotificationSettings, context)).toBe(false)
})

it('applies a Never sender to a channel mention as alerts do', () => {
  const mention = { ...topics[2]!, person: 'U1' }
  expect(dockBadgeActive([mention], { ...defaultNotificationSettings, people: { U1: 'never' } }, context)).toBe(false)
})

it('includes ordinary channel messages set to Every message, using the alert decision', () => {
  expect(dockBadgeActive(topics.slice(4), { ...defaultNotificationSettings, channels: { C2: 'every' } }, context)).toBe(true)
})

it('holds a channel mention outside hours or for AI, while an unread DM in All still counts', () => {
  const outside = { ...context, at: { weekday: 0 as const, minutes: 0 } }
  expect(dockBadgeActive([topics[2]!], defaultNotificationSettings, outside)).toBe(false)
  expect(dockBadgeActive([topics[0]!], defaultNotificationSettings, outside)).toBe(true)
  const held = { ...topics[2]!, judgement: { notify: false, reason: 'Can wait' } }
  expect(dockBadgeActive([held], defaultNotificationSettings, { ...context, aiAssist: true })).toBe(false)
})
