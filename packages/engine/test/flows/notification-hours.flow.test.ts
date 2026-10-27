// The notification hours and Active in Slack hours (SPEC 14), against the fake: a new sign-in that matches what
// Slack did before Juno (hours not set: Slack's schedule and Slack's automatic presence), Slack's own notification
// schedule from the hours once set (what reaches Slack and when), hours saved by an older version, and presence
// set by the hours rows. The rest of the decisions the hours make are notifications.flow.test.ts.
import { afterEach, expect, it } from 'bun:test'
import { notificationsDecisions, notificationsSetGroupHours, notificationsSetLevel, notificationsSettings, notificationsStatus, notificationsUseJunoHours, prefsSet, type NotificationDecisions, type NotificationSettingsView, type NotificationStatus, type SlackScheduleView, type TodayRow } from '@juno/contract'
import { liveQuery, notificationsPageAtom, runCommand } from '@juno/state'
import { Schema } from 'effect'
import { productionTiming } from '../../src/config'
import { clockAt, localNoon } from '../controlledClock'
import { startTestEngine, waitFor, WAIT_MS, type RunningEngine } from '../harness'
import { restart, valueOf } from '../scenario'
import { step } from '../step'
import { syncedEngine, type SyncedOptions } from '../synced'

const engines: Array<RunningEngine> = []
const unmounts: Array<() => void> = []
afterEach(async () => {
  for (const unmount of unmounts.splice(0)) unmount()
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
})

const synced = (options: SyncedOptions = {}) => syncedEngine(engines, options)
const setNotifications = async (engine: RunningEngine, value: unknown) =>
  valueOf(await runCommand(engine.registry, prefsSet, { key: 'notifications', value: Schema.decodeUnknownSync(Schema.Json)(value) }))
/** A live query's value once `pick` finds something in it. */
function liveUntil<A, B>(engine: RunningEngine, atom: Parameters<RunningEngine['registry']['mount']>[0], pick: (value: A) => B | undefined, label: string): Promise<B> {
  unmounts.push(engine.registry.mount(atom))
  return waitFor(() => {
    const value = (engine.registry.get(atom) as { value?: A }).value
    return value === undefined ? undefined : pick(value)
  }, WAIT_MS, label)
}

/** What the owner set in Slack before Juno: every day, paused from 22:00 to 08:00. */
const before = { dnd_enabled: true, dnd_days: 'every_day', dnd_start_hour: '22:00', dnd_end_hour: '8:00' }
/** Monday to Friday 9 to 7 as Slack prefs: the fake's schedule before a test changes it. */
const weekdays = { dnd_enabled: true, dnd_days: 'weekdays', dnd_start_hour: '19:00', dnd_end_hour: '09:00' }

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
type HoursGroup = 'weekdays' | 'saturday' | 'sunday'
/** Sets one row of hours, as Settings does: only the edges that changed. */
const setRow = async (engine: RunningEngine, which: 'notifications' | 'presence', group: HoursGroup, hours: { from?: number; to?: number } | 'off') =>
  valueOf(await runCommand(engine.registry, notificationsSetGroupHours, { which, group, hours }))
const setWeekdays = (engine: RunningEngine, which: 'notifications' | 'presence', hours: { from?: number; to?: number }) => setRow(engine, which, 'weekdays', hours)
const useJunoHours = async (engine: RunningEngine) => valueOf(await runCommand(engine.registry, notificationsUseJunoHours, {}))

/** Today's decision on the message whose text includes `text`, once made. */
function decided(engine: RunningEngine, text: string): Promise<TodayRow> {
  return liveUntil<NotificationDecisions, TodayRow>(engine, liveQuery(notificationsDecisions)(undefined), (value) => value.decisions.find((row) => row.text.includes(text)), `the decision on "${text}"`)
}
const alwaysFor = async (engine: RunningEngine, channel: string) =>
  valueOf(await runCommand(engine.registry, notificationsSetLevel, { target: { kind: 'channel', id: channel }, choice: 'always' }))

/** 8pm on the coming Saturday, local time: outside any weekday hours, whenever the test runs. */
function saturdayEvening(): number {
  const date = new Date()
  // Time of day: only to find the coming Saturday; the engine then reads 8pm that day on its own clock.
  date.setDate(date.getDate() + ((6 - date.getDay() + 7) % 7))
  date.setHours(20, 0, 0, 0)
  return date.getTime()
}

