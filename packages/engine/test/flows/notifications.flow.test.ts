// Notifications (SPEC 14): the decision service on a real store with Effect's TestClock (the reading's 2 s
// timeout, hours starts, settings changed mid-reading, presence), the engine's socket path into a recording
// Notifier, and Slack's own notification schedule against the fake. Main's Notifier (privacy mode, focused-topic
// suppression, the dock badge) is apps/desktop/test/notifier.test.ts: engine tests do not import apps/desktop.
import { itEffect } from '@juno/testing/effect'
import { afterEach, expect, it } from 'bun:test'
import { AiProvider, makeFakeAiProvider } from '@juno/ai'
import { notificationsDecisions, notificationsSetHours, notificationsUseJunoHours, prefsSet, type Hours, type NotificationDecisions, type SlackScheduleView, type TodayRow } from '@juno/contract'
import { ChannelId, UserId, defaultNotificationSettings, localTime, millisToTs, type NotificationSettings } from '@juno/domain'
import { makeNotifications, type Candidate, type Notification, type Notifier } from '@juno/notifications'
import { SlackApi } from '@juno/slack'
import { liveQuery, notificationsPageAtom, runCommand } from '@juno/state'
import { prefs, StoreWriter, transaction } from '@juno/store'
import { Effect, Fiber, Layer, Schema } from 'effect'
import { TestClock } from 'effect/testing'
import { clientLayer, fakeSlack } from '../../../slack/test/helpers'
import { freshStore } from '../../../store/test/helpers'
import { productionTiming } from '../../src/config'
import { waitFor, WAIT_MS, type RunningEngine } from '../harness'
import { restart, threadId, tsOf, valueOf } from '../scenario'
import { step } from '../step'
import { syncedEngine, type SyncedOptions } from '../synced'

const engines: Array<RunningEngine> = []
const unmounts: Array<() => void> = []
afterEach(async () => {
  for (const unmount of unmounts.splice(0)) unmount()
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
})

const synced = (options: SyncedOptions = {}) => syncedEngine(engines, options)

function recorder() {
  const shown: Notification[] = []
  const notifier: Notifier = {
    show: (notification) => Effect.sync(() => { shown.push(notification) }),
    viewing: () => Effect.succeed(false),
  }
  return { shown, notifier }
}

// Mentions are read, not notified by the switch, so messages reach Juno's reading.
const settings: NotificationSettings = {
  ...defaultNotificationSettings, alwaysNotify: { mentions: false }, instructions: [{ id: 'i1', direction: 'notify', text: 'the release' }],
  notificationHours: { days: [1], from: 540, to: 1140 },
}

// The decision service alone, on a real store with Effect's TestClock.
const monday = (hour: number) => new Date(2026, 9, 12, hour).getTime()
const candidate = (ts: string, mentionsMe = true): Candidate => ({
  channel: { id: ChannelId.make('C0ENG'), kind: 'public', name: 'eng', ignored: false },
  senderId: UserId.make('U0MAYA'), mentionsMe, ts, topicId: 'm:C0ENG', text: 'Can you approve the release now?',
})
const setSettings = (value = settings) => transaction(prefs.set('notifications', value))
const fakeProvider = makeFakeAiProvider()
const aiLayer = Layer.succeed(AiProvider, fakeProvider)

itEffect('a reading that takes 2 s times out: a mention and a DM notify, the rest stays, and each message has one row', () => Effect.gen(function* () {
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
  expect(yield* sql`SELECT outcome, decided_by, reason FROM notification_log`).toEqual([{ outcome: 'notify', decided_by: 'timeout', reason: "Juno couldn't read this in time." }])
  const held = yield* Effect.forkChild(service.receive(candidate('2.000001', false)))
  yield* TestClock.adjust(2000)
  yield* Fiber.join(held)
  const dm = candidate('3.000001', false)
  const direct = yield* Effect.forkChild(service.receive({ ...dm, topicId: 'm:D0MAYA', channel: { ...dm.channel, id: ChannelId.make('D0MAYA'), kind: 'im' } }))
  yield* TestClock.adjust(2000)
  yield* Fiber.join(direct)
  expect(record.shown).toHaveLength(2)
  // A reading that ends after the hours close stays.
  yield* TestClock.setTime(monday(19) - 1000)
  const atClosing = yield* Effect.forkChild(service.receive(candidate('4.000001')))
  yield* TestClock.adjust(2000)
  yield* Fiber.join(atClosing)
  expect(record.shown).toHaveLength(2)
  expect(yield* sql`SELECT outcome FROM notification_log WHERE ts = '4.000001'`).toEqual([{ outcome: 'stay' }])
}).pipe(Effect.provide(Layer.merge(freshStore, Layer.succeed(AiProvider, { ...fakeProvider, decide: () => Effect.never })))))

