/**
 * How Juno decides to notify (SPEC 14), as the owner meets it against the
 * fake Slack and the fake model: a cold greeting stays, a reply while the
 * owner is talking in the DM notifies, and Always notifies inside the
 * notification hours but not outside them. Each decision is read from the
 * log that Today › Details shows.
 */
import { expect, syncedTest } from './fixtures'
import type { Juno } from './driver/juno'
import { loggedDecision as decision } from './driver/notificationLog'

const bodies = async (juno: Juno) => (await juno.osNotifications()).map((notification) => notification.body)

syncedTest('a cold greeting stays, and a reply while you talk in the DM notifies', async ({ juno, slack, fake, userData }) => {
  await juno.notificationHoursNow()
  slack.as('Maya').dm('hi Tushar 👋')
  await expect.poll(() => decision(userData, fake.teamId, 'hi Tushar 👋'), { timeout: 15_000 }).toEqual({ outcome: 'stay', decidedBy: 'reading' })

  await juno.sidebar.row('Maya', { exact: true }).open()
  await juno.topic.send('Hey Maya, what is up?')
  await juno.topic.expectMessage('Hey Maya, what is up?')
  // Away from the DM, Maya's answer is an update the reading would keep, but you were talking a moment ago.
  await juno.openNotifications()
  slack.as('Maya').dm('The doc is in the shared folder now')
  await expect.poll(() => bodies(juno), { timeout: 15_000 }).toContain('The doc is in the shared folder now')
  expect(decision(userData, fake.teamId, 'The doc is in the shared folder now')).toEqual({ outcome: 'notify', decidedBy: 'live' })
  expect(await bodies(juno)).not.toContain('hi Tushar 👋')
})

syncedTest('Always notifies inside the notification hours, and nothing notifies outside them', async ({ juno, slack, fake, userData }) => {
  await juno.sidebar.row('#product').chooseInMenu('notify-always')
  await juno.expectToast('#product: Always')

  await juno.notificationHoursNow({ outside: true })
  slack.as('Leo').postIn('product', 'Roadmap doc moved to the new folder')
  await expect.poll(() => decision(userData, fake.teamId, 'Roadmap doc moved to the new folder'), { timeout: 15_000 }).toEqual({ outcome: 'stay', decidedBy: 'hours' })

  await juno.notificationHoursNow()
  slack.as('Leo').postIn('product', 'Pricing review moved to 3pm')
  await expect.poll(() => bodies(juno), { timeout: 15_000 }).toContain('Pricing review moved to 3pm')
  expect(decision(userData, fake.teamId, 'Pricing review moved to 3pm')).toEqual({ outcome: 'notify', decidedBy: 'always' })
  expect(await bodies(juno)).not.toContain('Roadmap doc moved to the new folder')
})
