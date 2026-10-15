// Notifications meeting the Juno chat (SPEC 14): the hours-start summary is
// posted in the chat with no model call and its notification opens the chat
// at it, and Tell Juno in the why popover quotes the message beside the topic.
import type { Page } from '@playwright/test'
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

/** Sets when notification hours start to the minute. The select offers half hours; the page saves whatever it is given. */
async function setHoursFrom(juno: Juno, minutes: number): Promise<void> {
  const select = juno.notifications.root.getByRole('combobox', { name: 'Notifications from' })
  await select.evaluate((element, value) => {
    const options = (element as HTMLSelectElement).options
    if (![...options].some((option) => option.value === value)) element.append(new Option(value, value))
  }, String(minutes))
  await select.selectOption(String(minutes))
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

/** The rows that flash from now on (`flashChatRow` animates the row), by their text. */
async function watchFlashes(win: Page): Promise<() => Promise<string[]>> {
  await win.evaluate(() => {
    const flashed: string[] = []
    ;(globalThis as unknown as { flashedRows: string[] }).flashedRows = flashed
    const animate = Element.prototype.animate
    Element.prototype.animate = function (this: Element, ...args: Parameters<Element['animate']>) {
      if (this.matches('[data-message-row], [data-chat-juno]')) flashed.push(this.textContent ?? '')
      return animate.apply(this, args)
    }
  })
  return () => win.evaluate(() => (globalThis as unknown as { flashedRows: string[] }).flashedRows)
}

test('the hours-start summary is a Summary message in the Juno chat, and its notification opens the chat at it', async ({ juno, slack, model }) => {
  await ready(juno)
  await juno.openNotifications()
  await includeToday(juno)
  // Hours start at the next minute; the engine's minute tick delivers the summary then. Leave time to hold a message first.
  if (new Date().getSeconds() > 30) await juno.win.waitForTimeout((61 - new Date().getSeconds()) * 1000)
  const start = (minutesNow() + 1) % 1440
  await juno.notifications.setTo('Notifications', hourLabel((Math.floor(start / 30) * 30 + 120) % 1440))
  await setHoursFrom(juno, start)

  // Outside the hours, a DM Juno would notify about waits for the summary.
  slack.as('Maya').dm('Can you sign the offer letter today?')
  await juno.blurWindow()
  await expect.poll(() => juno.osNotifications(), { timeout: 100_000, intervals: [1_000] }).toContainEqual({ title: '1 message needs you', body: expect.stringMatching(/^In /) })
  expect((await juno.osNotifications()).map((notification) => notification.body)).not.toContain('Can you sign the offer letter today?')

  const flashes = await watchFlashes(juno.win)
  const shown = (await juno.osNotifications()).findIndex((notification) => notification.title === '1 message needs you')
  await juno.clickOsNotification(shown)
  await juno.tabs.expectActive('Juno')
  const chat = JunoChatPane.tab(juno.win)
  await expect(chat.root.locator('[data-chat-group-label]').filter({ hasText: 'Summary' })).toBeVisible({ timeout: 15_000 })
  const summary = chat.junoBubble('1 message needs you:')
  await expect(summary).toBeInViewport()
  await expect.poll(flashes).toContainEqual(expect.stringContaining('1 message needs you:'))
  // One source per message, and no model call made it.
  await expect(summary.locator('[data-source]')).toHaveCount(1)
  expect(model.inputs()).toHaveLength(0)

  // The source opens the DM at the message.
  await summary.locator('[data-source]').click()
  await juno.tabs.expectActive('Maya')
  await expect(juno.topic.message('Can you sign the offer letter today?')).toBeInViewport()
})

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

function hourLabel(minutesOfDay: number): string {
  const h24 = Math.floor(minutesOfDay / 60)
  const m = minutesOfDay % 60
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  const suffix = h24 < 12 ? 'am' : 'pm'
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, '0')}${suffix}`
}