itEffect('messages held outside the hours stay held at the hours start and after a start missed while closed', () => Effect.gen(function* () {
  yield* TestClock.setTime(monday(8))
  yield* setSettings()
  const record = recorder()
  const service = yield* makeNotifications(record.notifier, () => Effect.succeed(true))
  yield* service.receive(candidate('1.000001'))
  yield* service.receive(candidate('2.000001'))
  yield* service.tick
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
  yield* relaunched.wake
  expect(record.shown).toHaveLength(0)
}).pipe(Effect.provide(Layer.merge(freshStore, aiLayer))))

itEffect('decides with the settings read after the reading, and a later settings change leaves logged decisions alone', () => Effect.gen(function* () {
  yield* TestClock.setTime(monday(12))
  yield* setSettings()
  // The owner sets #eng to Never while Juno is reading the message.
  const inFlight = { ...fakeProvider, decide: (...args: Parameters<typeof fakeProvider.decide>) =>
    setSettings({ ...settings, channels: { C0ENG: 'never' } }).pipe(Effect.orDie, Effect.andThen(fakeProvider.decide(...args))) }
  const record = recorder()
  const service = yield* makeNotifications(record.notifier, () => Effect.succeed(true)).pipe(Effect.provideService(AiProvider, inFlight))
  yield* service.receive(candidate('1.000001', false))
  const sql = yield* StoreWriter
  expect(yield* sql`SELECT outcome, decided_by FROM notification_log`).toEqual([{ outcome: 'stay', decided_by: 'never' }])
  yield* setSettings()
  yield* service.settingsChanged
  expect(yield* sql`SELECT outcome, decided_by FROM notification_log`).toEqual([{ outcome: 'stay', decided_by: 'never' }])
  expect(record.shown).toHaveLength(0)
}).pipe(Effect.provide(Layer.merge(freshStore, aiLayer))))

itEffect('with AI assist off, held messages stay held, and presence follows the hours and the owner through Slack', () => Effect.gen(function* () {
  const fake = yield* fakeSlack
  yield* Effect.gen(function* () {
    yield* TestClock.setTime(monday(8))
    yield* setSettings()
    yield* transaction(prefs.set('aiAssist', false))
    const api = yield* SlackApi
    const setPresence = (presence: 'active' | 'away') => api.call('presence.set', { presence }).pipe(Effect.as(true), Effect.orDie)
    const record = recorder()
    const service = yield* makeNotifications(record.notifier, setPresence)
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
    const fresh = yield* makeNotifications(record.notifier, setPresence)
    yield* fresh.setPresence('active')
    yield* fresh.tick
    expect(yield* fresh.currentPresence).toBe('active')
    expect(fake.callCount('presence.set')).toBe(5)
  }).pipe(Effect.provide(clientLayer(fake, { lanes: { backgroundMinIntervalMillis: 0 } })))
}).pipe(Effect.provide(Layer.merge(freshStore, aiLayer))))

/** Hours that include now, every day; `shift` minutes moves them so they exclude now. */
function hoursAroundNow(shift = 0): Hours {
  const minute = (localTime(Date.now()).minutes + shift) % 1440
  return { days: [0, 1, 2, 3, 4, 5, 6], from: (minute + 1380) % 1440, to: (minute + 60) % 1440 }
}

const setPref = async (engine: RunningEngine, key: 'notifications' | 'aiAssist', value: unknown) =>
  valueOf(await runCommand(engine.registry, prefsSet, { key, value: Schema.decodeUnknownSync(Schema.Json)(value) }))

