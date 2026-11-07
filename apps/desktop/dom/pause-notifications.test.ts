// Pause notifications (SPEC 14): Slack's own snooze from the avatar menu, which keeps Juno's OS notifications
// quiet until it ends, and a colleague's pause shown on their dot until it ends. The clock moves past each end.
import { expect } from './expect'
import { domTest } from './test'

const HOUR = 60 * 60_000

domTest('Pause notifications for 1 hour snoozes Slack and holds every notification until the hour ends; a colleague’s pause shows on their dot until it ends', async ({ juno, fake, slack, clock, step }) => {
  const button = juno.sidebar.accountButton
  const bodies = async () => (await juno.osNotifications()).map((shown) => shown.body)
  // Hours six hours either side of now, so the hour's jump never leaves them; #eng on Always, so a message there notifies.
  await juno.notificationHoursNow({ wide: true })
  await juno.sidebar.row('#eng').chooseInMenu('notify-always')
  await juno.expectToast('#eng: Always')

  await step('Pause notifications › 1 hour asks Slack for a 60 minute snooze, and the avatar shows the paused badge', async () => {
    await expect(button.locator('[data-paused]')).toHaveCount(0)
    await juno.accountMenu.open()
    await juno.accountMenu.item(/^Pause notifications/).click()
    await juno.accountMenu.choose(/^1 hour$/)
    await expect.poll(() => fake.calls.filter((call) => call.method === 'dnd.setSnooze').map((call) => call.args['num_minutes'])).toEqual(['60'])
    await expect(button.locator('[data-paused]')).toHaveCount(1)
    await juno.accountMenu.open()
    await expect(juno.accountMenu.item(/^Notifications/)).toContainText('Paused until')
    await expect(juno.accountMenu.item(/^Resume notifications/)).toBeVisible()
    await juno.accountMenu.close()
  })

  await step('a message while paused stays in Juno with no OS notification; after the hour the next one notifies', async () => {
    await juno.openNotifications()
    const today = juno.notifications.root.getByText(/stayed in Juno/)
    const stayed = () => Number(/(\d+) stayed in Juno/.exec(today.allTextContents().join(' '))?.[1] ?? Number.NaN)
    await expect(today).toBeVisible()
    const before = stayed()
    slack.as('Leo').postIn('eng', 'Deploy finished while you were paused')
    await expect.poll(stayed).toBe(before + 1)

    await clock.fastForward(HOUR + 60_000)
    fake.workspace.clock.advance(HOUR + 60_000)
    await expect(button.locator('[data-paused]')).toHaveCount(0)
    slack.as('Leo').postIn('eng', 'Second deploy is out')
    await expect.poll(bodies, { timeout: 15_000 }).toContain('Second deploy is out')
    expect(await bodies()).not.toContain('Deploy finished while you were paused')
  })

  await step('a colleague who pauses gets the snooze badge on their dot, and it clears when their pause ends', async () => {
    await juno.tabs.close('Settings')
    await juno.sidebar.row('Maya', { exact: true }).open()
    await juno.topic.expectTitle('Maya')
    const dot = juno.topic.contextPill.locator('[data-pill-presence]')
    await expect(dot).toHaveCount(1)
    await expect(dot.locator('[data-paused]')).toHaveCount(0)
    const now = Math.floor(fake.workspace.clock.now() / 1000)
    // A short pause, and a jump under the socket's 30 s pong timeout: a reconnect would ask Slack again anyway.
    fake.workspace.setUserDnd('U0MAYA', { next_dnd_start_ts: now - 60, next_dnd_end_ts: now + 15 })
    await expect(dot.locator('[data-paused]')).toHaveCount(1)
    await expect(juno.topic.contextPill).toHaveAccessibleName(/notifications paused\. Show in sidebar\.$/)

    await clock.fastForward(18_000)
    await expect(dot.locator('[data-paused]')).toHaveCount(0)
  })
}, { clock: true })
