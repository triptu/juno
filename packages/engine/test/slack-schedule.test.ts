// Slack's own notification schedule from the notification hours (SPEC 14),
// against the fake: what reaches Slack, when, and Restore.
import { afterEach, describe, expect, it } from 'vitest'
import { notificationsRestoreSlackSchedule, notificationsSetHours, notificationsSetSlackSchedule, type Hours, type SlackScheduleView } from '@juno/contract'
import { notificationsPageAtom, runCommand } from '@juno/state'
import { sleep, waitFor, type RunningEngine } from './harness'
import { apiCalls, bootedEngine, quiet, restart, valueOf } from './scenario'

const engines: Array<RunningEngine> = []
afterEach(async () => {
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
})

/** What the owner had in Slack before Juno: every day, paused from 22:00 to 08:00. */
const before = { dnd_enabled: true, dnd_days: 'every_day', dnd_start_hour: '22:00', dnd_end_hour: '8:00' }
/** Juno's default notification hours, Monday to Friday 9 to 7, as Slack prefs. */
const weekdays = { dnd_enabled: true, dnd_days: 'weekdays', dnd_start_hour: '19:00', dnd_end_hour: '09:00' }

/** The app waits 1 s after a change before it writes; most tests wait less, so their checks that nothing more is written are short. */
const DEBOUNCE_MILLIS = 200
const APP_DEBOUNCE_MILLIS = 1_000

const withSchedule = (schedule: Record<string, unknown>, debounce = DEBOUNCE_MILLIS) =>
  bootedEngine(engines, {
    slackScheduleDebounceMillis: debounce,
    initial: (fake) => {
      fake.workspace.prefs = { ...fake.workspace.prefs, ...schedule }
      return fake.signIn()
    },
  })

const restarted = (engine: RunningEngine) => restart(engines, engine, undefined, { slackScheduleDebounceMillis: DEBOUNCE_MILLIS })

const writes = (engine: RunningEngine) => apiCalls(engine, 'users.prefs.set').map((call) => JSON.parse(call.args['prefs'] ?? '{}') as unknown)
const dnd = (engine: RunningEngine) => Object.fromEntries(Object.entries(engine.fake.workspace.prefs).filter(([key]) => key.startsWith('dnd_')))

/** Past the debounce and the pass after it. */
async function settled(engine: RunningEngine, debounce = DEBOUNCE_MILLIS): Promise<void> {
  await sleep(debounce * 2 + 500)
  await quiet(engine)
}

const setHours = (engine: RunningEngine, hours: Hours) => runCommand(engine.registry, notificationsSetHours, { which: 'notifications', hours })

async function pageWhen(engine: RunningEngine, predicate: (view: SlackScheduleView) => boolean, label: string): Promise<SlackScheduleView> {
  const unmount = engine.registry.mount(notificationsPageAtom)
  try {
    return await waitFor(() => {
      const result = engine.registry.get(notificationsPageAtom)
      return result._tag === 'Success' && predicate(result.value.slackSchedule) ? result.value.slackSchedule : undefined
    }, 10_000, label)
  } finally {
    unmount()
  }
}