/** Today's decisions as Details shows them; `decided` waits for the one whose text includes `text`. */
function decisions(engine: RunningEngine) {
  const atom = liveQuery(notificationsDecisions)(undefined)
  unmounts.push(engine.registry.mount(atom))
  const all = () => (engine.registry.get(atom) as { _tag: string; value?: NotificationDecisions }).value?.decisions ?? []
  return {
    about: (text: string) => all().filter((row) => row.text.includes(text)),
    decided: (text: string): Promise<TodayRow> => waitFor(() => all().find((row) => row.text.includes(text)), WAIT_MS, `the decision on "${text}"`),
  }
}

it('decides socket messages within the hours: Always once per message, a reading from blocks alone, user groups, a followed reply from its frame, presence, and nothing outside the hours', async () => {
  const record = recorder()
  const engine = await synced({ notifications: { notifier: record.notifier } })
  const log = decisions(engine)
  const shownWith = (text: string) => waitFor(() => record.shown.find((item) => item.body.includes(text)), WAIT_MS, `the notification "${text}"`)

  await step('a channel on Always notifies once, though both the message and its desktop_notification arrive', async () => {
    await setPref(engine, 'notifications', { ...settings, notificationHours: hoursAroundNow(), channels: { C0ENG: 'always' } })
    const message = engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: '<@U0TUSHAR> Can you approve this?' })
    await shownWith('Can you approve this?')
    engine.fake.emitFrame({ type: 'desktop_notification', channel: 'C0ENG', msg: message.ts, user: 'U0MAYA', title: 'eng', content: '<@U0TUSHAR> Can you approve this?' })
    expect(await log.decided('Can you approve this?')).toMatchObject({ outcome: 'notify', decidedBy: 'always' })
  })

  await step('a mention only in rich text blocks is read against an instruction and notifies; the desktop_notification added nothing', async () => {
    await setPref(engine, 'notifications', { ...settings, notificationHours: hoursAroundNow() })
    engine.fake.emitFrame({ type: 'message', channel: 'C0HIRING', user: 'U0MAYA', ts: millisToTs(Date.now() + 1000), text: '', blocks: [{ type: 'rich_text', elements: [
      { type: 'rich_text_section', elements: [{ type: 'user', user_id: 'U0TUSHAR' }, { type: 'text', text: ' Can you approve the release now?' }] },
    ] }] })
    await shownWith('Can you approve the release now?')
    // The socket feeds notifications one frame at a time, so the earlier desktop_notification has been handled.
    expect(record.shown).toHaveLength(2)
    expect(log.about('Can you approve this?')).toHaveLength(1)
  })

  await step('a presence change made in Slack is observed, and Set yourself active overrides it', async () => {
    await engine.handle.setPresence('active')
    engine.fake.emitFrame({ type: 'manual_presence_change', presence: 'away', user: 'U0TUSHAR' })
    await waitFor(async () => (await engine.handle.currentPresence()) === 'away' ? true : undefined, WAIT_MS, 'away from Slack')
    await engine.handle.setPresence('active')
    expect(await engine.handle.currentPresence()).toBe('active')
  })

  await setPref(engine, 'aiAssist', false)
  await setPref(engine, 'notifications', { ...defaultNotificationSettings, alwaysNotify: { followedThreads: true }, notificationHours: hoursAroundNow() })

  await step('after joining a user group in Slack, a mention of it notifies and a mention of another group does not', async () => {
    engine.fake.setSelfUsergroups({ ids: ['S0PLATFORM'] })
    engine.fake.emitFrame({ type: 'subteam_self_added', subteam_id: 'S0PLATFORM' })
    await engine.socketIdle()
    engine.fake.injectMessage({ channel: 'C0PLATFORM', user: 'U0MAYA', text: '<!subteam^S0DESIGN|@design-crew> Review the mocks.' })
    engine.fake.injectMessage({ channel: 'C0PLATFORM', user: 'U0MAYA', text: '<!subteam^S0PLATFORM|@platform> Review the rollout.' })
    expect(await log.decided('Review the rollout.')).toMatchObject({ outcome: 'notify', decidedBy: 'alwaysNotify' })
    // Frames reach notifications one at a time, so the earlier message was handled: not a mention, so not a candidate.
    expect(log.about('Review the mocks.')).toEqual([])
    expect(record.shown.some((item) => item.body.includes('Review the mocks.'))).toBe(false)
  })

  await step('a plain reply in a followed channel thread is decided from its message frame alone', async () => {
    const thread = threadId(engine.fake, 'C0ENG', 'Draft plan is in the doc')
    // Only the message frame: no desktop_notification comes with it.
    engine.fake.emitFrame({ type: 'message', channel: 'C0ENG', user: 'U0LEO', ts: millisToTs(Date.now() + 1000), thread_ts: tsOf(thread), text: 'Pushed the fix to staging' })
    expect(await log.decided('Pushed the fix to staging')).toMatchObject({ outcome: 'notify', decidedBy: 'alwaysNotify', topicId: thread })
    await shownWith('Pushed the fix to staging')
  })

  await step('outside the notification hours even a channel on Always stays', async () => {
    const shown = record.shown.length
    await setPref(engine, 'notifications', { ...defaultNotificationSettings, notificationHours: hoursAroundNow(180), channels: { C0INCIDENTS: 'always' } })
    engine.fake.injectMessage({ channel: 'C0INCIDENTS', user: 'U0SAM', text: 'Paging is quiet tonight' })
    expect(await log.decided('Paging is quiet tonight')).toMatchObject({ outcome: 'stay', decidedBy: 'hours' })
    expect(record.shown).toHaveLength(shown)
  })
})

