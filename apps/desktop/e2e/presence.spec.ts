/**
 * Active in Slack while Juno is open and you are at the Mac (SPEC 14, "Active
 * in Slack"). Main reads the Mac's idle time through a seam
 * (`juno.setSystemIdle`, 0 at launch), the engine sends socket `tickle`s at
 * most every 19 s (2 s against the fake), and the fake decides what colleagues see
 * (`slack.expectSeenAs`): active while a socket is open, manual presence is
 * active and a tickle came in the last 10 minutes of its clock.
 *
 * Active hours set presence at launch by the time of day, so each test
 * first makes sure you are set active, as the owner would from the menu.
 *
 * `setSystemIdle` reads the idle time at once, so a test can make main say
 * "active" without waiting for its 10 s poll.
 */
import { AUTO_AWAY_MILLIS } from '@juno/fake-slack'
import type { Juno } from './driver/juno'
import { expect, test } from './fixtures'

// This spec checks the socket's real activity spacing.
test.use({ timing: 'production' })

/** Longer than the fake's 2 s tickle spacing, so pacing cannot be what holds a tickle back. */
const PAST_SPACING_MS = 2_500
/** Main's "active" reaches the engine, and a tickle the fake, well within this. */
const TICKLE_WINDOW_MS = 1_500
/** Main keeps you active while the Mac was used in the last 10 minutes (`ACTIVE_WITHIN_SECONDS`). */
const IDLE_UNDER_LIMIT_SECONDS = 9 * 60
const IDLE_OVER_LIMIT_SECONDS = 11 * 60

/** Past the spacing, main reads the idle time at once; returns after a tickle would have reached the fake. */
async function pollAndWait(juno: Juno, idleSeconds: number): Promise<void> {
  await juno.win.waitForTimeout(PAST_SPACING_MS)
  await juno.setSystemIdle(idleSeconds)
  await juno.win.waitForTimeout(TICKLE_WINDOW_MS)
}

/** Set yourself active when the launch left you away. */
async function setActive(juno: Juno): Promise<void> {
  await juno.accountMenu.open()
  const active = juno.accountMenu.item('Set yourself active')
  if ((await active.count()) > 0) await active.click()
  await juno.accountMenu.close()
}

test('Set yourself away from the avatar menu sets Slack presence and stays away while you use the Mac', async ({ juno, slack }) => {
  test.setTimeout(90_000)
  await juno.signIn()
  await juno.waitForSync()
  await setActive(juno)
  await slack.expectSeenAs('active')

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
  await pollAndWait(juno, 0)
  expect(slack.tickles()).toBe(0)
  await slack.expectSeenAs('away')

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
})

test('the avatar shows what Slack shows colleagues, while the setting stays active', async ({ juno, slack }) => {
  test.setTimeout(90_000)
  await juno.signIn()
  await juno.waitForSync()
  await setActive(juno)
  await slack.expectSeenAs('active')
  await juno.sidebar.expectOwnPresence('active')

  await test.step("Slack's timeout shows you away; the setting stays active", async () => {
    await juno.setSystemIdle(IDLE_OVER_LIMIT_SECONDS)
    await pollAndWait(juno, IDLE_OVER_LIMIT_SECONDS)
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
    await juno.setSystemIdle(0)
    await slack.expectSeenAs('active')
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

// The first step reads every tickle since launch, so it runs before any idle change.
test('opening Juno shows you active, a Mac idle over 10 minutes stops keeping you active, and coming back starts it again', async ({ juno, slack }) => {
  test.setTimeout(120_000)
  await juno.signIn()
  await juno.waitForSync()

  await test.step('opening Juno shows you active in Slack', async () => {
    await setActive(juno)
    await slack.expectSeenAs('active')
    expect(slack.fake.received.filter((frame) => frame.type === 'tickle').every((frame) => frame.reason === 'polling')).toBe(true)
    expect(slack.tickles()).toBeGreaterThan(0)
  })

  await test.step('a Mac idle under 10 minutes keeps you active, over 10 minutes stops, and coming back starts it again', async () => {
    await setActive(juno)
    await slack.expectSeenAs('active')

    // Away from the keyboard for under 10 minutes still counts as here.
    slack.resetCalls()
    await juno.setSystemIdle(IDLE_UNDER_LIMIT_SECONDS)
    await expect.poll(() => slack.tickles(), { timeout: 15_000 }).toBeGreaterThan(0)

    await juno.setSystemIdle(IDLE_OVER_LIMIT_SECONDS)
    slack.resetCalls()
    await pollAndWait(juno, IDLE_OVER_LIMIT_SECONDS)
    expect(slack.tickles()).toBe(0)
    // Slack's own timeout runs out with no tickle: colleagues see you away.
    slack.advanceClock(AUTO_AWAY_MILLIS + 1_000)
    await slack.expectSeenAs('away')

    await juno.setSystemIdle(0)
    await expect.poll(() => slack.tickles(), { timeout: 15_000 }).toBeGreaterThan(0)
    await slack.expectSeenAs('active')
  })
})
