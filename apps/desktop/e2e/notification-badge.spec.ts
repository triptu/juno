import { seedWorkspace, startFakeSlack } from '@juno/fake-slack'
import { expect, launchApp, test } from './fixtures'
import { Juno } from './driver/juno'
import { hooks } from './hooks'

const badgeTest = test.extend({
  // oxlint-disable-next-line no-empty-pattern
  fake: async ({}, use) => {
    const fake = await startFakeSlack({ seed: (workspace, avatars) => {
      seedWorkspace(workspace, avatars)
      for (const channel of workspace.conversations.keys()) {
        const last = workspace.all(channel).at(-1)?.ts
        if (last !== undefined) workspace.markConversation(channel, last)
      }
      for (const sub of workspace.subscriptions.values()) {
        const last = workspace.all(sub.channel).at(-1)?.ts
        if (last !== undefined) workspace.markThread(sub.channel, sub.threadTs, last, true)
      }
      workspace.post({ channel: 'D0MAYA', user: 'U0MAYA', text: 'A DM before launch' })
    } })
    await use(fake)
    await fake.close()
  },
})

badgeTest('dock dot follows unread DMs, group DMs and mentions through reads, wake, engine restart and permanent failure', { tag: '@electron' }, async ({ juno, slack, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.notificationHoursNow()
  const badge = (text: string) => expect.poll(() => juno.dockBadge(), { timeout: 15_000 }).toBe(text)
  await badge('•')
  await juno.sidebar.row('Maya', { exact: true }).chooseInMenu('notify-never')
  await badge('')
  await juno.sidebar.row('Maya', { exact: true }).chooseInMenu('notify-always')
  await badge('•')
  // More unread items keep the same dot, including a mention in the DM.
  const dm = slack.as('Maya').dm('<@U0TUSHAR> Another DM')
  await juno.sidebar.row('Maya', { exact: true }).expectPreview('@Tushar Another DM')
  slack.as('Leo').postIn('eng', '<@U0TUSHAR> Can you review this now?')
  await juno.sidebar.row('#eng', { exact: true }).expectPreview('Leo: @Tushar Can you review this now?')
  await badge('•')
  // A read from another Slack client leaves the channel mention as the only unread item.
  fake.markRead({ channel: 'D0MAYA', ts: dm })
  await juno.sidebar.row('Maya', { exact: true }).expectRead()
  await juno.sidebar.row('#eng', { exact: true }).chooseInMenu('mark-read')
  await juno.sidebar.row('#eng', { exact: true }).expectRead()
  await badge('')
  slack.as('Leo').groupDm('A group DM')
  await badge('•')
  const pid = await hooks(juno.app, 'enginePid')
  expect(pid).toBeDefined()
  await juno.app.evaluate(() => (globalThis as unknown as { junoTest: { clearDockBadge: () => void } }).junoTest.clearDockBadge())
  await badge('')
  process.kill(pid!, 'SIGKILL')
  await expect.poll(() => hooks(juno.app, 'enginePid'), { timeout: 15_000 }).not.toBe(pid)
  await juno.waitForSync()
  await badge('•')
  await juno.app.evaluate(() => (globalThis as unknown as { junoTest: { clearDockBadge: () => void } }).junoTest.clearDockBadge())
  await badge('')
  await hooks(juno.app, 'wake')
  await badge('•')
  await juno.sidebar.row('Maya, Leo', { exact: true }).chooseInMenu('mark-read')
  await badge('')
  slack.as('Maya').dm('Unread when the engine stops')
  await badge('•')
  await hooks(juno.app, 'failEngine')
  await badge('')
})

// No prompt during onboarding; the first Home view after it asks, before any banner has been shown.
badgeTest('no permission prompt during onboarding, and the first Home view asks before any notification is shown', async ({ juno }) => {
  await juno.setNotificationPermission({ authorization: 'notDetermined', badges: 'unknown' })
  await juno.signIn({ skipSetUp: false })
  await expect(juno.setUp).toBeVisible()
  await expect.poll(() => juno.dockBadge()).toBe('•')
  expect(await juno.surface.system('notificationRequests')).toBe(0)
  await juno.skipSetUp()
  await juno.waitForSync()
  await expect.poll(() => juno.surface.system('notificationRequests')).toBe(1)
  expect(await juno.osNotifications()).toEqual([])
  await juno.openNotifications()
  await expect(juno.notifications.root.getByRole('status', { name: 'Notification permission' })).toHaveCount(0)
})

badgeTest('a denied request is remembered across a full app restart', { tag: '@electron' }, async ({ fake, slackApp, userData }) => {
  const options = { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword, notificationInitial: 'notDetermined' as const, notificationResponse: 'denied' as const }
  const first = await launchApp(userData, options)
  try {
    const juno = new Juno(first.app, first.win)
    await juno.signIn()
    await expect.poll(() => hooks(first.app, 'notificationRequests')).toBe(1)
  } finally { await first.close() }
  // Deliberately report notDetermined again: even an ignored or unrecorded OS prompt must not repeat.
  const second = await launchApp(userData, options)
  try {
    const juno = new Juno(second.app, second.win)
    await juno.waitForSync()
    expect(await hooks(second.app, 'notificationRequests')).toBe(0)
    await juno.openNotifications()
    await juno.notifications.root.getByRole('button', { name: 'Allow notifications' }).click()
    await expect.poll(() => hooks(second.app, 'notificationRequests')).toBe(1)
  } finally { await second.close() }
})
