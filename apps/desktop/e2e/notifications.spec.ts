import { readUserDb } from './driver/userDb'
/**
 * Notifications from the owner's side (SPEC 14): Notify me on a channel,
 * thread or person, the OS notification, its title for a group DM, and its click (also on a topic
 * already open in a tab), why a message did or did not notify, the
 * Notifications and Ignored sections of Settings, and the test
 * notification and macOS permission line. Set yourself away and active
 * is in presence.spec.ts.
 * Main records OS notifications instead of showing them
 * (`junoTest.notifications`) and fakes macOS's permission
 * (`junoTest.notificationPermission`).
 */
import { seedWorkspace, startFakeSlack, topic300Seed } from '@juno/fake-slack'
import { expect, syncedTest, test } from './fixtures'
import { watchFlashes } from './driver/flashes'
import type { Juno } from './driver/juno'
import { test as agentTest } from './juno-agent/chat'
import { agentReady } from './juno-agent/agent'

const ALERTS_MAIN = '#alerts-prod'
const ROADMAP = 'Proposal: cut offline mode and public'
const RINA = 'Rina finished the onsite'
const LONG_THREAD = 'Review the rollout checklist 1.'

syncedTest('Notify me on a channel lists it on the page, and removing it there has Undo', async ({ juno }) => {
  // A bot channel: the Automated view holds it.
  await juno.sidebar.selectView('Automated')
  const alerts = juno.sidebar.row(ALERTS_MAIN)
  const before = await alerts.chooseInMenu('notify-never')
  expect(before.labels).toContain('> Auto ✓')
  await juno.expectToast('#alerts-prod: Never')
  const after = await alerts.chooseInMenu('mark-read')
  expect(after.labels).toContain('> Never ✓')

  // A thread: Always follows it and is kept as its level.
  await juno.sidebar.filter('All')
  const rina = juno.sidebar.row(RINA)
  await rina.chooseInMenu('notify-always')
  // The toast names the topic by its title, which drops the final full stop.
  await juno.expectToast(': Always')
  expect((await rina.chooseInMenu('mark-read')).labels).toContain('> Always ✓')

  await juno.openNotifications()
  const page = juno.notifications
  await expect(page.level('Never')).toContainText('alerts-prod')
  await page.removeTag('alerts-prod')
  await juno.expectToast('#alerts-prod: Auto')
  await expect(page.level('Never')).not.toContainText('alerts-prod')
  await juno.undoFromToast()
  await expect(page.level('Never')).toContainText('alerts-prod')
})

syncedTest('a group DM notifies under its people\'s names, not Slack\'s internal name', async ({ juno, slack }) => {
  await juno.notificationHoursNow()
  await juno.sidebar.row('Maya, Leo', { exact: true }).open()
  await juno.topic.chooseInMessageMenu('lunch friday?', 'notify-always', { onSender: true })
  await juno.expectToast('Leo: Always')

  await juno.openNotifications()
  slack.as('Leo').groupDm('Moved it to 1pm')
  await expect.poll(() => juno.osNotifications(), { timeout: 15_000 }).toContainEqual({ title: 'Maya, Leo', body: 'Moved it to 1pm' })
})

syncedTest('a DM set to Always notifies, and the click opens it at the message', async ({ juno, slack }) => {
  // Maya's DM is on the page's Always list once set from the person menu.
  await juno.notificationHoursNow()
  await juno.sidebar.row('Maya', { exact: true }).open()
  await juno.topic.expectTitle('Maya')
  slack.as('Maya').dm('Here is the hiring plan for today.')
  await juno.topic.expectMessage('Here is the hiring plan for today.')
  const person = await juno.topic.chooseInMessageMenu('Here is the hiring plan for today.', 'notify-always', { onSender: true })
  expect(person.labels).toEqual(['Notify me about Maya', '> Always', '> Auto ✓', '> Never', '> -', '> How Auto decides…', '-', 'Ask Juno', 'What Juno knows about Maya'])
  await juno.expectToast('Maya: Always')

  // Away from the DM, a new message from Maya notifies. Clicking it opens the DM at the message.
  await juno.openNotifications()
  slack.as('Maya').dm('The offer letter needs your signature')
  await expect.poll(() => juno.osNotifications(), { timeout: 15_000 }).toContainEqual({ title: 'Maya', body: 'The offer letter needs your signature' })
  const shown = (await juno.osNotifications()).findIndex((notification) => notification.body === 'The offer letter needs your signature')
  await juno.clickOsNotification(shown)
  await juno.tabs.expectActive('Maya')
  await juno.topic.expectMessage('The offer letter needs your signature')

  // The message menu has no why row; how a message notified is on the Notifications page.
  const menu = await juno.topic.chooseInMessageMenu('The offer letter needs your signature', null)
  expect(menu.labels.some((label) => label.startsWith('Why'))).toBe(false)
})

