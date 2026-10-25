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

test.describe.configure({ timeout: 90_000 })

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