describe("Slack's notification schedule: when Juno writes", () => {
  it('never writes default hours: nothing until the owner sets the hours or turns the switch on', async () => {
    const engine = await withSchedule(before)
    await settled(engine)
    expect(writes(engine)).toEqual([])
    expect(dnd(engine)).toMatchObject(before)
    expect(await pageWhen(engine, (view) => view.waitingForHours, 'waiting for hours')).toEqual({ enabled: true, canRestore: false, changedInSlack: false, waitingForHours: true })
    // A restart with the defaults still writes nothing.
    const next = await restarted(engine)
    await next.phase('live', 30_000)
    await settled(next)
    expect(writes(next)).toEqual([])

    // Setting the hours on the page applies them.
    valueOf(await setHours(next, { days: [1, 2, 3, 4, 5], from: 9 * 60, to: 19 * 60 }))
    await waitFor(() => (writes(next).length > 0 ? true : undefined), 10_000, 'the write')
    await settled(next)
    expect(writes(next)).toEqual([weekdays])
  })

  it('turning the switch on writes the hours once, after reading the schedule, and not again on restart', async () => {
    const engine = await withSchedule(before)
    await settled(engine)
    valueOf(await runCommand(engine.registry, notificationsSetSlackSchedule, { enabled: true }))
    await waitFor(() => (writes(engine).length > 0 ? true : undefined), 15_000, 'the first write')
    await settled(engine)
    expect(writes(engine)).toEqual([weekdays])
    // The schedule itself was read first, not taken from the cache.
    expect(apiCalls(engine, 'users.prefs.get').some((call) => call.args['prefs']?.includes('dnd_days') === true)).toBe(true)
    expect(dnd(engine)).toMatchObject(weekdays)
    expect(await pageWhen(engine, (view) => view.canRestore, 'Restore offered')).toEqual({ enabled: true, canRestore: true, changedInSlack: false, waitingForHours: false })

    const next = await restarted(engine)
    await next.phase('live', 30_000)
    await settled(next)
    expect(writes(next)).toEqual([])
  })

  it('writes nothing when Slack already holds the hours', async () => {
    const engine = await withSchedule(weekdays)
    valueOf(await runCommand(engine.registry, notificationsSetSlackSchedule, { enabled: true }))
    await settled(engine)
    expect(writes(engine)).toEqual([])
    expect(apiCalls(engine, 'users.prefs.get').filter((call) => call.args['prefs'] !== undefined)).toEqual([])
  })

  it('changing the hours writes once, with the last values', async () => {
    // The app's own wait, so the two changes fall inside it however slow the machine.
    const engine = await withSchedule(weekdays, APP_DEBOUNCE_MILLIS)
    await settled(engine, APP_DEBOUNCE_MILLIS)
    engine.fake.resetCalls()
    valueOf(await setHours(engine, { days: [1, 2, 3, 4, 5], from: 8 * 60, to: 19 * 60 }))
    valueOf(await setHours(engine, { days: [1, 2, 3, 4, 5], from: 8 * 60, to: 18 * 60 + 30 }))
    await waitFor(() => (writes(engine).length > 0 ? true : undefined), 10_000, 'the write')
    await settled(engine, APP_DEBOUNCE_MILLIS)
    expect(writes(engine)).toEqual([{ dnd_enabled: true, dnd_days: 'weekdays', dnd_start_hour: '18:30', dnd_end_hour: '08:00' }])
    // Presence hours are not Slack's schedule.
    engine.fake.resetCalls()
    valueOf(await runCommand(engine.registry, notificationsSetHours, { which: 'presence', hours: { days: [1, 2, 3], from: 600, to: 960 } }))
    await settled(engine, APP_DEBOUNCE_MILLIS)
    expect(writes(engine)).toEqual([])
  })

})

describe("Slack's notification schedule: Restore and changes made in Slack", () => {
  it('Restore puts the saved schedule back and turns the switch off; off, hours stay in Juno', async () => {
    const engine = await withSchedule(before)
    valueOf(await runCommand(engine.registry, notificationsSetSlackSchedule, { enabled: true }))
    await pageWhen(engine, (view) => view.canRestore, 'Restore offered')
    await settled(engine)
    engine.fake.resetCalls()
    valueOf(await runCommand(engine.registry, notificationsRestoreSlackSchedule, {}))
    expect(writes(engine)).toEqual([before])
    expect(dnd(engine)).toMatchObject(before)
    expect(await pageWhen(engine, (view) => !view.enabled, 'the switch off')).toEqual({ enabled: false, canRestore: false, changedInSlack: false, waitingForHours: false })

    valueOf(await setHours(engine, { days: [0, 1, 2, 3, 4, 5, 6], from: 7 * 60, to: 23 * 60 }))
    await settled(engine)
    expect(writes(engine)).toEqual([before])

    // On again applies the hours once.
    valueOf(await runCommand(engine.registry, notificationsSetSlackSchedule, { enabled: true }))
    await waitFor(() => (writes(engine).length > 1 ? true : undefined), 10_000, 'the write on enable')
    await settled(engine)
    expect(writes(engine)).toEqual([before, { dnd_enabled: true, dnd_days: 'every_day', dnd_start_hour: '23:00', dnd_end_hour: '07:00' }])
  })

  it('a change made in Slack is left alone and shown, until Use Juno’s hours', async () => {
    const engine = await withSchedule(weekdays)
    valueOf(await runCommand(engine.registry, notificationsSetSlackSchedule, { enabled: true }))
    await pageWhen(engine, (view) => !view.waitingForHours, 'the hours applied')
    await settled(engine)
    engine.fake.resetCalls()
    engine.fake.workspace.prefs = { ...engine.fake.workspace.prefs, dnd_end_hour: '10:00' }
    engine.fake.workspace.emit({ type: 'pref_change', name: 'dnd_end_hour', value: '10:00' })
    await pageWhen(engine, (view) => view.changedInSlack, 'the change in Slack shown')
    await settled(engine)
    expect(writes(engine)).toEqual([])

    valueOf(await runCommand(engine.registry, notificationsSetSlackSchedule, { enabled: true }))
    await waitFor(() => (writes(engine).length > 0 ? true : undefined), 10_000, "Juno's hours written")
    await settled(engine)
    expect(writes(engine)).toEqual([weekdays])
    await pageWhen(engine, (view) => !view.changedInSlack, 'the line gone')
  })
})
