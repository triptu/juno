// The notification hours and Active in Slack hours (SPEC 14), against the fake: Slack's own notification
// schedule from the hours (what reaches Slack and when), hours saved by an older version, and presence set by
// the hours rows. The decisions the hours make are notifications.flow.test.ts.
import { afterEach, expect, it } from 'bun:test'
import { notificationsSetGroupHours, notificationsSettings, notificationsStatus, notificationsUseJunoHours, prefsSet, type NotificationSettingsView, type NotificationStatus, type SlackScheduleView } from '@juno/contract'
import { liveQuery, notificationsPageAtom, runCommand } from '@juno/state'
import { Schema } from 'effect'
import { productionTiming } from '../../src/config'
import { waitFor, WAIT_MS, type RunningEngine } from '../harness'
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
/** Juno's default notification hours, Monday to Friday 9 to 7, as Slack prefs. */
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
    await setWeekdays(engine, 'notifications', { from: 9 * 60, to: 19 * 60 })
    await waitFor(() => (writes(engine, since).length > 0 ? true : undefined), WAIT_MS, 'the write')
    await settled(engine)
    expect(writes(engine, since)).toEqual([weekdays])
    expect(scheduleReads(engine, since).length).toBeGreaterThan(0)
    expect(dnd(engine)).toMatchObject(weekdays)
    expect(await page(engine, (view) => !view.waitingForHours, 'the hours applied')).toEqual({ changedInSlack: false, waitingForHours: false })
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
    await setWeekdays(engine, 'notifications', { from: 8 * 60 })
    await setWeekdays(engine, 'notifications', { to: 18 * 60 + 30 })
    await waitFor(() => (writes(engine, since).length > 0 ? true : undefined), WAIT_MS, 'the write')
    await settled(engine)
    expect(writes(engine, since)).toEqual([{ dnd_enabled: true, dnd_days: 'weekdays', dnd_start_hour: '18:30', dnd_end_hour: '08:00' }])
  })
})

it('hours saved by an older version load; Saturday reaches Slack as a custom day, Weekdays sets all five, and the Active in Slack rows set presence by the day', async () => {
  const engine = await synced()
  const rowOf = (day: number): HoursGroup => (day === 6 ? 'saturday' : day === 0 ? 'sunday' : 'weekdays')

  await step('hours saved before the rows, Monday to Thursday with one from and to, load as they were', async () => {
    const old = { notificationHours: { days: [1, 2, 3, 4], from: 600, to: 1020 }, presenceHours: { days: [1, 2, 3, 4, 5], from: 540, to: 1140 }, channels: {}, people: {} } as const
    await setNotifications(engine, old)
    const loaded = await liveUntil<NotificationSettingsView, NotificationSettingsView>(engine, liveQuery(notificationsSettings)(undefined), (value) => (value.notificationHours.from === 600 ? value : undefined), 'the saved hours')
    expect(loaded.notificationHours).toEqual(old.notificationHours)
    expect(loaded.presenceHours).toEqual(old.presenceHours)
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
    const now = new Date()
    const today = now.getDay()
    const half = Math.floor((now.getHours() * 60 + now.getMinutes()) / 30) * 30
    await setRow(engine, 'presence', rowOf(today), { from: half, to: (half + 120) % 1440 })
    expect((await status((value) => value.presence === 'active', 'active by today\'s row')).presenceLabel).toMatch(/^Active/)
    // Every row off but the weekend day that is not today, 11am to 2pm.
    const weekend: HoursGroup = today === 6 ? 'sunday' : 'saturday'
    const since = engine.fake.calls.length
    for (const group of ['weekdays', 'saturday', 'sunday'] as const) await setRow(engine, 'presence', group, group === weekend ? { from: 660, to: 840 } : 'off')
    const away = await status((value) => value.presence === 'away', 'away by the rows')
    expect(away.presenceLabel).toMatch(new RegExp(`^Away until (tomorrow|${weekend === 'saturday' ? 'Sat' : 'Sun'}) 11am`))
    expect(apiSince(engine, 'presence.set', since).map((call) => call.args['presence'])).toEqual(['away'])
  })
})
