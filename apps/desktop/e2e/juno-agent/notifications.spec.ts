// Notifications meeting the Juno chat (SPEC 14): Tell Juno in the why
// popover quotes the message beside the topic.
import type { Juno } from '../driver/juno'
import { ready } from './agent'
import { expect, JunoChatPane, test } from './chat'

test.describe.configure({ timeout: 180_000 })

const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Turns today on for the notification hours, if it is off. */
async function includeToday(juno: Juno): Promise<void> {
  const today = juno.notifications.day('Notifications', weekdays[new Date().getDay()]!)
  if ((await today.getAttribute('aria-pressed')) !== 'true') await today.click()
  await expect(today).toHaveAttribute('aria-pressed', 'true')
}

/** Notification hours that hold the current time, on every half hour of today but the last. */
async function coverNow(juno: Juno): Promise<void> {
  await includeToday(juno)
  if (minutesNow() < 12 * 60) {
    await juno.notifications.setFrom('Notifications', '12am')
    await juno.notifications.setTo('Notifications', '11:30pm')
  } else {
    await juno.notifications.setFrom('Notifications', '12:30am')
    await juno.notifications.setTo('Notifications', '12am')
  }
}

const minutesNow = () => {
  const now = new Date()
  return now.getHours() * 60 + now.getMinutes()
}

test('Tell Juno in the why popover opens the chat beside the topic with the message quoted', async ({ juno, slack }) => {
  await ready(juno)
  // Notification hours hold now, so Juno decides the DM.
  await juno.openNotifications()
  await coverNow(juno)

  slack.as('Maya').dm('Are we still on for the board deck review?')
  await juno.sidebar.row('Maya', { exact: true }).open()
  await juno.topic.expectMessage('Are we still on for the board deck review?')
  const menu = await juno.topic.chooseInMessageMenu('Are we still on for the board deck review?', 'why')
  expect(menu.labels.some((label) => label.startsWith('Why'))).toBe(true)
  const why = juno.whyPopover(/notif|summary/i)
  await expect(why).toContainText('Juno:')
  await why.getByRole('button', { name: 'Tell Juno' }).click()
  await expect(why).toHaveCount(0)

  const panel = JunoChatPane.panel(juno.win)
  const quote = juno.win.locator('aside[data-juno-panel] [data-panel-selection]')
  await expect(quote).toContainText('Are we still on for the board deck review?')
  await expect(quote).toContainText('Maya')
  await expect(panel.composer).toBeFocused()
})
