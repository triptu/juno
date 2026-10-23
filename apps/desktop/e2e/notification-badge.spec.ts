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

badgeTest('dock dot follows unread DMs, group DMs and mentions through reads, wake and engine restart', async ({ juno, slack, fake }) => {
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
})

// The first post-setup content view asks before any banner has been shown.
badgeTest('the first Home view asks for authorization before any notification is shown', async ({ juno }) => {
  await juno.setNotificationPermission({ authorization: 'notDetermined', badges: 'unknown' })
  await juno.signIn()
  await juno.waitForSync()
  await expect.poll(() => hooks(juno.app, 'notificationRequests')).toBe(1)
  await expect.poll(() => juno.dockBadge()).toBe('•')
  expect(await juno.osNotifications()).toEqual([])
  await juno.openNotifications()
  await expect(juno.notifications.root.getByRole('status', { name: 'Notification permission' })).toHaveCount(0)
})

badgeTest('badge regression: a kept-out DM is quiet, but its mention counts', async ({ juno, slack }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.notificationHoursNow()
  await juno.sidebar.createView({ name: 'Apps', conversations: ['Maya'], keepOutOfAll: true })
  await expect.poll(() => juno.dockBadge()).toBe('')
  slack.as('Maya').dm('<@U0TUSHAR> Please approve')
  await expect.poll(() => juno.dockBadge()).toBe('•')
})

badgeTest('badge regression: a muted channel mention counts, but @here from a Never sender does not', async ({ juno, slack, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.notificationHoursNow()
  await juno.sidebar.row('Maya', { exact: true }).open()
  await juno.topic.chooseInMessageMenu('A DM before launch', 'notify-never', { onSender: true })
  await juno.openNotifications()
  await expect.poll(() => juno.dockBadge()).toBe('')
  slack.as('Maya').postIn('eng', '<!here> A muted sender')
  await juno.sidebar.row('#eng', { exact: true }).expectPreview('Maya: @here A muted sender')
  await expect.poll(() => juno.dockBadge()).toBe('')
  fake.emitFrame({ type: 'pref_change', name: 'muted_channels', value: 'C0ENG' })
  slack.as('Leo').postIn('eng', '<@U0TUSHAR> Can you approve this now?')
  await expect.poll(() => juno.dockBadge()).toBe('•')
})

badgeTest('badge regression: no permission prompt during onboarding', async ({ juno }) => {
  await juno.setNotificationPermission({ authorization: 'notDetermined', badges: 'unknown' })
  await juno.signIn({ skipSetUp: false })
  await expect(juno.setUp).toBeVisible()
  await expect.poll(() => juno.dockBadge()).toBe('•')
  expect(await hooks(juno.app, 'notificationRequests')).toBe(0)
  await juno.skipSetUp()
  await expect.poll(() => hooks(juno.app, 'notificationRequests')).toBe(1)
})

badgeTest('badge regression: an engine that gives up clears the dot', async ({ juno, app }) => {
  await juno.signIn()
  await juno.waitForSync()
  await expect.poll(() => juno.dockBadge()).toBe('•')
  await hooks(app, 'failEngine')
  await expect.poll(() => juno.dockBadge()).toBe('')
})

badgeTest('a denied request is remembered across a full app restart', async ({ fake, slackApp, userData }) => {
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

const appDmTest = test.extend({
  // oxlint-disable-next-line no-empty-pattern
  fake: async ({}, use) => {
    const fake = await startFakeSlack({ seed: (workspace, avatars) => {
      seedWorkspace(workspace, avatars)
      for (const channel of workspace.conversations.keys()) {
        const last = workspace.all(channel).at(-1)?.ts
        if (last) workspace.markConversation(channel, last)
      }
      for (const sub of workspace.subscriptions.values()) {
        const last = workspace.all(sub.channel).at(-1)?.ts
        if (last) workspace.markThread(sub.channel, sub.threadTs, last, true)
      }
      const maya = workspace.users.get('U0MAYA')!
      workspace.addUser({ ...maya, is_bot: true, name: 'github', real_name: 'GitHub', profile: { ...maya.profile, display_name: 'GitHub', real_name: 'GitHub' } })
      workspace.post({ channel: 'D0MAYA', user: 'U0MAYA', text: 'Pull request opened' })
    } })
    await use(fake)
    await fake.close()
  },
})

appDmTest('an unread app DM in Automated sets no dot until it mentions the owner', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.notificationHoursNow()
  await juno.sidebar.selectView('Automated')
  await juno.sidebar.row('GitHub', { exact: true }).expectVisible()
  await expect.poll(() => juno.dockBadge()).toBe('')
  fake.injectMessage({ channel: 'D0MAYA', user: 'U0MAYA', text: '<@U0TUSHAR> Review the pull request' })
  await expect.poll(() => juno.dockBadge()).toBe('•')
})

