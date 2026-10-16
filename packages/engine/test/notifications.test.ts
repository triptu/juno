import { it as effectIt } from '@effect/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { AiProvider, makeFakeAiProvider } from '@juno/ai'
import { ChannelId, UserId, defaultNotificationSettings, localTime, millisToTs, type NotificationSettings } from '@juno/domain'
import { makeNotifications, type Candidate, type Notification, type Notifier } from '@juno/notifications'
import { prefsSet } from '@juno/contract'
import { SlackApi } from '@juno/slack'
import { prefs, StoreWriter, transaction } from '@juno/store'
import { runCommand } from '@juno/state'
import { Effect, Fiber, Layer, Schema } from 'effect'
import { TestClock } from 'effect/testing'
import { clientLayer, fakeSlack } from '../../slack/test/helpers'
import { freshStore } from '../../store/test/helpers'
import { bootedEngine, readDb } from './scenario'
import { waitFor, type RunningEngine } from './harness'

function recorder() {
  const shown: Notification[] = []
  let focused = false
  const notifier: Notifier = {
    show: (notification) => Effect.sync(() => { shown.push(notification) }),
    viewing: () => Effect.sync(() => focused),
  }
  return { shown, notifier, focus: (value: boolean) => { focused = value } }
}
const settings: NotificationSettings = { ...defaultNotificationSettings, matters: "The release and hiring", notificationHours: { days: [1], from: 540, to: 1140 } }
const monday = (hour: number) => new Date(2026, 9, 12, hour).getTime()
const candidate = (ts: string, mentionsMe = true): Candidate => ({
  channel: { id: ChannelId.make('C0ENG'), kind: 'public', name: 'eng', ignored: false },
  senderId: UserId.make('U0MAYA'), mentionsMe, ts, topicId: 'm:C0ENG', text: 'Can you approve the release now?',
})
const setSettings = (value = settings) => transaction(prefs.set('notifications', value))
const fakeProvider = makeFakeAiProvider()
const aiLayer = Layer.succeed(AiProvider, fakeProvider)

