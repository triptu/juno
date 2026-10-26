/**
 * A notification's click on a topic open in another tab (SPEC 14), where the
 * browser matters: it scrolls to the message and flashes it. Notify me, which
 * messages notify and Settings › Ignored are in the DOM lane
 * (`dom/notifications.test.ts`, `dom/settings-ignored.test.ts`); the test
 * notification and macOS permission line are in the window journey
 * (`app.spec.ts`).
 */
import { seedWorkspace, startFakeSlack, topic300Seed } from '@juno/fake-slack'
import { expect, test } from './fixtures'
import { watchFlashes } from './driver/flashes'

test.describe.configure({ timeout: 90_000 })

const RINA = 'Rina finished the onsite'
const LONG_THREAD = 'Review the rollout checklist 1.'

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
