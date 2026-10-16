/**
 * Active in Slack while Juno is open and you are at the Mac (SPEC 14, "Active
 * in Slack"). Main reads the Mac's idle time through a seam
 * (`juno.setSystemIdle`, 0 at launch), the engine sends socket `tickle`s at
 * most every 19 s, and the fake decides what colleagues see
 * (`slack.expectSeenAs`): active while a socket is open, manual presence is
 * active and a tickle came in the last 10 minutes of its clock.
 *
 * Active hours set presence at launch by the time of day, so each test
 * first makes sure you are set active, as the owner would from the menu.
 */
import { AUTO_AWAY_MILLIS } from '@juno/fake-slack'
import type { Juno } from './driver/juno'
import { expect, test } from './fixtures'

/** Longer than the 19 s tickle spacing plus one 10 s poll: a tickle would have gone by then. */
const TICKLE_WINDOW_MS = 30_000

/** Set yourself active when the launch left you away. */
async function setActive(juno: Juno): Promise<void> {
  await juno.accountMenu.open()
  const active = juno.accountMenu.item('Set yourself active')
  if ((await active.count()) > 0) await active.click()
  await juno.accountMenu.close()
}

test('opening Juno shows you active in Slack', async ({ juno, slack }) => {
  test.setTimeout(90_000)
  await juno.signIn()
  await juno.waitForSync()
  await setActive(juno)
  await slack.expectSeenAs('active')
  expect(slack.fake.received.filter((frame) => frame.type === 'tickle').every((frame) => frame.reason === 'polling')).toBe(true)
  expect(slack.tickles()).toBeGreaterThan(0)
})

test('Set yourself away stays away while you use the Mac', async ({ juno, slack }) => {
  test.setTimeout(90_000)
  await juno.signIn()
  await juno.waitForSync()
  await setActive(juno)
  await slack.expectSeenAs('active')

  await juno.accountMenu.open()
  await juno.accountMenu.item('Set yourself away').click()
  await slack.expectPresenceSet('away')
  slack.resetCalls()
  // You keep using the Mac; Juno sends nothing that would show you active.
  await juno.win.waitForTimeout(TICKLE_WINDOW_MS)
  expect(slack.tickles()).toBe(0)
  await slack.expectSeenAs('away')

  await juno.accountMenu.open()
  await juno.accountMenu.item('Set yourself active').click()
  await slack.expectPresenceSet('active')
  await slack.expectSeenAs('active')
  await expect.poll(() => slack.tickles(), { timeout: 15_000 }).toBeGreaterThan(0)
})

test('an idle Mac stops keeping you active, and coming back starts it again', async ({ juno, slack }) => {
  test.setTimeout(90_000)
  await juno.signIn()
  await juno.waitForSync()
  await setActive(juno)
  await slack.expectSeenAs('active')

  await juno.setSystemIdle(5 * 60)
  slack.resetCalls()
  await juno.win.waitForTimeout(TICKLE_WINDOW_MS)
  expect(slack.tickles()).toBe(0)
  // Slack's own timeout runs out with no tickle: colleagues see you away.
  slack.advanceClock(AUTO_AWAY_MILLIS + 1_000)
  await slack.expectSeenAs('away')

  await juno.setSystemIdle(0)
  await expect.poll(() => slack.tickles(), { timeout: 15_000 }).toBeGreaterThan(0)
  await slack.expectSeenAs('active')
})