syncedTest('a topic on screen in a focused window does not notify, and unread topics badge the dock', async ({ juno, slack, fake, userData }) => {
  await expect.poll(() => juno.dockBadge(), { timeout: 15_000 }).toBe('•')
  await juno.notificationHoursNow()

  await juno.sidebar.selectView('Automated')
  await juno.sidebar.row(ALERTS_MAIN).chooseInMenu('notify-always')
  await juno.sidebar.row(ALERTS_MAIN).open()
  await juno.focusWindow()
  slack.as('Leo').postIn('alerts-prod', 'Disk at 91% on db-2')
  await juno.topic.expectMessage('Disk at 91% on db-2')
  await expect.poll(() => readUserDb(userData, fake.teamId, (db) => db.prepare('SELECT suppressed_at FROM notification_log WHERE preview LIKE ?').get('%Disk at 91% on db-2%')?.['suppressed_at'])).toEqual(expect.any(String))
  expect((await juno.osNotifications()).map((notification) => notification.body)).not.toContain('Disk at 91% on db-2')

  await juno.blurWindow()
  slack.as('Leo').postIn('alerts-prod', 'Disk at 95% on db-2')
  await expect.poll(async () => (await juno.osNotifications()).map((notification) => notification.body), { timeout: 15_000 }).toContain('Disk at 95% on db-2')
})

// The defaults are read first, before any step changes a setting.
syncedTest('Settings: Notifications and Appearance save, the test notification and permission line, and Ignored', { tag: '@canary' }, async ({ juno }) => {
  await test.step('Settings › Notifications saves hours, and Appearance changes the density', () => notificationsAndAppearance(juno))
  await test.step('Send test notification posts one notification, and a line shows when macOS does not let Juno notify', () => testNotificationAndPermission(juno))
  await test.step('Settings › Ignored lists an ignored channel, and Stop ignoring has Undo', () => ignoredChannels(juno))
  await test.step('Settings › Ignored ignores a channel picked by keyboard, as its menu does, with Undo', () => ignoreFromSettings(juno))
})

async function notificationsAndAppearance(juno: Juno): Promise<void> {
  await juno.openNotifications()
  const page = juno.notifications

  await page.setFrom('Notifications', '10am')
  await page.setTo('Active in Slack', '8pm')
  await page.day('Notifications', 'Saturday').click()

  // Every value comes back from the engine: close Settings and open it again.
  await juno.tabs.close('Settings')
  await juno.openNotifications()
  await expect(page.root.getByRole('combobox', { name: 'Notifications from' })).toHaveValue(String(10 * 60))
  await expect(page.root.getByRole('combobox', { name: 'Active in Slack to' })).toHaveValue(String(20 * 60))
  await expect(page.day('Notifications', 'Saturday')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.day('Active in Slack', 'Saturday')).toHaveAttribute('aria-pressed', 'false')

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
  await expect(page.root.getByRole('combobox', { name: 'Notifications from' })).toHaveValue(String(10 * 60))
}

syncedTest('Tidy up saves rapid changes to separate controls', async ({ juno }) => {
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
})

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
  await expect(settings.ignoreSelect).toHaveAccessibleName('Channel to ignore: product')

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

const longThread = test.extend({
  // oxlint-disable-next-line no-empty-pattern
  fake: async ({}, use) => {
    const fake = await startFakeSlack({
      seed: (workspace, avatars) => {
        seedWorkspace(workspace, avatars)
        topic300Seed()(workspace, avatars)
      },
    })
    await use(fake)
    await fake.close()
  },
})

