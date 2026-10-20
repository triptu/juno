/**
 * Other people's presence (SPEC 14, "Show when people are active"). Juno
 * subscribes over the socket to its DM partners with `presence_sub`, and a
 * DM row shows the presence dot on the person's photo while Slack shows
 * them active. The fake says each subscribed person's presence at once and
 * then each change (`slack.as(name).setPresence`). With the setting off the
 * dots go, Juno ends the subscription and sends no more `presence_sub`, and
 * your own dot stays.
 */
import { expect, test } from './fixtures'

test('a DM shows when its person is active, and Show when people are active off hides it and stops asking Slack', async ({ juno, slack }) => {
  await juno.signIn()
  await juno.waitForSync()
  const maya = slack.as('Maya')
  const dm = juno.sidebar.row('Maya', { exact: true })
  await slack.expectPresenceSubscribed('Maya')
  // Away until Slack says otherwise.
  await expect(dm.presenceDot).toHaveCount(0)

  await test.step('Maya goes active, then away', async () => {
    maya.setPresence('active')
    await expect(dm.presenceDot).toBeVisible()
    await expect(dm.root).toHaveAccessibleDescription(/^active\b/)
    maya.setPresence('away')
    await expect(dm.presenceDot).toHaveCount(0)
    await expect(dm.root).not.toHaveAccessibleDescription(/^active\b/)
  })

  await test.step('the setting off hides the dot and ends the subscription; your own dot stays', async () => {
    maya.setPresence('active')
    await expect(dm.presenceDot).toBeVisible()
    await juno.openNotifications()
    const setting = juno.notifications.showPresence
    await expect(setting).toBeChecked()
    await setting.click()
    await expect(setting).not.toBeChecked()
    await expect(dm.presenceDot).toHaveCount(0)
    await slack.expectPresenceSubscribed('Maya', false)
    await expect(juno.sidebar.accountButton).toHaveAccessibleDescription(/^(Active|Away)/)

    // Nothing more goes to Slack: not on her next change, not after a reconnect.
    slack.resetCalls()
    maya.setPresence('away')
    maya.setPresence('active')
    slack.fake.dropSocket()
    // A DM sent meanwhile shows once Juno is connected again.
    maya.dm('Back online')
    await dm.expectPreview(/Back online/)
    await expect(dm.presenceDot).toHaveCount(0)
    expect(slack.presenceSubs()).toEqual([])
  })

  await test.step('on again, Juno subscribes and the dot comes back', async () => {
    await juno.notifications.showPresence.click()
    await expect(juno.notifications.showPresence).toBeChecked()
    await slack.expectPresenceSubscribed('Maya')
    await expect(dm.presenceDot).toBeVisible()
  })
})