// These tests run the engine service on a real SQLite store and the real client against fake Slack.
describe('notifications service', () => {
  effectIt.effect('times out at two seconds, falls back for mentions and DMs, and never duplicates a row', () => Effect.gen(function* () {
    yield* TestClock.setTime(monday(12))
    yield* setSettings()
    const record = recorder()
    const service = yield* makeNotifications(record.notifier, () => Effect.succeed(true))
    const fiber = yield* Effect.forkChild(service.receive(candidate('1.000001')))
    yield* TestClock.adjust(1999)
    expect(record.shown).toHaveLength(0)
    yield* TestClock.adjust(1)
    yield* Fiber.join(fiber)
    yield* service.receive(candidate('1.000001'))
    expect(record.shown).toHaveLength(1)
    const sql = yield* StoreWriter
    expect(yield* sql`SELECT outcome, reason FROM notification_log`).toEqual([{ outcome: 'now', reason: 'AI assist is off, and DMs and mentions notify you' }])
    const held = yield* Effect.forkChild(service.receive(candidate('2.000001', false)))
    yield* TestClock.adjust(2000)
    yield* Fiber.join(held)
    const dm = candidate('3.000001', false)
    const direct = yield* Effect.forkChild(service.receive({ ...dm, channel: { ...dm.channel, kind: 'im' } }))
    yield* TestClock.adjust(2000)
    yield* Fiber.join(direct)
    expect(record.shown).toHaveLength(2)
    yield* TestClock.setTime(monday(19) - 1000)
    const atClosing = yield* Effect.forkChild(service.receive(candidate('4.000001')))
    yield* TestClock.adjust(2000)
    yield* Fiber.join(atClosing)
    expect(record.shown).toHaveLength(2)
    expect(yield* sql`SELECT outcome FROM notification_log WHERE ts = '4.000001'`).toEqual([{ outcome: 'hold' }])
  }).pipe(Effect.provide(Layer.merge(freshStore, Layer.succeed(AiProvider, { ...fakeProvider, decide: () => Effect.never }))), Effect.scoped))

  effectIt.effect('keeps messages held at hours start and after a missed start on relaunch', () => Effect.gen(function* () {
    yield* TestClock.setTime(monday(8))
    yield* setSettings()
    const record = recorder()
    const service = yield* makeNotifications(record.notifier, () => Effect.succeed(true))
    yield* service.receive(candidate('1.000001'))
    yield* service.receive(candidate('2.000001'))
    yield* service.tick
    expect(record.shown).toHaveLength(0)
    yield* TestClock.setTime(monday(9))
    yield* service.tick
    yield* service.tick
    expect(record.shown).toHaveLength(0)
    yield* TestClock.setTime(monday(20))
    yield* service.receive(candidate('3.000001'))
    // The app misses the whole next Monday window, not just its opening minute.
    yield* TestClock.setTime(monday(20) + 7 * 86400000)
    const relaunched = yield* makeNotifications(record.notifier, () => Effect.succeed(true))
    yield* relaunched.wake
    expect(record.shown).toHaveLength(0)
    yield* relaunched.wake
    expect(record.shown).toHaveLength(0)
  }).pipe(Effect.provide(Layer.merge(freshStore, aiLayer)), Effect.scoped))

  effectIt.effect('re-runs stored judgements without calling the gate, and suppresses a focused topic', () => Effect.gen(function* () {
    yield* TestClock.setTime(monday(8))
    yield* setSettings()
    let calls = 0
    const inputs: unknown[] = []
    const observed = { ...fakeProvider, decide: (...args: Parameters<typeof fakeProvider.decide>) => {
      calls++
      inputs.push(args[1])
      return fakeProvider.decide(...args)
    } }
    const record = recorder()
    const service = yield* makeNotifications(record.notifier, () => Effect.succeed(true)).pipe(Effect.provideService(AiProvider, observed))
    yield* service.receive(candidate('1.000001'))
    expect(calls).toBe(1)
    expect(inputs[0]).toMatchObject({ matters: settings.matters })
    yield* setSettings({ ...settings, channels: { C0ENG: 'never' } })
    yield* service.settingsChanged
    const sql = yield* StoreWriter
    expect(yield* sql`SELECT outcome FROM notification_log`).toEqual([{ outcome: 'hold' }])
    yield* setSettings({ ...settings, notificationHours: { days: [1], from: 0, to: 1439 } })
    record.focus(true)
    yield* service.settingsChanged
    expect(record.shown).toHaveLength(0)
    const suppressed = yield* sql<{ delivered_at: string | null; suppressed_at: string | null; reason: string }>`SELECT delivered_at, suppressed_at, reason FROM notification_log`
    expect(suppressed[0]?.delivered_at).toBeNull()
    expect(suppressed[0]?.suppressed_at).not.toBeNull()
    expect(suppressed[0]?.reason).toContain('focused window')
    record.focus(false)
    yield* service.settingsChanged
    expect(record.shown).toHaveLength(0)
    expect(calls).toBe(1)
  }).pipe(Effect.provide(Layer.merge(freshStore, aiLayer)), Effect.scoped))

  effectIt.effect('keeps messages held with AI off and sends presence switches through Slack', () => Effect.gen(function* () {
    const fake = yield* fakeSlack
    yield* Effect.gen(function* () {
      yield* TestClock.setTime(monday(8))
      yield* setSettings()
      yield* transaction(prefs.set('aiAssist', false))
      const api = yield* SlackApi
      const record = recorder()
      const service = yield* makeNotifications(record.notifier, (presence) => api.call('presence.set', { presence }).pipe(Effect.as(true), Effect.orDie))
      yield* service.wake
      yield* service.receive(candidate('1.000001'))
      yield* TestClock.setTime(monday(9))
      yield* service.tick
      expect(record.shown).toHaveLength(0)
      yield* service.observePresence('away')
      yield* service.tick
      expect(yield* service.currentPresence).toBe('away')
      yield* service.wake
      expect(yield* service.currentPresence).toBe('active')
      yield* TestClock.setTime(monday(19))
      yield* service.tick
      expect(yield* service.currentPresence).toBe('away')
      // Active by hand before the first tick of a fresh start holds until the next switch.
      const fresh = yield* makeNotifications(record.notifier, (presence) => api.call('presence.set', { presence }).pipe(Effect.as(true), Effect.orDie))
      yield* fresh.setPresence('active')
      yield* fresh.tick
      expect(yield* fresh.currentPresence).toBe('active')
      expect(fake.callCount('presence.set')).toBe(5)
    }).pipe(Effect.provide(clientLayer(fake, { lanes: { backgroundMinIntervalMillis: 0 } })))
  }).pipe(Effect.provide(Layer.merge(freshStore, aiLayer)), Effect.scoped))
})

