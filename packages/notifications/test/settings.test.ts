// The notification settings as this build and older ones stored them. The
// rest of the pipeline runs against the fake Slack in
// engine/test/flows/notifications.flow.test.ts.
import { expect, it } from 'bun:test'
import { defaultNotificationSettings, type Hours } from '@juno/domain'
import { settingsOf } from '../src/settings'

const hours: Hours = { days: [1, 2, 3, 4, 5], from: 540, to: 1080 }

it('reads levels stored before Always and Auto as they are now: every is Always, matters is Auto', () => {
  const settings = settingsOf({
    notificationHours: hours, presenceHours: hours,
    channels: { C1: 'every', C2: 'matters', C3: 'never', C4: 'always' },
    people: { U1: 'every', U2: 'matters' },
    threads: { 't:C1:1.000001': 'matters', 't:C1:2.000001': 'never' },
    matters: 'Anything about the launch',
  })
  expect(settings).toMatchObject({
    notificationHours: hours,
    channels: { C1: 'always', C3: 'never', C4: 'always' },
    people: { U1: 'always' },
    threads: { 't:C1:2.000001': 'never' },
  })
  expect(settings.channels).not.toHaveProperty('C2')
})

it('reads hours saved before 2026-10-27 as the ones every install started with as never set, and any others as set; since then, hours stored are as set', () => {
  const starting: Hours = { days: [1, 2, 3, 4, 5], from: 540, to: 1140 }
  expect(settingsOf({ notificationHours: starting, presenceHours: hours, channels: {}, people: {} })).toEqual({ presenceHours: hours, channels: {}, people: {} })
  expect(settingsOf({ notificationHours: starting, presenceHours: starting, channels: {}, people: {}, hoursAsSet: true })).toEqual({ notificationHours: starting, presenceHours: starting, channels: {}, people: {} })
})

it.each<[string, unknown]>([
  ['nothing stored', undefined],
  ['hours out of range', { ...defaultNotificationSettings, notificationHours: { days: [1], from: 0, to: 1440 } }],
  // An unknown level reads as Auto, which is no stored level.
  ['levels this build does not know', { ...defaultNotificationSettings, channels: { C1: 'loud' }, people: { U1: 'sometimes' } }],
  ['not settings at all', 'on'],
])('uses the defaults for %s', (_, stored) => {
  expect(settingsOf(stored)).toEqual(defaultNotificationSettings)
})
