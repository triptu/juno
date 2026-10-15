/**
 * Notifications from the owner's side (SPEC 14): Notify me on a channel,
 * thread or person, the OS notification and its click, why a message did
 * or did not notify, the Notifications page, Preferences and its ignore
 * list, and Set yourself away or active. Main records OS notifications instead of
 * showing them (`junoTest.notifications`).
 */
import { expect, test } from './fixtures'

const ALERTS_MAIN = '#alerts-prod'
const RINA = 'Rina finished the onsite.'

test('Notify me on a channel lists it on the page, and removing it there has Undo', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()

  // A bot channel: the Automated view holds it.
  await juno.sidebar.selectView('Automated')
  const alerts = juno.sidebar.row(ALERTS_MAIN)
  const before = await alerts.chooseInMenu('notify-never')
  expect(before.labels).toContain('> When it matters ✓')
  await juno.expectToast('#alerts-prod: Never')
  const after = await alerts.chooseInMenu('mark-read')
  expect(after.labels).toContain('> Never ✓')

  // A thread: Every message follows it and is kept as its level.
  await juno.sidebar.filter('All')
  const rina = juno.sidebar.row(RINA)
  await rina.chooseInMenu('notify-every')
  // The toast names the topic by its title, which drops the final full stop.
  await juno.expectToast(': Every message')
  expect((await rina.chooseInMenu('mark-read')).labels).toContain('> Every message ✓')

  await juno.openNotifications()
  const page = juno.notifications
  await expect(page.level('Never')).toContainText('alerts-prod')
  await page.removeTag('alerts-prod')
  await juno.expectToast('#alerts-prod: When it matters')
  await expect(page.root.getByText('Every channel and person is set to When it matters.')).toBeVisible()
  await juno.undoFromToast()
  await expect(page.level('Never')).toContainText('alerts-prod')
})

test('a DM set to Every message notifies, the click opens it at the message, and the menu says why', async ({ juno, slack }) => {
  await juno.signIn()
  await juno.waitForSync()

  // Maya's DM is on the page's Every message list once set from the person menu.
  slack.as('Maya').dm('Can you look at the hiring plan today?')
  await juno.sidebar.row('Maya', { exact: true }).open()
  await juno.topic.expectMessage('Can you look at the hiring plan today?')
  const person = await juno.topic.chooseInMessageMenu('Can you look at the hiring plan today?', 'notify-every', { onSender: true })
  expect(person.labels).toEqual(['Notify me about Maya', '> Every message', '> When it matters ✓', '> Never', '-', 'Ask Juno'])
  await juno.expectToast('Maya: Every message')

  // Away from the DM, a new message from Maya notifies. Clicking it opens the DM at the message.
  await juno.openNotifications()
  slack.as('Maya').dm('The offer letter needs your signature')
  await expect.poll(() => juno.osNotifications(), { timeout: 15_000 }).toContainEqual({ title: 'Maya', body: 'The offer letter needs your signature' })
  const shown = (await juno.osNotifications()).findIndex((notification) => notification.body === 'The offer letter needs your signature')
  await juno.clickOsNotification(shown)
  await juno.tabs.expectActive('Maya')
  await juno.topic.expectMessage('The offer letter needs your signature')

  // Why did this notify? The setting decided it, so the popover offers Change.
  const menu = await juno.topic.chooseInMessageMenu('The offer letter needs your signature', 'why')
  expect(menu.labels).toContain('Why did this notify?')
  const why = juno.whyPopover(/^Notified you at \d\d:\d\d$/)
  await expect(why).toContainText('Maya is set to Every message')
  await juno.chooseNextMenuItem('notify-matters')
  await why.getByRole('button', { name: 'Change' }).click()
  await juno.expectToast('Maya: When it matters')
  await expect(why).toHaveCount(0)

  // A channel message without a mention never reaches the pipeline, and the menu says so.
  await juno.sidebar.selectView('Automated')
  await juno.sidebar.row(ALERTS_MAIN).open()
  slack.as('Leo').postIn('alerts-prod', 'Weekly error report is up')
  await juno.topic.expectMessage('Weekly error report is up')
  const quiet = await juno.topic.chooseInMessageMenu('Weekly error report is up', 'why')
  expect(quiet.labels).toContain('Why no notification?')
  const none = juno.whyPopover("Didn't notify you")
  await expect(none).toContainText('Juno checks DMs, mentions of you, and places set to Every message.')
  await juno.win.keyboard.press('Escape')
  await expect(none).toHaveCount(0)
})