const engines: RunningEngine[] = []
afterEach(async () => { for (const engine of engines.splice(0)) await engine.stop() })

it('consumes both socket inputs, observes manual presence and responds to prefs over the engine port', async () => {
  const record = recorder()
  const engine = await bootedEngine(engines, { notifications: { notifier: record.notifier } })
  const configure = async (value: NotificationSettings) => {
    await runCommand(engine.registry, prefsSet, { key: 'notifications', value: Schema.decodeUnknownSync(Schema.Json)(value) })
  }
  await configure({ ...settings, channels: { C0ENG: 'every' } })
  const message = engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: '<@U0TUSHAR> Can you approve this?' })
  await waitFor(() => record.shown.length === 1 ? true : undefined)
  const rows = readDb(engine, 'user.db', (db) => db.prepare('SELECT * FROM notification_log WHERE channel = ? AND ts = ?').all('C0ENG', message.ts))
  expect(rows).toHaveLength(1)
  engine.fake.emitFrame({ type: 'desktop_notification', channel: 'C0ENG', msg: message.ts, user: 'U0MAYA', title: 'eng', content: '<@U0TUSHAR> Can you approve this?' })
  await configure({ ...settings, channels: { C0ENG: 'never' } })
  await waitFor(() => readDb(engine, 'user.db', (db) => db.prepare('SELECT outcome FROM notification_log WHERE ts = ?').get(message.ts))?.outcome === 'hold' ? true : undefined)
  expect(record.shown).toHaveLength(1)
  await configure({ ...settings, channels: { C0ENG: 'every' } })
  engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: 'A normal update without a mention' })
  await waitFor(() => record.shown.length === 2 ? true : undefined)
  const minute = localTime(Date.now()).minutes
  await configure({ ...settings, notificationHours: { days: [0, 1, 2, 3, 4, 5, 6], from: (minute + 1380) % 1440, to: (minute + 60) % 1440 } })
  engine.fake.emitFrame({ type: 'message', channel: 'C0ENG', user: 'U0MAYA', ts: millisToTs(Date.now() + 1000), text: '', blocks: [{ type: 'rich_text', elements: [
    { type: 'rich_text_section', elements: [{ type: 'user', user_id: 'U0TUSHAR' }, { type: 'text', text: ' Can you approve the release now?' }] },
  ] }] })
  await waitFor(() => record.shown.length === 3 ? true : undefined)
  expect(record.shown[2]?.body).toContain('Can you approve the release now?')
  await engine.handle.setPresence('active')
  engine.fake.emitFrame({ type: 'manual_presence_change', presence: 'away', user: 'U0TUSHAR' })
  await waitFor(async () => (await engine.handle.currentPresence()) === 'away' ? true : undefined)
  await engine.handle.setPresence('active')
  expect(await engine.handle.currentPresence()).toBe('active')
})

it('notifies for your user group but not another group', async () => {
  const record = recorder()
  const engine = await bootedEngine(engines, { notifications: { notifier: record.notifier }, initial: (fake) => {
    fake.setSelfUsergroups({ ids: ['S0PLATFORM'] })
    return fake.signIn()
  } })
  await runCommand(engine.registry, prefsSet, { key: 'aiAssist', value: false })
  const minute = localTime(Date.now()).minutes
  await runCommand(engine.registry, prefsSet, { key: 'notifications', value: Schema.decodeUnknownSync(Schema.Json)({
    ...defaultNotificationSettings, notificationHours: { days: [0, 1, 2, 3, 4, 5, 6], from: (minute + 1380) % 1440, to: (minute + 60) % 1440 },
  }) })
  const other = engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: '<!subteam^S0OTHER|@other> Review this.' })
  const own = engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: '<!subteam^S0PLATFORM|@platform> Review this.' })
  await waitFor(() => record.shown.some((item) => item.target.kind === 'message' && item.target.source.ts === own.ts) ? true : undefined)
  expect(record.shown.some((item) => item.target.kind === 'message' && item.target.source.ts === other.ts)).toBe(false)
})
