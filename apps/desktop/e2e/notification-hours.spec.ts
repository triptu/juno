/**
 * Both sets of hours from the owner's side (SPEC 14): the Weekdays,
 * Saturday and Sunday rows in Settings › Notifications. Notification hours
 * hold a message outside them and reach Slack's schedule, Saturday's own
 * hours as custom days; hours saved by an older version still load; the
 * Active in Slack rows set presence by the day. Hours becoming active is
 * covered by the TestClock flow in
 * packages/engine/test/flows/notifications.flow.test.ts.
 */
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, syncedTest, test } from './fixtures'
import { hoursRows, type HoursRowName, type Juno } from './driver/juno'
import { readUserDb } from './driver/userDb'
import { test as agentTest } from './juno-agent/chat'
import { agentReady } from './juno-agent/agent'

const standingByTest = agentTest.extend({ synced: true })

/** Today's weekday (0 is Sunday) and now, down to the half hour, as the app sees them. */
function now(juno: Juno): Promise<{ readonly today: number; readonly half: number }> {
  return juno.win.evaluate(() => {
    const date = new Date()
    return { today: date.getDay(), half: Math.floor((date.getHours() * 60 + date.getMinutes()) / 30) * 30 }
  })
}

/** The row that holds a weekday's hours. */
const rowOf = (day: number): HoursRowName => (day === 6 ? 'Saturday' : day === 0 ? 'Sunday' : 'Weekdays')

/** How Juno decided a message, from its log. */
const outcomeOf = (userData: string, teamId: string, preview: string) =>
  readUserDb(userData, teamId, (db) => db.prepare('SELECT outcome, reason FROM notification_log WHERE preview = ?').get(preview))

standingByTest('outside notification hours a DM is held with its reason and shows no notification', async ({ juno, slack, model, userData, fake }) => {
  await agentReady(juno.surface)
  await juno.notificationHoursNow({ outside: true })
  // The two sets of hours are separate: Active in Slack keeps its weekends off.
  await juno.notifications.expectRow('Active in Slack', 'Saturday', 'off')
  await juno.notifications.expectRow('Active in Slack', 'Sunday', 'off')
  await juno.blurWindow()
  const held = 'Can you approve the release now?'
  slack.as('Maya').dm(held)
  await expect.poll(() => outcomeOf(userData, fake.teamId, held)).toMatchObject({ outcome: 'stay', reason: expect.stringContaining('Outside your notification hours.') })
  expect(await juno.osNotifications()).toHaveLength(0)
  expect(model.inputs()).toHaveLength(0)
})

syncedTest('hours saved by an older version still load; Saturday reaches Slack as a custom day, Weekdays sets all five, and today\'s row decides', async ({ fake, slack, userData, relaunch }) => {
  // As an older version saved them: Monday to Thursday, one from and to.
  const juno = await relaunch({ whileClosed: () => {
    const db = new DatabaseSync(join(userData, 'workspaces', fake.teamId, 'user.db'))
    const old = { notificationHours: { days: [1, 2, 3, 4], from: 600, to: 1020 }, presenceHours: { days: [1, 2, 3, 4, 5], from: 540, to: 1140 }, channels: {}, people: {} }
    db.prepare('INSERT INTO prefs (key, value_json) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json').run('notifications', JSON.stringify(old))
    db.close()
  } })
  await expect(juno.home.navItem).toBeVisible({ timeout: 30_000 })
  await juno.openNotifications()
  const page = juno.notifications
  // Most weekdays have 10am to 5pm, so the Weekdays row shows them.
  await page.expectRow('Notifications', 'Weekdays', { from: 600, to: 1020 })
  await page.expectRow('Notifications', 'Saturday', 'off')
  await page.expectRow('Notifications', 'Sunday', 'off')

  await test.step('Saturday 11am to 2pm reaches Slack as a custom day; Friday stays off', async () => {
    await page.setRow('Notifications', 'Saturday', { from: 660, to: 840 })
    await expect.poll(() => fake.workspace.prefs).toMatchObject({
      dnd_days: 'custom',
      dnd_enabled_monday: 'partial', dnd_before_monday: '10:00', dnd_after_monday: '17:00',
      dnd_enabled_friday: 'all_day',
      dnd_enabled_saturday: 'partial', dnd_before_saturday: '11:00', dnd_after_saturday: '14:00',
      dnd_enabled_sunday: 'all_day',
    })
  })

  await test.step('changing the Weekdays row sets all five weekdays', async () => {
    await page.edge('Notifications', 'Weekdays', 'from').selectOption('540')
    await expect.poll(() => fake.workspace.prefs).toMatchObject({
      dnd_days: 'custom',
      dnd_enabled_monday: 'partial', dnd_before_monday: '09:00', dnd_after_monday: '17:00',
      dnd_enabled_friday: 'partial', dnd_before_friday: '09:00', dnd_after_friday: '17:00',
      dnd_before_saturday: '11:00',
    })
  })

  await juno.sidebar.row('#product').chooseInMenu('notify-always')
  await juno.expectToast('#product: Always')
  const held = 'Roadmap review moved to next week'
  await test.step('outside every row, an Always message is held', async () => {
    await juno.notificationHoursNow({ outside: true })
    slack.as('Leo').postIn('product', held)
    await expect.poll(() => outcomeOf(userData, fake.teamId, held), { timeout: 15_000 })
      .toMatchObject({ outcome: 'stay', reason: expect.stringContaining('Outside your notification hours.') })
  })

  await test.step('today\'s row moved to take in now: the next message notifies', async () => {
    const { today, half } = await now(juno)
    await page.setRow('Notifications', rowOf(today), { from: half, to: (half + 120) % 1440 })
    await juno.tabs.close('Settings')
    await juno.openNotifications()
    await page.expectRow('Notifications', rowOf(today), { from: half, to: (half + 120) % 1440 })
    const shown = 'Pricing review moved to 3pm'
    slack.as('Leo').postIn('product', shown)
    await expect.poll(async () => (await juno.osNotifications()).map((each) => each.body), { timeout: 15_000 }).toContain(shown)
    expect((await juno.osNotifications()).map((each) => each.body)).not.toContain(held)
  })
})

syncedTest('the Active in Slack rows set presence by the day: today\'s row active, then away until the weekend day\'s hours', async ({ juno, slack }) => {
  await juno.openNotifications()
  const page = juno.notifications
  const { today, half } = await now(juno)
  await page.setRow('Active in Slack', rowOf(today), { from: half, to: (half + 120) % 1440 })
  await juno.accountMenu.open()
  await juno.accountMenu.expectPresence(/^Active/)
  await juno.accountMenu.close()

  // Every row off but the weekend day that is not today, 11am to 2pm.
  const weekend: HoursRowName = today === 6 ? 'Sunday' : 'Saturday'
  slack.resetCalls()
  for (const row of hoursRows) await page.setRow('Active in Slack', row, row === weekend ? { from: 660, to: 840 } : 'off')
  await slack.expectPresenceSet('away')
  await juno.accountMenu.open()
  await juno.accountMenu.expectPresence(new RegExp(`^Away until (tomorrow|${weekend.slice(0, 3)}) 11am`))
  await juno.accountMenu.close()
})
