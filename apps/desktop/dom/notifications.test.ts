/**
 * Notifications from the owner's side (SPEC 14): Notify me on a channel,
 * thread or person, the OS notification and its title for a group DM, its
 * click, and the dock badge. The host's shell records OS notifications
 * instead of showing them. Landing on a message in a long thread and the
 * Settings forms are notifications.spec.ts's.
 */
import { readUserDb } from '../e2e/driver/userDb'
import { expect } from './expect'
import { domTest, type DomContext } from './test'

const ALERTS_MAIN = '#alerts-prod'
const RINA = 'Rina finished the onsite'

type Context = Pick<DomContext, 'juno' | 'slack' | 'fake' | 'userData'>

// One journey: each step leaves the levels it set, and later steps use other conversations.
domTest('Notify me levels, which messages notify and how a click opens them, and the dock badge', async ({ juno, slack, fake, userData, step }) => {
  const context = { juno, slack, fake, userData }
  // From a fresh start, before anything is read.
  await step('unread topics badge the dock', () => expect.poll(() => juno.dockBadge(), { timeout: 15_000 }).toBe('•'))
  await step('Notify me on a channel lists it on the page, and removing it there has Undo', () => levels(context))
  await juno.notificationHoursNow()
  await step('a topic on screen in a focused window does not notify', () => focusedTopic(context))
  await step('a group DM notifies under its people\'s names, not Slack\'s internal name', () => groupDm(context))
  await step('a DM set to Always notifies, and the click opens it at the message', () => clickOpens(context))
})

async function levels({ juno }: Context): Promise<void> {
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
}

async function focusedTopic({ juno, slack, fake, userData }: Context): Promise<void> {
  await juno.sidebar.selectView('Automated')
  await juno.sidebar.row(ALERTS_MAIN).chooseInMenu('notify-always')
  // The menus show Always at once; the toast waits until the engine holds it, which the next message is decided by.
  await juno.expectToast('#alerts-prod: Always')
  await juno.sidebar.row(ALERTS_MAIN).open()
  await juno.focusWindow()
  // The engine holds back a message only once the page has told it the topic is on screen; a message that
  // arrives first notifies, as it would for someone who opened the topic just as it came.
  await expect.poll(() => juno.system('viewing')).toBe('m:C0ALERTSPROD')
  slack.as('Leo').postIn('alerts-prod', 'Disk at 91% on db-2')
  await juno.topic.expectMessage('Disk at 91% on db-2')
  await expect.poll(() => readUserDb(userData, fake.teamId, (db) => db.prepare('SELECT outcome, decided_by, reason, delivered_at, suppressed_at FROM notification_log WHERE preview LIKE ?').get('%Disk at 91% on db-2%'))).toEqual(expect.objectContaining({ suppressed_at: expect.any(String) }))
  expect((await juno.osNotifications()).map((notification) => notification.body)).not.toContain('Disk at 91% on db-2')

  await juno.blurWindow()
  slack.as('Leo').postIn('alerts-prod', 'Disk at 95% on db-2')
  await expect.poll(async () => (await juno.osNotifications()).map((notification) => notification.body), { timeout: 15_000 }).toContain('Disk at 95% on db-2')
  await juno.focusWindow()
}

async function groupDm({ juno, slack }: Context): Promise<void> {
  // The step before left the Automated view on.
  await juno.sidebar.filter('All')
  await juno.sidebar.row('Maya, Leo', { exact: true }).open()
  await juno.topic.chooseInMessageMenu('lunch friday?', 'notify-always', { onSender: true })
  await juno.expectToast('Leo: Always')

  await juno.openNotifications()
  slack.as('Leo').groupDm('Moved it to 1pm')
  await expect.poll(() => juno.osNotifications(), { timeout: 15_000 }).toContainEqual({ title: 'Maya, Leo', body: 'Moved it to 1pm' })
}

async function clickOpens({ juno, slack }: Context): Promise<void> {
  await juno.sidebar.row('Maya', { exact: true }).open()
  await juno.topic.expectTitle('Maya')
  slack.as('Maya').dm('Here is the hiring plan for today.')
  await juno.topic.expectMessage('Here is the hiring plan for today.')
  const person = await juno.topic.chooseInMessageMenu('Here is the hiring plan for today.', 'notify-always', { onSender: true })
  // The person menu shows Maya's level before the change.
  expect(person.labels).toEqual(expect.arrayContaining(['Notify me about Maya', '> Auto ✓']))
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
}
