/**
 * Active in Slack while Juno is open and you are at the Mac (SPEC 14, "Active
 * in Slack"). Main reads the Mac's idle time through a seam
 * (`juno.setSystemIdle`, 0 at launch), the engine sends socket `tickle`s at
 * most every 19 s (2 s against the fake), and the fake decides what colleagues see
 * (`slack.expectSeenAs`): active while a socket is open, manual presence is
 * active and a tickle came in the last 10 minutes of its clock.
 *
 * Active hours set presence at launch by the time of day, so the test
 * first makes sure you are set active, as the owner would from the menu.
 *
 * `setSystemIdle` reads the idle time at once, so a test can make main say
 * "active" without waiting for its 10 s poll.
 */
import { AUTO_AWAY_MILLIS } from '@juno/fake-slack'
import type { Juno } from './driver/juno'
import { expect, syncedTest as test } from './fixtures'

// The socket spacing itself is covered by packages/slack/test/socket.test.ts.
// Here the real main activity watch samples the fake OS idle time synchronously.
const IDLE_OVER_LIMIT_SECONDS = 11 * 60

/** Set yourself active when the launch left you away. */
async function setActive(juno: Juno): Promise<void> {
  await juno.accountMenu.open()
  const active = juno.accountMenu.item('Set yourself active')
  if ((await active.count()) > 0) await active.click()
  await juno.accountMenu.close()
}

test('Set yourself away and active from the avatar menu, and the avatar shows what Slack shows colleagues', async ({ juno, slack }) => {
  test.setTimeout(150_000)
  await setActive(juno)
  await slack.expectSeenAs('active')
  await juno.sidebar.expectOwnPresence('active')

  await test.step('Set yourself away sets Slack presence and stays away while you use the Mac', async () => {
    await juno.accountMenu.open()
    // A presence.set from the launch's schedule must not count for the click.
    slack.resetCalls()
    await juno.accountMenu.item('Set yourself away').click()
    await slack.expectPresenceSet('away')
    // The menu now offers the other choice and says you are away.
    await juno.accountMenu.open()
    await expect(juno.accountMenu.item('Set yourself active')).toBeVisible()
    await juno.accountMenu.expectPresence(/^Away/)
    await juno.accountMenu.close()
    // With the menu closed, the avatar button's description gives the state; outside notification hours it also says notifications are paused.
    await expect(juno.sidebar.accountButton).toHaveAccessibleDescription(/^Away(\. Notifications paused until .+)?$/)
    slack.resetCalls()
    // You keep using the Mac; Juno sends nothing that would show you active.
    await juno.setSystemIdle(0)
    expect(slack.tickles()).toBe(0)
    await slack.expectSeenAs('away')
  })

  await test.step('Set yourself active sets Slack presence and tickles again', async () => {
    await juno.accountMenu.open()
    await juno.accountMenu.item('Set yourself active').click()
    await slack.expectPresenceSet('active')
    await slack.expectSeenAs('active')
    await juno.accountMenu.open()
    await expect(juno.accountMenu.item('Set yourself away')).toBeVisible()
    await juno.accountMenu.expectPresence(/^Active/)
    await juno.accountMenu.close()
    await expect(juno.sidebar.accountButton).toHaveAccessibleDescription(/^Active(\. Notifications paused until .+)?$/)
    await juno.setSystemIdle(0)
    await expect.poll(() => slack.tickles(), { timeout: 15_000 }).toBeGreaterThan(0)
    await juno.sidebar.expectOwnPresence('active')
  })

  await test.step("Slack's timeout shows you away; the setting stays active", async () => {
    await juno.setSystemIdle(IDLE_OVER_LIMIT_SECONDS)
    slack.advanceClock(AUTO_AWAY_MILLIS + 1_000)
    await slack.expectSeenAs('away')
    expect(slack.fake.workspace.manualPresence).toBe('active')
    await juno.sidebar.expectOwnPresence('away')
    await juno.accountMenu.open()
    await expect(juno.accountMenu.item('Set yourself away')).toBeVisible()
    await juno.accountMenu.expectPresence(/^Active.*\. Slack shows you away$/)
    await juno.accountMenu.close()
  })

  await test.step('back at the Mac, Slack says active and the dot turns green', async () => {
    await expect.poll(async () => { await juno.setSystemIdle(0); return slack.fake.selfPresence() }, { timeout: 15_000 }).toBe('active')
    await juno.sidebar.expectOwnPresence('active')
  })

  await test.step('while the socket is down, the avatar does not claim active', async () => {
    slack.fake.goOffline()
    await juno.sidebar.expectOwnPresence('away')
    await juno.accountMenu.open()
    await juno.accountMenu.expectPresence(/^Active.*\. Connecting to Slack$/)
    await juno.accountMenu.close()
    slack.fake.goOnline()
    await juno.sidebar.expectOwnPresence('active')
  })
})
