/**
 * Notifications from the owner's side (SPEC 14): Notify me on a channel,
 * thread or person, the OS notification, its title for a group DM, and its click (on a topic
 * already open in a tab it is a step of topic.spec.ts), why a message did or did not notify, the
 * Notifications and Ignored sections of Settings, and the test
 * notification and macOS permission line. Presence (away and active) is
 * in apps/desktop/test/activity.test.ts.
 * Main records OS notifications instead of showing them
 * (`junoTest.notifications`) and fakes macOS's permission
 * (`junoTest.notificationPermission`).
 */
import { expect, syncedTest, test } from './fixtures'
import type { Juno } from './driver/juno'

test.describe.configure({ timeout: 90_000 })

const ALERTS_MAIN = '#alerts-prod'
const ROADMAP = 'Proposal: cut offline mode and public'

// The defaults are read first, before any step changes a setting. Electron only: the permission line and the test
// notification are main's. What the engine keeps (Tidy up's quick changes, Ignore with Undo, the hours) is in its flow tests.
syncedTest('Settings: Notifications and Appearance save, the test notification and permission line, Ignored, and Tidy up', { tag: '@electron' }, async ({ juno }) => {
  await test.step('Settings › Notifications saves hours, and Appearance changes the density', () => notificationsAndAppearance(juno))
  await test.step('Send test notification posts one notification, and a line shows when macOS does not let Juno notify', () => testNotificationAndPermission(juno))
  await test.step('Settings › Ignored lists an ignored channel, and Stop ignoring has Undo', () => ignoredChannels(juno))
  await test.step('Settings › Ignored ignores a channel picked by keyboard, as its menu does, with Undo', () => ignoreFromSettings(juno))
  await test.step('Tidy up saves rapid changes to separate controls', () => tidyUpRapidChanges(juno))
})

async function notificationsAndAppearance(juno: Juno): Promise<void> {
  await juno.openNotifications()
  const page = juno.notifications

  await page.edge('Notifications', 'Weekdays', 'from').selectOption({ label: '10am' })
  await page.edge('Active in Slack', 'Weekdays', 'to').selectOption({ label: '8pm' })

  // Every value comes back from the engine: close Settings and open it again.
  await juno.tabs.close('Settings')
  await juno.openNotifications()
  await page.expectRow('Notifications', 'Weekdays', { from: 10 * 60, to: 19 * 60 })
  await page.expectRow('Active in Slack', 'Weekdays', { from: 9 * 60, to: 20 * 60 })
  await page.expectRow('Active in Slack', 'Saturday', 'off')

  // Settings is one tab: the avatar menu's Settings shows General in it, and the list moves between sections.
  await juno.openSettings('Appearance')
  await expect(juno.tabs.tab('Settings')).toHaveCount(1)
  await expect(juno.settings.themeRadio('System')).toHaveAttribute('aria-checked', 'true')
  // Compact is the default for a user who never chose one.
  await expect(juno.settings.densityRadio('Compact')).toHaveAttribute('aria-checked', 'true')
  await expect.poll(() => juno.win.evaluate(() => document.documentElement.dataset['density'])).toBe('compact')
  await juno.settings.densityRadio('Comfortable').click()
  await expect.poll(() => juno.win.evaluate(() => document.documentElement.dataset['density'])).toBe('comfortable')
  await juno.settings.show('Notifications')
  await expect(page.edge('Notifications', 'Weekdays', 'from')).toHaveValue(String(10 * 60))
}

async function tidyUpRapidChanges(juno: Juno): Promise<void> {
  await juno.openSettings('Tidy up')
  const checks = juno.settings.root.getByRole('checkbox', { name: /^(Threads|Direct messages)$/ })
  await expect(checks).toHaveCount(2)
  await expect(juno.settings.root.getByRole('checkbox', { name: 'Threads', exact: true })).toBeChecked()
  await expect(juno.settings.root.getByRole('checkbox', { name: 'Direct messages', exact: true })).toBeChecked()
  // Activate both before a saved page model can arrive, as two quick user changes can do.
  await checks.evaluateAll((nodes) => {
    for (const node of nodes) if (node instanceof HTMLInputElement) node.click()
  })
  await juno.tabs.close('Settings')
  await juno.openSettings('Tidy up')
  await expect(juno.settings.root.getByRole('checkbox', { name: 'Threads', exact: true })).not.toBeChecked()
  await expect(juno.settings.root.getByRole('checkbox', { name: 'Direct messages', exact: true })).not.toBeChecked()
  await expect(juno.settings.root.getByRole('radio', { name: '4 hours', exact: true })).toHaveAttribute('aria-checked', 'true')
}