it('a new sign-in on a Saturday evening, with no schedule in Slack, is as Slack was: Juno never sets the owner away, tells Slack they are here, and pauses nothing by hours', async () => {
  const engine = await startTestEngine({
    clock: clockAt(saturdayEvening()),
    initial: (fake) => {
      fake.workspace.prefs = Object.fromEntries(Object.entries(fake.workspace.prefs).filter(([key]) => !key.startsWith('dnd_')))
      return fake.signIn()
    },
  })
  engines.push(engine)

  await step('neither set of hours is set, and Slack has no schedule to follow', async () => {
    const settings = await liveUntil<NotificationSettingsView, NotificationSettingsView>(engine, liveQuery(notificationsSettings)(undefined), (value) => value, 'the settings')
    expect(settings).toMatchObject({ notificationHours: null, presenceHours: null })
    expect(await page(engine, () => true, 'the page')).toEqual({ changedInSlack: false, waitingForHours: false, slackHours: null })
  })

  await step('while the owner uses the Mac, Slack shows them active; a pass of the presence schedule sends nothing', async () => {
    engine.main.host.deliver({ _tag: 'active' })
    await waitFor(() => (engine.fake.received.some((frame) => frame.type === 'tickle') ? true : undefined), WAIT_MS, 'a tickle')
    await waitFor(() => (engine.fake.selfPresence() === 'active' ? true : undefined), WAIT_MS, 'Slack shows the owner active')
    await engine.workPass('presence')
    expect(apiSince(engine, 'presence.set', 0)).toEqual([])
    expect(writes(engine)).toEqual([])
  })

  await step('a message in a channel on Always notifies, with no hours to pause it', async () => {
    await alwaysFor(engine, 'C0ENG')
    engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: 'The release is out on Saturday night' })
    expect(await decided(engine, 'The release is out on Saturday night')).toMatchObject({ outcome: 'notify', decidedBy: 'always' })
  })
})

it('until the owner sets notification hours, they are Slack’s schedule as it changes in Slack: a message outside it stays, inside it notifies, and Juno writes nothing to Slack', async () => {
  const noon = localNoon()
  const engine = await synced({ clock: clockAt(noon) })
  await alwaysFor(engine, 'C0ENG')

  await step('Slack’s schedule, 11am to 1pm every day, is the notification hours shown and in effect', async () => {
    await changeInSlack(engine, { dnd_enabled: true, dnd_days: 'every_day', dnd_start_hour: '13:00', dnd_end_hour: '11:00' })
    expect(await page(engine, (view) => view.slackHours?.from === 660, 'Slack’s hours')).toEqual({
      changedInSlack: false, waitingForHours: false, slackHours: { days: [0, 1, 2, 3, 4, 5, 6], from: 660, to: 780 },
    })
    engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: 'Lunch demo in five minutes' })
    expect(await decided(engine, 'Lunch demo in five minutes')).toMatchObject({ outcome: 'notify', decidedBy: 'always' })
  })

  await step('changed in Slack to 2pm to 4pm, Juno follows it: at noon even a channel on Always stays', async () => {
    await changeInSlack(engine, { dnd_start_hour: '16:00', dnd_end_hour: '14:00' })
    await page(engine, (view) => view.slackHours?.from === 840, 'the new hours from Slack')
    engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: 'The staging deploy is done' })
    expect(await decided(engine, 'The staging deploy is done')).toMatchObject({ outcome: 'stay', decidedBy: 'hours' })
    await settled(engine)
    expect(writes(engine)).toEqual([])
  })
})

function page(engine: RunningEngine, predicate: (view: SlackScheduleView) => boolean, label: string): Promise<SlackScheduleView> {
  unmounts.push(engine.registry.mount(notificationsPageAtom))
  return waitFor(() => {
    const result = engine.registry.get(notificationsPageAtom)
    return result._tag === 'Success' && predicate(result.value.slackSchedule) ? result.value.slackSchedule : undefined
  }, WAIT_MS, label)
}

