// Set me away outside active hours (SPEC 14, "Active hours"): the presence service on a real store with Effect's
// TestClock against the fake Slack. The hours, a choice by hand and wakes with the switch on are
// notifications.flow.test.ts.
import { itEffect } from '@juno/testing/effect'
import { expect } from 'bun:test'
import { AiProvider, makeFakeAiProvider } from '@juno/ai'
import { defaultNotificationSettings, type NotificationSettings } from '@juno/domain'
import { makeNotifications, saveSettings, type Notifier } from '@juno/notifications'
import { SlackApi } from '@juno/slack'
import { prefs, transaction } from '@juno/store'
import { Effect, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import { clientLayer, fakeSlack } from '../../../slack/test/helpers'
import { freshStore } from '../../../store/test/helpers'

// Active Monday to Friday 9 to 7.
const settings: NotificationSettings = { ...defaultNotificationSettings, presenceHours: { days: [1, 2, 3, 4, 5], from: 540, to: 1140 } }
const monday = (hour: number) => new Date(2026, 9, 12, hour).getTime()
const notifier: Notifier = { show: () => Effect.void, viewing: () => Effect.succeed(false) }

itEffect('active hours set the owner away only while the switch is on; turning it off sets them active once unless a choice by hand holds, and settings from before the switch hand presence back once', () => Effect.gen(function* () {
  const fake = yield* fakeSlack
  yield* Effect.gen(function* () {
    const api = yield* SlackApi
    const setPresence = (presence: 'active' | 'away') => api.call('presence.set', { presence }).pipe(Effect.as(true), Effect.catch(() => Effect.succeed(false)))
    // Settled: each tick, wake and set returns after its presence.set answered.
    const sent = () => fake.calls.filter((call) => call.method === 'presence.set').map((call) => call.args['presence'])
    yield* TestClock.setTime(monday(20))
    yield* saveSettings(settings)
    const service = yield* makeNotifications(notifier, setPresence)
    yield* service.wake
    yield* service.tick
    expect(sent()).toEqual([])

    yield* saveSettings({ ...settings, awayOutsideHours: true })
    yield* service.settingsChanged
    expect(sent()).toEqual(['away'])

    yield* saveSettings(settings)
    yield* service.settingsChanged
    yield* service.wake
    expect(sent()).toEqual(['away', 'active'])
    expect(yield* service.currentPresence).toBe('active')

    // Away by hand inside the hours stays when the switch goes off.
    yield* TestClock.setTime(monday(12))
    yield* saveSettings({ ...settings, awayOutsideHours: true })
    yield* service.settingsChanged
    expect(yield* service.setPresence('away')).toBe(true)
    yield* saveSettings(settings)
    yield* service.settingsChanged
    yield* service.wake
    expect(sent()).toEqual(['away', 'active', 'away'])

    // Saved before the switch, with active hours Juno set the owner away by: a new session sets them active once.
    yield* transaction(prefs.set('notifications', { ...settings, hoursAsSet: true }))
    yield* transaction(prefs.set('presenceHold', null))
    yield* TestClock.setTime(monday(20))
    yield* (yield* makeNotifications(notifier, setPresence)).tick
    yield* (yield* makeNotifications(notifier, setPresence)).wake
    expect(sent()).toEqual(['away', 'active', 'away', 'active'])
  }).pipe(Effect.provide(clientLayer(fake, { lanes: { backgroundMinIntervalMillis: 0 } })))
}).pipe(Effect.provide(Layer.merge(freshStore, Layer.succeed(AiProvider, makeFakeAiProvider())))))
