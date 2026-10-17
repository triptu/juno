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

const withSchedule = (schedule: Record<string, unknown>) =>
  bootedEngine(engines, {
    initial: (fake) => {
      fake.workspace.prefs = { ...fake.workspace.prefs, ...schedule }
      return fake.signIn()
    },
  })

const writes = (engine: RunningEngine) => apiCalls(engine, 'users.prefs.set').map((call) => JSON.parse(call.args['prefs'] ?? '{}') as unknown)
const dnd = (engine: RunningEngine) => Object.fromEntries(Object.entries(engine.fake.workspace.prefs).filter(([key]) => key.startsWith('dnd_')))

/** Past the debounce and the pass after it. */
async function settled(engine: RunningEngine): Promise<void> {
  await sleep(2_500)
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

describe("Slack's notification schedule", () => {
  it('on first run writes the notification hours once, after reading the schedule, and not again on restart', async () => {
    const engine = await withSchedule(before)
    await waitFor(() => (writes(engine).length > 0 ? true : undefined), 15_000, 'the first write')
    await settled(engine)
    expect(writes(engine)).toEqual([weekdays])
    // The schedule itself was read first, not taken from the cache.
    expect(apiCalls(engine, 'users.prefs.get').some((call) => call.args['prefs']?.includes('dnd_days') === true)).toBe(true)
    expect(dnd(engine)).toMatchObject(weekdays)
    expect(await pageWhen(engine, (view) => view.canRestore, 'Restore offered')).toEqual({ enabled: true, canRestore: true, changedInSlack: false })

    const next = await restart(engines, engine)
    await next.phase('live', 30_000)
    await settled(next)
    expect(writes(next)).toEqual([])
  })

  it('writes nothing when Slack already holds the hours', async () => {
    const engine = await withSchedule(weekdays)
    await settled(engine)
    expect(writes(engine)).toEqual([])
    expect(apiCalls(engine, 'users.prefs.get').filter((call) => call.args['prefs'] !== undefined)).toEqual([])
  })

  it('changing the hours writes once, with the last values', async () => {
    const engine = await withSchedule(weekdays)
    await settled(engine)
    engine.fake.resetCalls()
    valueOf(await setHours(engine, { days: [1, 2, 3, 4, 5], from: 8 * 60, to: 19 * 60 }))
    valueOf(await setHours(engine, { days: [1, 2, 3, 4, 5], from: 8 * 60, to: 18 * 60 + 30 }))
    await waitFor(() => (writes(engine).length > 0 ? true : undefined), 10_000, 'the write')
    await settled(engine)
    expect(writes(engine)).toEqual([{ dnd_enabled: true, dnd_days: 'weekdays', dnd_start_hour: '18:30', dnd_end_hour: '08:00' }])
    // Presence hours are not Slack's schedule.
    engine.fake.resetCalls()
    valueOf(await runCommand(engine.registry, notificationsSetHours, { which: 'presence', hours: { days: [1, 2, 3], from: 600, to: 960 } }))
    await settled(engine)
    expect(writes(engine)).toEqual([])
  })

  it('Restore puts the saved schedule back and turns the switch off; off, hours stay in Juno', async () => {
    const engine = await withSchedule(before)
    await pageWhen(engine, (view) => view.canRestore, 'Restore offered')
    await settled(engine)
    engine.fake.resetCalls()
    valueOf(await runCommand(engine.registry, notificationsRestoreSlackSchedule, {}))
    expect(writes(engine)).toEqual([before])
    expect(dnd(engine)).toMatchObject(before)
    expect(await pageWhen(engine, (view) => !view.enabled, 'the switch off')).toEqual({ enabled: false, canRestore: false, changedInSlack: false })

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