async function testNotificationAndPermission(juno: Juno): Promise<void> {
  await juno.openNotifications()
  const page = juno.notifications
  const line = page.root.getByRole('status', { name: 'Notification permission' })
  const test = { title: 'Juno', body: 'Notifications from Juno look like this.' }

  // Allowed: no line, and the button posts one notification the way a message's is posted.
  await expect(page.root.getByRole('button', { name: 'Send test notification' })).toBeVisible()
  await expect(line).toHaveCount(0)
  await page.root.getByRole('button', { name: 'Send test notification' }).click()
  await expect.poll(async () => (await juno.osNotifications()).filter((shown) => shown.title === test.title && shown.body === test.body)).toHaveLength(1)

  // Denied: the line and Open Notification Settings, read again when the window regains focus.
  await juno.setNotificationPermission({ authorization: 'denied', badges: 'disabled' })
  await juno.win.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(line).toContainText("macOS is not showing Juno's notifications.")
  await line.getByRole('button', { name: 'Open Notification Settings' }).click()
  await expect.poll(() => juno.notificationSettingsOpened()).toBe(1)

  // Alerts may be allowed while app icon badges alone are off.
  await juno.setNotificationPermission({ authorization: 'allowed', badges: 'disabled' })
  await juno.win.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(line).toContainText('Dock badges are off for Juno.')
  await line.getByRole('button', { name: 'Open Notification Settings' }).click()
  await expect.poll(() => juno.notificationSettingsOpened()).toBe(2)

  // Turned on in System Settings: back in Juno, the line goes.
  await juno.setNotificationPermission({ authorization: 'allowed', badges: 'enabled' })
  await juno.win.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(line).toHaveCount(0)

  // Not asked yet: the action asks macOS instead, and the line goes once allowed.
  await juno.setNotificationPermission({ authorization: 'notDetermined', badges: 'unknown' })
  await juno.win.evaluate(() => window.dispatchEvent(new Event('focus')))
  await line.getByRole('button', { name: 'Allow notifications' }).click()
  await expect(line).toHaveCount(0)
  expect(await juno.notificationSettingsOpened()).toBe(2)
}

async function ignoredChannels(juno: Juno): Promise<void> {
  await juno.openSettings('Ignored')
  const settings = juno.settings
  await expect(settings.root.getByText('Nothing ignored.')).toBeVisible()

  await juno.sidebar.selectView('Automated')
  await juno.sidebar.row(ALERTS_MAIN).chooseInMenu('ignore-channel')
  await juno.expectToast('Ignoring #alerts-prod')
  await juno.tabs.select('Settings')
  await expect(settings.ignored('alerts-prod')).toContainText('Nothing hidden yet')

  await settings.stopIgnoring('alerts-prod')
  await juno.expectToast('Stopped ignoring #alerts-prod')
  await expect(settings.root.getByText('Nothing ignored.')).toBeVisible()
  await juno.undoFromToast()
  await expect(settings.ignored('alerts-prod')).toBeVisible()
  await expect(settings.root.getByText('Nothing ignored.')).toHaveCount(0)
}

async function ignoreFromSettings(juno: Juno): Promise<void> {
  await juno.sidebar.filter('All')
  const roadmap = juno.sidebar.row(ROADMAP)
  await roadmap.expectVisible()
  await juno.tabs.select('Settings')
  const settings = juno.settings
  await expect(settings.ignoreButton).toBeDisabled()

  // A key typed on the closed select opens its list with that text; the ignored #alerts-prod is not offered.
  await settings.ignoreSelect.focus()
  await juno.win.keyboard.type('p')
  await expect(settings.ignoreOptions).toHaveText(['platform', 'product'])
  await juno.win.keyboard.press('ArrowDown')
  await juno.win.keyboard.press('Enter')
  await expect(settings.ignoreOptions).toHaveCount(0)
  await expect(settings.ignoreSelect).toBeFocused()
  await expect(settings.ignoreSelect).toHaveText('product')

  await settings.ignoreButton.click()
  await juno.expectToast('Ignoring #product')
  await expect(settings.ignored('product')).toBeVisible()
  await roadmap.expectAbsent()
  await expect(settings.ignoreButton).toBeDisabled()
  await settings.ignoreSelect.click()
  await juno.win.keyboard.type('product')
  await expect(juno.win.getByText('No match.')).toBeVisible()
  await juno.win.keyboard.press('Escape')

  await juno.undoFromToast()
  await expect(settings.ignored('product')).toHaveCount(0)
  await roadmap.expectVisible()
}
