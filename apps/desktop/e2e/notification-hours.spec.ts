/**
 * Both sets of hours from the owner's side (SPEC 14): the Weekdays,
 * Saturday and Sunday rows in Settings › Notifications, including hours
 * saved by an older version. What the engine does with the hours is in
 * packages/engine/test/flows: Slack's schedule and presence by the row in
 * notification-hours.flow.test.ts, decisions and hours becoming active in
 * notifications.flow.test.ts.
 */
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, syncedTest, test } from './fixtures'
import { readUserDb } from './driver/userDb'
import { test as agentTest } from './juno-agent/chat'
import { agentReady } from './juno-agent/agent'

const standingByTest = agentTest.extend({ synced: true })

test.describe.configure({ timeout: 90_000 })

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

syncedTest('hours saved by an older version show in the rows, and a row edit is saved', async ({ fake, userData, relaunch }) => {
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

  await page.setRow('Notifications', 'Saturday', { from: 660, to: 840 })
  await juno.tabs.close('Settings')
  await juno.openNotifications()
  await page.expectRow('Notifications', 'Saturday', { from: 660, to: 840 })
  await page.expectRow('Notifications', 'Weekdays', { from: 600, to: 1020 })
})
