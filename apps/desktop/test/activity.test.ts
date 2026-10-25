/**
 * Active in Slack while you are at the Mac (SPEC 14, "Active in Slack"):
 * main's activity watch with a fake idle time, the real engine over the host
 * link main uses, and the fake Slack, whose clock decides what colleagues see
 * (active while a socket is open, manual presence is active and a tickle came
 * in the last 10 minutes). The avatar reads `notifications.status`.
 */
import { afterEach, expect, it } from 'bun:test'
import { notificationsSetPresence, notificationsStatus, type NotificationStatus } from '@juno/contract'
import { AUTO_AWAY_MILLIS } from '@juno/fake-slack'
import { liveQuery, runCommand } from '@juno/state'
import { waitFor, WAIT_MS, type RunningEngine } from '../../../packages/engine/test/harness'
import { apiCalls, valueOf } from '../../../packages/engine/test/scenario'
import { step } from '../../../packages/engine/test/step'
import { syncedEngine } from '../../../packages/engine/test/synced'
import { ACTIVE_WITHIN_SECONDS, createActivityWatch } from '../src/main/activity'

const engines: RunningEngine[] = []
const unmounts: Array<() => void> = []
afterEach(async () => {
  for (const unmount of unmounts.splice(0)) unmount()
  for (const engine of engines.splice(0)) await engine.stop()
})

it('Set yourself away and active, Slack’s timeout and a dropped socket: the avatar shows what Slack shows colleagues', async () => {
  // No tickle spacing, so each `active` from main can tickle and a missing tickle is the engine's choice.
  const engine = await syncedEngine(engines, { timing: { socketTickleMillis: 0 } })
  const { fake } = engine
  let idleSeconds = 0
  const watch = createActivityWatch({ idleSeconds: () => idleSeconds, locked: () => false, send: (message) => engine.main.host.deliver(message) })
  const atom = liveQuery(notificationsStatus)(undefined)
  unmounts.push(engine.registry.mount(atom))
  const status = (predicate: (value: NotificationStatus) => boolean, label: string) => waitFor(() => {
    const result = engine.registry.get(atom) as { _tag: string; value?: NotificationStatus }
    return result._tag === 'Success' && predicate(result.value!) ? result.value! : undefined
  }, WAIT_MS, label)
  const seenBySlack = (presence: 'active' | 'away') => waitFor(() => (fake.selfPresence() === presence ? true : undefined), WAIT_MS, `Slack shows ${presence}`)
  const tickles = () => fake.received.filter((frame) => frame.type === 'tickle').length
  const setPresence = async (presence: 'active' | 'away') => valueOf(await runCommand(engine.registry, notificationsSetPresence, { presence }))

  // Active hours set presence at start by the time of day, so start active, as the owner would from the menu.
  await setPresence('active')
  watch.poll()
  await seenBySlack('active')
  await status((value) => value.seen === 'active', 'the avatar active')

  await step('Set yourself away sets Slack presence and stays away while you use the Mac', async () => {
    fake.resetCalls()
    await setPresence('away')
    expect(apiCalls(engine, 'presence.set').map((call) => call.args['presence'])).toEqual(['away'])
    expect((await status((value) => value.presence === 'away' && value.seen === 'away', 'the avatar away')).presenceLabel).toMatch(/^Away/)
    // You keep using the Mac; Juno sends nothing that would show you active.
    watch.poll()
    await engine.socketIdle()
    expect(tickles()).toBe(0)
    expect(fake.selfPresence()).toBe('away')
  })

  await step('Set yourself active sets Slack presence and tickles again', async () => {
    fake.resetCalls()
    await setPresence('active')
    expect(apiCalls(engine, 'presence.set').map((call) => call.args['presence'])).toEqual(['active'])
    watch.poll()
    await waitFor(() => (tickles() > 0 ? true : undefined), WAIT_MS, 'a tickle')
    await seenBySlack('active')
    expect((await status((value) => value.presence === 'active' && value.seen === 'active', 'the avatar active')).presenceLabel).toMatch(/^Active/)
  })

  await step('away from the Mac, Slack’s timeout shows you away and the setting stays active', async () => {
    idleSeconds = ACTIVE_WITHIN_SECONDS + 60
    watch.poll()
    fake.advanceClock({ millis: AUTO_AWAY_MILLIS + 1_000 })
    await seenBySlack('away')
    expect(fake.workspace.manualPresence).toBe('active')
    const away = await status((value) => value.seen === 'away', 'the avatar away')
    expect(away.presence).toBe('active')
    expect(away.presenceLabel).toMatch(/^Active.*\. Slack shows you away$/)
  })

  await step('back at the Mac, Slack shows you active again', async () => {
    idleSeconds = 0
    watch.poll()
    await seenBySlack('active')
    await status((value) => value.seen === 'active', 'the avatar active')
  })

  await step('while the socket is down, the avatar does not claim active', async () => {
    fake.goOffline()
    expect((await status((value) => value.seen === null, 'the avatar unknown')).presenceLabel).toMatch(/^Active.*\. Connecting to Slack$/)
    fake.goOnline()
    watch.poll()
    await status((value) => value.seen === 'active', 'the avatar active after the socket is back')
  })
})
