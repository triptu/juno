// Notifications (SPEC 14): the decision service on a real store with Effect's TestClock (the reading's 2 s
// timeout, hours starts, settings changed mid-reading, presence), the engine's socket path into a recording
// Notifier, and which topics the dock badge counts. Slack's schedule and presence by the hours rows are
// notification-hours.flow.test.ts. Main's Notifier (privacy mode, focused-topic suppression, showing the
// badge) is apps/desktop/test/notifier.test.ts: engine tests do not import apps/desktop.
import { itEffect } from '@juno/testing/effect'
import { afterEach, expect, it } from 'bun:test'
import { AiProvider, makeFakeAiProvider } from '@juno/ai'
import { channelsIgnore, homeView, notificationsDecisions, notificationsSetLevel, prefsSet, readsMarkRead, viewsSave, viewsSortChannel, type HomeItem, type HomeView, type Hours, type NotificationDecisions, type TodayRow } from '@juno/contract'
import { ChannelId, UserId, defaultNotificationSettings, localTime, millisToTs, type NotificationSettings } from '@juno/domain'
import { makeNotifications, type Candidate, type Notification, type Notifier } from '@juno/notifications'
import { SlackApi } from '@juno/slack'
import { liveQuery, runCommand, sendMessage } from '@juno/state'
import { prefs, StoreWriter, transaction } from '@juno/store'
import { Effect, Fiber, Layer, Schema } from 'effect'
import { TestClock } from 'effect/testing'
import { clientLayer, fakeSlack } from '../../../slack/test/helpers'
import { freshStore } from '../../../store/test/helpers'
import { waitFor, WAIT_MS, type RunningEngine } from '../harness'
import { readDb, threadId, tsOf, valueOf } from '../scenario'
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