// Slack's own notification schedule from the notification hours, against the fake: what reaches Slack and when.
/** What the owner set in Slack before Juno: every day, paused from 22:00 to 08:00. */
const before = { dnd_enabled: true, dnd_days: 'every_day', dnd_start_hour: '22:00', dnd_end_hour: '8:00' }
/** Juno's default notification hours, Monday to Friday 9 to 7, as Slack prefs. */
const weekdays = { dnd_enabled: true, dnd_days: 'weekdays', dnd_start_hour: '19:00', dnd_end_hour: '09:00' }
const workdays: Hours = { days: [1, 2, 3, 4, 5], from: 9 * 60, to: 19 * 60 }

const apiSince = (engine: RunningEngine, method: string, since: number) =>
  engine.fake.calls.slice(since).filter((call) => call.kind === 'api' && call.method === method)
const writes = (engine: RunningEngine, since = 0) => apiSince(engine, 'users.prefs.set', since).map((call) => JSON.parse(call.args['prefs'] ?? '{}') as unknown)
/** Reads of the schedule itself, not the boot's. */
const scheduleReads = (engine: RunningEngine, since: number) => apiSince(engine, 'users.prefs.get', since).filter((call) => call.args['prefs']?.includes('dnd_days') === true)
const dnd = (engine: RunningEngine) => Object.fromEntries(Object.entries(engine.fake.workspace.prefs).filter(([key]) => key.startsWith('dnd_')))

/** The owner changes the schedule in Slack's own app: Slack stores it and sends `pref_change` for each pref. */
async function changeInSlack(engine: RunningEngine, changes: Record<string, unknown>) {
  engine.fake.workspace.prefs = { ...engine.fake.workspace.prefs, ...changes }
  for (const [name, value] of Object.entries(changes)) engine.fake.workspace.emit({ type: 'pref_change', name, value })
  await engine.socketIdle()
}
/** A real pass decides whether the current hours need a write. */
const settled = (engine: RunningEngine) => engine.workPass('slackSchedule')
const setHours = async (engine: RunningEngine, which: 'notifications' | 'presence', hours: Hours) =>
  valueOf(await runCommand(engine.registry, notificationsSetHours, { which, hours }))
const useJunoHours = async (engine: RunningEngine) => valueOf(await runCommand(engine.registry, notificationsUseJunoHours, {}))