longThread('a notification for a topic open in another tab focuses it, scrolls to the message and flashes it', async ({ juno, slack }) => {
  longThread.setTimeout(90_000)
  await juno.signIn()
  await juno.waitForSync()
  await juno.notificationHoursNow()
  const thread = juno.sidebar.row(LONG_THREAD)
  await thread.chooseInMenu('notify-always')
  await juno.expectToast(': Always')
  await thread.open()
  await juno.topic.expectAtBottom()
  await juno.topic.scrollToTop()
  await juno.sidebar.row(RINA).openInNewTab()
  await juno.tabs.expectActive('Rina finished the onsite')
  const flashes = await watchFlashes(juno.win)

  slack.as('Leo').replyIn(LONG_THREAD, 'Cutover is a go')
  await expect.poll(async () => (await juno.osNotifications()).map((notification) => notification.body), { timeout: 15_000 }).toContain('Cutover is a go')
  const shown = (await juno.osNotifications()).findIndex((notification) => notification.body === 'Cutover is a go')
  await juno.clickOsNotification(shown)

  await juno.tabs.expectActive('Review the rollout checklist 1')
  const reply = juno.topic.message('Cutover is a go')
  await expect(reply).toBeInViewport({ ratio: 1 })
  await expect.poll(flashes).toContainEqual(expect.stringContaining('Cutover is a go'))
  // Back to the other tab and here again: the request was taken once, so nothing flashes again.
  const before = (await flashes()).length
  await juno.tabs.select('Rina finished the onsite')
  await juno.tabs.select('Review the rollout checklist 1')
  await juno.topic.expectMessage('Cutover is a go')
  expect(await flashes()).toHaveLength(before)
})

// Hours becoming active is covered by the TestClock flow in packages/engine/test/flows/notifications.flow.test.ts.
const standingByTest = agentTest.extend({ synced: true })

const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Read the saved settings: a select's DOM value changes before its RPC commits. */
function savedSettings(userData: string, teamId: string): unknown {
  return readUserDb(userData, teamId, (db) => {
    const row = db.prepare("SELECT value_json FROM prefs WHERE key = 'notifications'").get()
    return typeof row?.value_json === 'string' ? JSON.parse(row.value_json) : undefined
  })
}

type ReadSettings = () => unknown

/** Include both sides of midnight, even when the test starts on a weekend. */
async function everyDay(juno: Juno, saved: ReadSettings): Promise<void> {
  for (const [day, name] of weekdays.entries()) {
    const toggle = juno.notifications.day('Notifications', name)
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click()
    await expect.poll(saved).toMatchObject({ notificationHours: { days: expect.arrayContaining([day]) } })
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  }
}

/** Set one edge of the notification hours and check it saved. */
async function setHours(juno: Juno, saved: ReadSettings, edge: 'from' | 'to', minutes: number): Promise<void> {
  const select = juno.notifications.root.getByRole('combobox', { name: `Notifications ${edge}` })
  await select.selectOption(String(minutes))
  await expect.poll(saved).toMatchObject({ notificationHours: { [edge]: minutes } })
  // Reopen to check the saved value, rather than the select's optimistic DOM value.
  await juno.tabs.close('Settings')
  await juno.openNotifications()
  await expect(select).toHaveValue(String(minutes))
}

/** A twelve-hour window that starts six hours from now, so now is outside it. */
async function excludeNow(juno: Juno, saved: ReadSettings): Promise<void> {
  await everyDay(juno, saved)
  const middle = Math.floor(minutesNow() / 30) * 30
  await setHours(juno, saved, 'from', (middle + 6 * 60) % 1440)
  await setHours(juno, saved, 'to', (middle + 18 * 60) % 1440)
}

const minutesNow = () => {
  const now = new Date()
  return now.getHours() * 60 + now.getMinutes()
}

standingByTest('outside notification hours a DM is held with its reason and shows no notification', async ({ juno, slack, model, userData, fake }) => {
  await agentReady(juno.surface)
  await juno.openNotifications()
  const page = juno.notifications
  const saturday = page.day('Notifications', 'Saturday')
  const sunday = page.day('Notifications', 'Sunday')
  await expect(saturday).toHaveAttribute('aria-pressed', 'false')
  await expect(sunday).toHaveAttribute('aria-pressed', 'false')
  // Both events use the same saved model, before either command can update the page.
  await saturday.or(sunday).evaluateAll((nodes) => {
    for (const node of nodes) if (node instanceof HTMLButtonElement) node.click()
  })
  await juno.tabs.close('Settings')
  await juno.openNotifications()
  await expect(saturday).toHaveAttribute('aria-pressed', 'true')
  await expect(sunday).toHaveAttribute('aria-pressed', 'true')
  await expect(page.day('Active in Slack', 'Saturday')).toHaveAttribute('aria-pressed', 'false')
  await juno.openNotifications()
  await excludeNow(juno, () => savedSettings(userData, fake.teamId))
  await juno.blurWindow()
  const held = 'Can you approve the release now?'
  slack.as('Maya').dm(held)
  await expect.poll(() => readUserDb(userData, fake.teamId, (db) => db.prepare('SELECT outcome, reason FROM notification_log WHERE preview = ?').get(held))).toMatchObject({ outcome: 'stay', reason: expect.stringContaining('Outside your notification hours.') })
  expect(await juno.osNotifications()).toHaveLength(0)
  expect(model.inputs()).toHaveLength(0)
})