test('a topic on screen in a focused window does not notify, and unread mentions badge the dock', async ({ juno, slack }) => {
  await juno.signIn()
  await juno.waitForSync()
  await expect.poll(() => juno.dockBadge(), { timeout: 15_000 }).toBe('•')

  await juno.sidebar.selectView('Automated')
  await juno.sidebar.row(ALERTS_MAIN).chooseInMenu('notify-every')
  await juno.sidebar.row(ALERTS_MAIN).open()
  await juno.focusWindow()
  slack.as('Leo').postIn('alerts-prod', 'Disk at 91% on db-2')
  await juno.topic.expectMessage('Disk at 91% on db-2')
  // Give the engine time to decide; nothing was shown for the topic on screen.
  await juno.win.waitForTimeout(1_000)
  expect((await juno.osNotifications()).map((notification) => notification.body)).not.toContain('Disk at 91% on db-2')

  await juno.blurWindow()
  slack.as('Leo').postIn('alerts-prod', 'Disk at 95% on db-2')
  await expect.poll(async () => (await juno.osNotifications()).map((notification) => notification.body), { timeout: 15_000 }).toContain('Disk at 95% on db-2')
})

test('the Notifications page saves hours and what matters, and Preferences changes the density', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.openNotifications()
  const page = juno.notifications

  await page.setFrom('Notifications', '10am')
  await page.setTo('Active in Slack', '8pm')
  await page.day('Notifications', 'Saturday').click()
  await page.writeMatters('The launch and hiring.')

  // Every value comes back from the engine: close the page and open it again.
  await juno.tabs.close('Notifications')
  await juno.openNotifications()
  await expect(page.root.getByRole('combobox', { name: 'Notifications from' })).toHaveValue(String(10 * 60))
  await expect(page.root.getByRole('combobox', { name: 'Active in Slack to' })).toHaveValue(String(20 * 60))
  await expect(page.day('Notifications', 'Saturday')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.day('Active in Slack', 'Saturday')).toHaveAttribute('aria-pressed', 'false')
  await expect(page.matters).toHaveValue('The launch and hiring.')

  await juno.openPreferences()
  await expect(juno.preferences.themeRadio('System')).toHaveAttribute('aria-checked', 'true')
  await juno.preferences.densityRadio('Compact').click()
  await expect.poll(() => juno.win.evaluate(() => document.documentElement.dataset['density'])).toBe('compact')
  await juno.preferences.root.getByRole('button', { name: 'Open notification settings' }).click()
  await juno.tabs.expectActive('Notifications')
})

test('Set yourself away and active from the avatar menu sets Slack presence', async ({ juno, slack }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.accountMenu.open()
  // The schedule applied at launch decides where it starts.
  const away = juno.accountMenu.item('Set yourself away')
  const startsActive = (await away.count()) > 0
  slack.resetCalls()
  await juno.accountMenu.item(startsActive ? 'Set yourself away' : 'Set yourself active').click()
  await slack.expectPresenceSet(startsActive ? 'away' : 'auto')
  await juno.accountMenu.open()
  await expect(juno.accountMenu.item(startsActive ? 'Set yourself active' : 'Set yourself away')).toBeVisible()
  await juno.accountMenu.expectPresence(startsActive ? /^Away/ : /^Active/)

  // And back.
  slack.resetCalls()
  await juno.accountMenu.item(startsActive ? 'Set yourself active' : 'Set yourself away').click()
  await slack.expectPresenceSet(startsActive ? 'auto' : 'away')
})

test('Preferences lists an ignored channel, and Stop ignoring has Undo', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.openPreferences()
  const preferences = juno.preferences
  await expect(preferences.root.getByText('Nothing ignored.')).toBeVisible()

  await juno.sidebar.selectView('Automated')
  await juno.sidebar.row(ALERTS_MAIN).chooseInMenu('ignore-channel')
  await juno.expectToast('Ignoring #alerts-prod')
  await juno.tabs.select('Preferences')
  await expect(preferences.ignored('alerts-prod')).toContainText('Nothing hidden yet')

  await preferences.stopIgnoring('alerts-prod')
  await juno.expectToast('Stopped ignoring #alerts-prod')
  await expect(preferences.root.getByText('Nothing ignored.')).toBeVisible()
  await juno.undoFromToast()
  await expect(preferences.ignored('alerts-prod')).toBeVisible()
  await expect(preferences.root.getByText('Nothing ignored.')).toHaveCount(0)
})