function page(engine: RunningEngine, predicate: (view: SlackScheduleView) => boolean, label: string): Promise<SlackScheduleView> {
  unmounts.push(engine.registry.mount(notificationsPageAtom))
  return waitFor(() => {
    const result = engine.registry.get(notificationsPageAtom)
    return result._tag === 'Success' && predicate(result.value.slackSchedule) ? result.value.slackSchedule : undefined
  }, WAIT_MS, label)
}

it('default hours never reach Slack; hours set on the page are written once after reading the schedule, presence hours never, and a relaunch writes nothing', async () => {
  const engine = await synced()

  await step('a schedule set in Slack is left alone while the hours are Juno defaults', async () => {
    await changeInSlack(engine, before)
    await settled(engine)
    expect(writes(engine)).toEqual([])
    expect(dnd(engine)).toMatchObject(before)
    expect(await page(engine, (view) => view.waitingForHours, 'waiting for hours')).toEqual({ changedInSlack: false, waitingForHours: true })
  })

  await step('setting the hours, even to the defaults, reads Slack’s schedule and writes the hours once', async () => {
    const since = engine.fake.calls.length
    await setHours(engine, 'notifications', workdays)
    await waitFor(() => (writes(engine, since).length > 0 ? true : undefined), WAIT_MS, 'the write')
    await settled(engine)
    expect(writes(engine, since)).toEqual([weekdays])
    expect(scheduleReads(engine, since).length).toBeGreaterThan(0)
    expect(dnd(engine)).toMatchObject(weekdays)
    expect(await page(engine, (view) => !view.waitingForHours, 'the hours applied')).toEqual({ changedInSlack: false, waitingForHours: false })
  })

  await step('presence hours are not Slack’s schedule', async () => {
    const since = engine.fake.calls.length
    await setHours(engine, 'presence', { days: [1, 2, 3], from: 600, to: 960 })
    await settled(engine)
    expect(writes(engine, since)).toEqual([])
  })

  await step('a relaunch writes nothing', async () => {
    const next = await restart(engines, engine)
    await settled(next)
    expect(writes(next)).toEqual([])
  })
})

it('Use Juno’s hours writes nothing when Slack holds them; a change made in Slack is left alone and shown until Use Juno’s hours; two quick changes write once [production 1 s debounce]', async () => {
  // The app's own debounce, so the two quick changes fall inside it however slow the machine. Other steps run the pass directly.
  const engine = await synced({ timing: { slackScheduleDebounceMillis: productionTiming.slackScheduleDebounceMillis } })

  await step('Use Juno’s hours when Slack already holds them neither reads nor writes the schedule', async () => {
    const since = engine.fake.calls.length
    await useJunoHours(engine)
    await settled(engine)
    expect(writes(engine, since)).toEqual([])
    expect(apiSince(engine, 'users.prefs.get', since).filter((call) => call.args['prefs'] !== undefined)).toEqual([])
    await page(engine, (view) => !view.waitingForHours, 'the hours applied')
  })

  await step('a change made in Slack is left alone and shown', async () => {
    const since = engine.fake.calls.length
    await changeInSlack(engine, { dnd_end_hour: '10:00' })
    await page(engine, (view) => view.changedInSlack, 'the change in Slack shown')
    await settled(engine)
    expect(writes(engine, since)).toEqual([])
  })

  await step('Use Juno’s hours writes them back once', async () => {
    const since = engine.fake.calls.length
    await useJunoHours(engine)
    await settled(engine)
    expect(writes(engine, since)).toEqual([weekdays])
    await page(engine, (view) => !view.changedInSlack, 'the line gone')
  })

  await step('two quick changes to the hours write once, with the last values', async () => {
    const since = engine.fake.calls.length
    await setHours(engine, 'notifications', { ...workdays, from: 8 * 60 })
    await setHours(engine, 'notifications', { ...workdays, from: 8 * 60, to: 18 * 60 + 30 })
    await waitFor(() => (writes(engine, since).length > 0 ? true : undefined), WAIT_MS, 'the write')
    await settled(engine)
    expect(writes(engine, since)).toEqual([{ dnd_enabled: true, dnd_days: 'weekdays', dnd_start_hour: '18:30', dnd_end_hour: '08:00' }])
  })
})
