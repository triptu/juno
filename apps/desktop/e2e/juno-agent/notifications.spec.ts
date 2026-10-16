// Notification hours stay quiet for held messages; Tell Juno quotes a message beside the topic.
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Juno } from '../driver/juno'
import { openChat, ready } from './agent'
import { expect, JunoChatPane, test } from './chat'

const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Read the saved settings: a select's DOM value changes before its RPC commits. */
function savedSettings(userData: string, teamId: string): unknown {
  const db = new DatabaseSync(join(userData, 'workspaces', teamId, 'user.db'), { readOnly: true })
  try {
    const row = db.prepare("SELECT value_json FROM prefs WHERE key = 'notifications'").get()
    return typeof row?.value_json === 'string' ? JSON.parse(row.value_json) : undefined
  } finally {
    db.close()
  }
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
  await select.evaluate((element, value) => {
    const options = (element as HTMLSelectElement).options
    if (![...options].some((option) => option.value === value)) element.append(new Option(value, value))
  }, String(minutes))
  await select.selectOption(String(minutes))
  await expect.poll(saved).toMatchObject({ notificationHours: { [edge]: minutes } })
  // Reopen to check the saved value, rather than the select's optimistic DOM value.
  await juno.tabs.close('Settings')
  await juno.openNotifications()
  await expect(select).toHaveValue(String(Math.floor(minutes / 30) * 30))
}

/** Equal endpoints mean off, so use a twelve-hour window centred on now. */
async function coverNow(juno: Juno, saved: ReadSettings): Promise<void> {
  await everyDay(juno, saved)
  const middle = Math.floor(minutesNow() / 30) * 30
  await setHours(juno, saved, 'from', (middle + 18 * 60) % 1440)
  await setHours(juno, saved, 'to', (middle + 6 * 60) % 1440)
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

// A held message is judged at the time it arrived, so hours that start later never release it.
// The minute-by-minute boundary is covered with the test clock in packages/engine/test/notifications.test.ts.
test('starting notification hours keeps held messages quiet while a new urgent message notifies', async ({ juno, slack, model, userData, fake }) => {
  await ready(juno)
  await juno.openNotifications()
  const saved = () => savedSettings(userData, fake.teamId)
  await excludeNow(juno, saved)
  const held = 'Can you approve the release now?'
  slack.as('Maya').dm(held)
  await expect.poll(() => {
    const db = new DatabaseSync(join(userData, 'workspaces', fake.teamId, 'user.db'), { readOnly: true })
    try {
      return db.prepare('SELECT outcome, reason FROM notification_log WHERE preview = ?').get(held)
    } finally {
      db.close()
    }
  }).toMatchObject({ outcome: 'hold', reason: expect.stringContaining('Outside your notification hours.') })
  expect(await juno.osNotifications()).toHaveLength(0)
  await coverNow(juno, saved)
  await juno.blurWindow()

  const urgent = 'Can you approve the release today?'
  slack.as('Maya').dm(urgent)
  await expect.poll(() => juno.osNotifications(), { timeout: 15_000 }).toEqual([{ title: 'Maya', body: urgent }])
  const chat = await openChat(juno)
  await expect(chat.root.locator('[data-chat-group-label]').filter({ hasText: 'Summary' })).toHaveCount(0)
  expect(model.inputs()).toHaveLength(0)
})

test('Tell Juno in the why popover opens the chat beside the topic with the message quoted', async ({ juno, slack, userData, fake }) => {
  await ready(juno)
  // Notification hours hold now, so Juno decides the DM.
  await juno.openNotifications()
  await coverNow(juno, () => savedSettings(userData, fake.teamId))

  slack.as('Maya').dm('Are we still on for the board deck review?')
  await juno.sidebar.row('Maya', { exact: true }).open()
  await juno.topic.expectMessage('Are we still on for the board deck review?')
  const menu = await juno.topic.chooseInMessageMenu('Are we still on for the board deck review?', 'why')
  expect(menu.labels.some((label) => label.startsWith('Why'))).toBe(true)
  const why = juno.whyPopover(/notif/i)
  await expect(why).toContainText('Juno:')
  await why.getByRole('button', { name: 'Tell Juno' }).click()
  await expect(why).toHaveCount(0)

  const panel = JunoChatPane.panel(juno.win)
  const quote = juno.win.locator('aside[data-juno-panel] [data-panel-selection]')
  await expect(quote).toContainText('Selection')
  await expect(quote).toHaveAttribute('title', /^Maya[^:]*: Are we still on for the board deck review\?/)
  await expect(panel.composer).toBeFocused()
})