it('hours set on the page start from Slack’s and are written once after reading the schedule, presence hours never, and a relaunch writes nothing', async () => {
  const engine = await synced()

  await step('setting the weekdays keeps the rest of Slack’s schedule, reads it, and writes the hours once', async () => {
    await changeInSlack(engine, before)
    await page(engine, (view) => view.slackHours?.from === 480, 'Slack’s hours')
    const since = engine.fake.calls.length
    await setWeekdays(engine, 'notifications', { from: 9 * 60, to: 19 * 60 })
    await waitFor(() => (writes(engine, since).length > 0 ? true : undefined), WAIT_MS, 'the write')
    await settled(engine)
    expect(writes(engine, since)).toHaveLength(1)
    expect(scheduleReads(engine, since).length).toBeGreaterThan(0)
    expect(dnd(engine)).toMatchObject({
      dnd_days: 'custom',
      dnd_enabled_monday: 'partial', dnd_before_monday: '09:00', dnd_after_monday: '19:00',
      dnd_enabled_saturday: 'partial', dnd_before_saturday: '08:00', dnd_after_saturday: '22:00',
    })
    expect(await page(engine, (view) => view.slackHours === null, 'the hours set')).toEqual({ changedInSlack: false, waitingForHours: false, slackHours: null })
  })

  await step('presence hours are not Slack’s schedule', async () => {
    const since = engine.fake.calls.length
    await setWeekdays(engine, 'presence', { from: 600, to: 960 })
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

  await step('setting the hours Slack already holds, then Use Juno’s hours, neither reads nor writes the schedule', async () => {
    const since = engine.fake.calls.length
    await setWeekdays(engine, 'notifications', { from: 9 * 60, to: 19 * 60 })
    await settled(engine)
    await useJunoHours(engine)
    await settled(engine)
    expect(writes(engine, since)).toEqual([])
    expect(apiSince(engine, 'users.prefs.get', since).filter((call) => call.args['prefs'] !== undefined)).toEqual([])
    await page(engine, (view) => !view.waitingForHours && view.slackHours === null, 'the hours applied')
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
    await setWeekdays(engine, 'notifications', { from: 8 * 60 })
    await setWeekdays(engine, 'notifications', { to: 18 * 60 + 30 })
    await waitFor(() => (writes(engine, since).length > 0 ? true : undefined), WAIT_MS, 'the write')
    await settled(engine)
    expect(writes(engine, since)).toEqual([{ dnd_enabled: true, dnd_days: 'weekdays', dnd_start_hour: '18:30', dnd_end_hour: '08:00' }])
  })
})

it('hours saved by an older version load; Saturday reaches Slack as a custom day, Weekdays sets all five, and the Active in Slack rows set presence by the day and show the owner active at once', async () => {
  // Presence follows the local day and time, so the engine reads noon whenever the test runs.
  const noon = localNoon()
  const engine = await synced({ clock: clockAt(noon) })
  const rowOf = (day: number): HoursGroup => (day === 6 ? 'saturday' : day === 0 ? 'sunday' : 'weekdays')
  const today = new Date(noon).getDay()

  await step('hours saved before the rows, Monday to Thursday with one from and to, load as they were; active hours saved as the ones every install started with read as not set', async () => {
    const old = { notificationHours: { days: [1, 2, 3, 4], from: 600, to: 1020 }, presenceHours: { days: [1, 2, 3, 4, 5], from: 540, to: 1140 }, channels: {}, people: {} } as const
    await setNotifications(engine, old)
    const loaded = await liveUntil<NotificationSettingsView, NotificationSettingsView>(engine, liveQuery(notificationsSettings)(undefined), (value) => (value.notificationHours?.from === 600 ? value : undefined), 'the saved hours')
    expect(loaded.notificationHours).toEqual(old.notificationHours)
    expect(loaded.presenceHours).toBeNull()
  })

  await step('Saturday 11am to 2pm reaches Slack as a custom day; Friday stays off', async () => {
    await setRow(engine, 'notifications', 'saturday', { from: 660, to: 840 })
    await settled(engine)
    expect(dnd(engine)).toMatchObject({
      dnd_days: 'custom',
      dnd_enabled_monday: 'partial', dnd_before_monday: '10:00', dnd_after_monday: '17:00',
      dnd_enabled_friday: 'all_day',
      dnd_enabled_saturday: 'partial', dnd_before_saturday: '11:00', dnd_after_saturday: '14:00',
      dnd_enabled_sunday: 'all_day',
    })
  })

  await step('changing the Weekdays row sets all five weekdays and leaves Saturday alone', async () => {
    await setWeekdays(engine, 'notifications', { from: 540 })
    await settled(engine)
    expect(dnd(engine)).toMatchObject({
      dnd_days: 'custom',
      dnd_enabled_monday: 'partial', dnd_before_monday: '09:00', dnd_after_monday: '17:00',
      dnd_enabled_friday: 'partial', dnd_before_friday: '09:00', dnd_after_friday: '17:00',
      dnd_before_saturday: '11:00',
    })
  })

  await step('the Active in Slack rows set presence by the day: today\'s row active, then away until the weekend day\'s hours', async () => {
    const status = (predicate: (value: NotificationStatus) => boolean, label: string) =>
      liveUntil<NotificationStatus, NotificationStatus>(engine, liveQuery(notificationsStatus)(undefined), (value) => (predicate(value) ? value : undefined), label)
    await setRow(engine, 'presence', rowOf(today), { from: 660, to: 780 })
    expect((await status((value) => value.presence === 'active', 'active by today\'s row')).presenceLabel).toMatch(/^Active/)
    // Every row off but the weekend day that is not today, 11am to 2pm.
    const weekend: HoursGroup = today === 6 ? 'sunday' : 'saturday'
    const since = engine.fake.calls.length
    for (const group of ['weekdays', 'saturday', 'sunday'] as const) await setRow(engine, 'presence', group, group === weekend ? { from: 660, to: 840 } : 'off')
    const away = await status((value) => value.presence === 'away', 'away by the rows')
    expect(away.presenceLabel).toMatch(new RegExp(`^Away until (tomorrow|${weekend === 'saturday' ? 'Sat' : 'Sun'}) 11am`))
    expect(apiSince(engine, 'presence.set', since).map((call) => call.args['presence'])).toEqual(['away'])
  })

  await step('main says the owner is at the Mac while the rows keep them away; when today\'s row takes them in, Slack shows them active without waiting for main\'s next reading', async () => {
    engine.main.host.deliver({ _tag: 'active' })
    await setRow(engine, 'presence', rowOf(today), { from: 660, to: 780 })
    await waitFor(() => (engine.fake.selfPresence() === 'active' ? true : undefined), WAIT_MS, 'Slack shows the owner active')
  })
})