itEffect('messages held outside the hours are not read, and stay held at the hours start and after a start missed while closed', () => Effect.gen(function* () {
  yield* TestClock.setTime(monday(8))
  yield* setSettings()
  let readings = 0
  const counting = { ...fakeProvider, decide: (...args: Parameters<typeof fakeProvider.decide>) => Effect.suspend(() => (readings++, fakeProvider.decide(...args))) }
  const record = recorder()
  const service = yield* makeNotifications(record.notifier, () => Effect.succeed(true)).pipe(Effect.provideService(AiProvider, counting))
  yield* service.receive(candidate('1.000001'))
  yield* service.receive(candidate('2.000001'))
  const sql = yield* StoreWriter
  expect(yield* sql`SELECT outcome, decided_by FROM notification_log ORDER BY ts`).toEqual([{ outcome: 'stay', decided_by: 'hours' }, { outcome: 'stay', decided_by: 'hours' }])
  expect(readings).toBe(0)
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

itEffect('with AI assist off, held messages stay held, and presence follows the hours, the owner through Slack, and a choice by hand until the next switch', () => Effect.gen(function* () {
  const fake = yield* fakeSlack
  yield* Effect.gen(function* () {
    yield* TestClock.setTime(monday(8))
    yield* setSettings()
    yield* transaction(prefs.set('aiAssist', false))
    const api = yield* SlackApi
    const setPresence = (presence: 'active' | 'away') => api.call('presence.set', { presence }).pipe(Effect.as(true), Effect.catch(() => Effect.succeed(false)))
    const record = recorder()
    const service = yield* makeNotifications(record.notifier, setPresence)
    yield* service.wake
    yield* service.receive(candidate('1.000001'))
    yield* TestClock.setTime(monday(9))
    yield* service.tick
    expect(record.shown).toHaveLength(0)
    // Away set in Slack holds as one set in Juno: a wake says it again, and the end of the hours takes over.
    yield* service.observePresence('away')
    yield* service.tick
    expect(yield* service.currentPresence).toBe('away')
    yield* service.wake
    expect(yield* service.currentPresence).toBe('away')
    yield* TestClock.setTime(monday(19))
    yield* service.tick
    expect(yield* service.currentPresence).toBe('away')
    // Active by hand before the first tick of a fresh start holds until the next switch.
    const fresh = yield* makeNotifications(record.notifier, setPresence)
    yield* fresh.setPresence('active')
    yield* fresh.tick
    expect(yield* fresh.currentPresence).toBe('active')
    expect(fake.callCount('presence.set')).toBe(4)
    // Away by hand inside the hours holds through a wake and a new session, which say it again, until the hours end.
    yield* TestClock.setTime(new Date(2026, 9, 13, 10).getTime())
    yield* fresh.tick
    yield* fresh.setPresence('away')
    yield* fresh.wake
    expect(yield* fresh.currentPresence).toBe('away')
    const restarted = yield* makeNotifications(record.notifier, setPresence)
    yield* restarted.tick
    expect(yield* restarted.currentPresence).toBe('away')
    yield* TestClock.setTime(new Date(2026, 9, 14, 9).getTime())
    yield* restarted.tick
    expect(yield* restarted.currentPresence).toBe('active')
    // A choice Slack refuses shows the presence before again and holds nothing: a wake applies the hours.
    fake.forceError({ method: 'presence.set', error: 'invalid_presence' })
    expect(yield* restarted.setPresence('away')).toBe(false)
    expect(yield* restarted.currentPresence).toBe('active')
    yield* restarted.wake
    // Settled: each tick, wake and set above returned after its presence.set answered.
    expect(fake.calls.filter((call) => call.method === 'presence.set').slice(4).map((call) => call.args['presence'])).toEqual(['away', 'away', 'away', 'active', 'away', 'active'])
  }).pipe(Effect.provide(clientLayer(fake, { lanes: { backgroundMinIntervalMillis: 0 } })))
}).pipe(Effect.provide(Layer.merge(freshStore, aiLayer))))

/** Hours that include now, every day; `shift` minutes moves them so they exclude now. */
function hoursAroundNow(shift = 0): Hours {
  const minute = (localTime(Date.now()).minutes + shift) % 1440
  return { days: [0, 1, 2, 3, 4, 5, 6], from: (minute + 1380) % 1440, to: (minute + 60) % 1440 }
}

const setPref = async (engine: RunningEngine, key: 'notifications' | 'aiAssist', value: unknown) =>
  valueOf(await runCommand(engine.registry, prefsSet, { key, value: Schema.decodeUnknownSync(Schema.Json)(value) }))

/** A live query's value once `pick` finds something in it. */
function liveUntil<A, B>(engine: RunningEngine, atom: Parameters<RunningEngine['registry']['mount']>[0], pick: (value: A) => B | undefined, label: string): Promise<B> {
  unmounts.push(engine.registry.mount(atom))
  return waitFor(() => {
    const value = (engine.registry.get(atom) as { value?: A }).value
    return value === undefined ? undefined : pick(value)
  }, WAIT_MS, label)
}

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

  await step('a cold greeting stays by the reading, and a reply while you talk in the DM notifies', async () => {
    engine.fake.injectMessage({ channel: 'D0MAYA', user: 'U0MAYA', text: 'hi Tushar 👋' })
    expect(await log.decided('hi Tushar')).toMatchObject({ outcome: 'stay', decidedBy: 'reading' })
    valueOf(await sendMessage(engine.registry, { kind: 'channel', channelId: 'D0MAYA' }, 'Hey Maya, what is up?', 'm:D0MAYA'))
    // The fact comes from Slack's copy of the reply.
    await waitFor(() => readDb(engine, 'cache.db', (db) => db.prepare('SELECT 1 FROM messages WHERE text = ? AND deleted = 0').get('Hey Maya, what is up?')) === undefined ? undefined : true, WAIT_MS, 'the reply synced')
    engine.fake.injectMessage({ channel: 'D0MAYA', user: 'U0MAYA', text: 'The doc is in the shared folder now' })
    expect(await log.decided('The doc is in the shared folder now')).toMatchObject({ outcome: 'notify', decidedBy: 'live' })
    await shownWith('The doc is in the shared folder now')
    expect(record.shown.some((item) => item.body.includes('hi Tushar'))).toBe(false)
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

  await step('a mention of you, or of your group, breaks through an ignored channel and reaches Home; @here does not', async () => {
    valueOf(await runCommand(engine.registry, channelsIgnore, { channel: 'C0INCIDENTS' }))
    engine.fake.injectMessage({ channel: 'C0INCIDENTS', user: 'U0LEO', text: '<!here> the deploy freeze starts at 3' })
    engine.fake.injectMessage({ channel: 'C0INCIDENTS', user: 'U0MAYA', text: '<@U0TUSHAR> can you approve the rollback?' })
    expect(await log.decided('can you approve the rollback?')).toMatchObject({ outcome: 'notify', decidedBy: 'directMention' })
    await shownWith('can you approve the rollback?')
    // Within 10 seconds of that banner the burst rule keeps the group mention quiet; later it notifies.
    engine.fake.injectMessage({ channel: 'C0INCIDENTS', user: 'U0LEO', text: '<!subteam^S0PLATFORM> please check the dashboards' })
    expect((await log.decided('please check the dashboards')).decidedBy).toMatch(/^(burst|directMention)$/)
    expect(log.about('the deploy freeze starts at 3')).toEqual([expect.objectContaining({ outcome: 'stay', decidedBy: 'ignored' })])
    expect(record.shown.some((item) => item.body.includes('deploy freeze'))).toBe(false)
    // Home names the newest mention; the channel stays out of the sidebar.
    const home = await liveUntil<HomeView, HomeItem>(engine, liveQuery(homeView)(undefined), (view) => view.items.find((item) => item.kind === 'mentioned'), 'the mention on Home')
    expect(home).toMatchObject({ title: 'Leo mentioned you in #incidents', topics: [{ id: 'm:C0INCIDENTS' }] })
    expect((await engine.rows()).some((row) => row.channel.id === 'C0INCIDENTS')).toBe(false)
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

it('the dock badge: unread DMs, group DMs and mentions through reads and Notify me; a DM kept out of All or in Automated counts only when it mentions you, a Never sender’s @here does not count, and a channel muted in Slack does', async () => {
  const badge: Array<boolean> = []
  const engine = await synced({ notifications: { notifier: recorder().notifier, badge: (unread) => Effect.sync(() => { badge.push(unread) }) } })
  const shows = (unread: boolean, label: string) => waitFor(() => (badge.at(-1) === unread ? true : undefined), WAIT_MS, label)
  const readAll = async () => {
    for (const { id } of await engine.rows({ kind: 'all', unreadOnly: true })) valueOf(await runCommand(engine.registry, readsMarkRead, { id }))
    await shows(false, 'no badge once everything is read')
  }
  await setPref(engine, 'notifications', { ...defaultNotificationSettings, notificationHours: hoursAroundNow() })
  await readAll()

  await step('an unread DM, group DM or mention sets it until read, here or in another client; Never on the sender clears it and Always brings it back', async () => {
    const level = async (choice: 'always' | 'auto' | 'never') => valueOf(await runCommand(engine.registry, notificationsSetLevel, { target: { kind: 'person', id: 'U0MAYA' }, choice }))
    const dm = engine.fake.injectMessage({ channel: 'D0MAYA', user: 'U0MAYA', text: 'Are you around?' }).ts
    await shows(true, 'the badge for an unread DM')
    await level('never')
    await shows(false, 'no badge once Maya is set to Never')
    await level('always')
    await shows(true, 'the badge again once Maya is set to Always')
    engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0LEO', text: '<@U0TUSHAR> Can you review this now?' })
    const unread = { kind: 'all', unreadOnly: true } as const
    await engine.rowsUntil((rows) => rows.some((row) => row.id === 'm:C0ENG'), 'the mention unread', unread)
    engine.fake.markRead({ channel: 'D0MAYA', ts: dm })
    await engine.rowsUntil((rows) => !rows.some((row) => row.id === 'm:D0MAYA'), 'the DM read in another client', unread)
    expect(badge.at(-1)).toBe(true)
    valueOf(await runCommand(engine.registry, readsMarkRead, { id: 'm:C0ENG' }))
    await shows(false, 'no badge once the mention is read')
    engine.fake.injectMessage({ channel: 'G0MAYALEO', user: 'U0LEO', text: 'A group DM' })
    await shows(true, 'the badge for a group DM')
    valueOf(await runCommand(engine.registry, readsMarkRead, { id: 'm:G0MAYALEO' }))
    await shows(false, 'no badge once the group DM is read')
    await level('auto')
  })

  await step('a DM in a view kept out of All is quiet, but a mention in it counts', async () => {
    engine.fake.injectMessage({ channel: 'D0MAYA', user: 'U0MAYA', text: 'A DM before the view' })
    await shows(true, 'the badge for an unread DM')
    valueOf(await runCommand(engine.registry, viewsSave, { name: 'Apps', keepOutOfAll: true, channels: ['D0MAYA'] }))
    await shows(false, 'no badge for the kept-out DM')
    engine.fake.injectMessage({ channel: 'D0MAYA', user: 'U0MAYA', text: '<@U0TUSHAR> Please approve' })
    await shows(true, 'the badge for the mention')
    valueOf(await runCommand(engine.registry, readsMarkRead, { id: 'm:D0MAYA' }))
    await shows(false, 'no badge once the DM is read')
  })

  await step('a DM in Automated is quiet until it mentions you', async () => {
    engine.fake.injectMessage({ channel: 'D0SAM', user: 'U0SAM', text: 'Pull request opened' })
    await shows(true, 'the badge for an unread DM')
    valueOf(await runCommand(engine.registry, viewsSortChannel, { channel: 'D0SAM', to: 'automated' }))
    await shows(false, 'no badge for the DM in Automated')
    engine.fake.injectMessage({ channel: 'D0SAM', user: 'U0SAM', text: '<@U0TUSHAR> Review the pull request' })
    await shows(true, 'the badge for the mention')
    valueOf(await runCommand(engine.registry, readsMarkRead, { id: 'm:D0SAM' }))
    await shows(false, 'no badge once the DM is read')
  })

  await step('an @here from a sender set to Never does not count; a mention in a channel muted in Slack does', async () => {
    engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: '<!here> A muted sender' })
    await shows(true, 'the badge for the @here')
    valueOf(await runCommand(engine.registry, notificationsSetLevel, { target: { kind: 'person', id: 'U0MAYA' }, choice: 'never' }))
    await shows(false, 'no badge once Maya is set to Never')
    // Juno does not follow Slack's mute.
    engine.fake.emitFrame({ type: 'pref_change', name: 'muted_channels', value: 'C0ENG' })
    engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0LEO', text: '<@U0TUSHAR> Can you approve this now?' })
    await shows(true, 'the badge for the mention in the muted channel')
  })
})
