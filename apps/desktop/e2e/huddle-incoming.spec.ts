/**
 * An incoming huddle (SPEC 20, "Incoming huddles") as the user meets it,
 * against the fake Slack: someone starts a huddle where the user is, the
 * card shows at the top of the sidebar, rings and posts a notification;
 * Join joins, Dismiss hides it, and it goes when the huddle ends. The ring
 * is recorded, not played, under JUNO_E2E (`window.__junoHuddleRing`).
 *
 * Notification hours depend on the clock, so the channels that ring are set
 * to Every message, which rings at any hour; #product is set to Never, which
 * keeps its card quiet.
 */
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { chimeDrops, attendee, connection } from './huddleFake'

test.describe.configure({ timeout: 90_000 })

interface RingWindow {
  readonly __junoHuddleRing?: { readonly ringing: boolean; readonly starts: number }
}
const ringing = (win: Page) => win.evaluate(() => (window as unknown as RingWindow).__junoHuddleRing?.ringing ?? false)
const rings = (win: Page) => win.evaluate(() => (window as unknown as RingWindow).__junoHuddleRing?.starts ?? 0)

test('someone starts a huddle: the card rings, Join joins, Dismiss hides it, and it goes when the huddle ends', async ({ juno, fake, win }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row('#eng').chooseInMenu('notify-every')
  await juno.expectToast('#eng: Every message')
  await juno.sidebar.row('Maya', { exact: true }).chooseInMenu('notify-every')
  await juno.expectToast('Maya: Every message')
  await juno.sidebar.row('#product').chooseInMenu('notify-never')
  await juno.expectToast('#product: Never')

  // Maya starts a huddle in #eng: the card shows at once, pulses and rings, and macOS shows a silent notification.
  fake.control('startHuddle', { channel: 'C0ENG', user: 'U0MAYA' })
  const card = win.getByRole('region', { name: 'Incoming huddle' })
  await expect(card).toBeVisible()
  await expect(card.getByRole('button', { name: 'Open huddle in #eng' })).toBeVisible()
  await expect(card).toContainText('Maya started a huddle')
  await expect(card.locator('[data-pulse]')).toHaveCount(1)
  await expect.poll(() => ringing(win)).toBe(true)
  await expect.poll(() => juno.osNotifications()).toContainEqual({ title: '#eng', body: 'Maya started a huddle', silent: true })

  // Join: the card and the ring go, and the bar shows the call.
  await card.getByRole('button', { name: 'Join the huddle in #eng' }).click()
  const bar = win.getByRole('region', { name: 'Huddle', exact: true })
  await expect(bar).toBeVisible()
  await expect(card).toBeHidden()
  await expect.poll(() => ringing(win)).toBe(false)
  expect(fake.calls.filter((call) => call.method === 'rooms.join').map((call) => call.args)).toMatchObject([{ channel_id: 'C0ENG' }])
  await expect.poll(() => connection(win)).toBe('connected')

  // While in a call, Maya's DM huddle shows its card under the bar with Switch, and does not ring.
  const before = await rings(win)
  fake.control('startHuddle', { channel: 'D0MAYA', user: 'U0MAYA' })
  await expect(card).toBeVisible()
  await expect(card.getByRole('button', { name: 'Switch to the huddle in Maya' })).toBeVisible()
  await expect(card).toContainText('Started a huddle')
  expect((await bar.boundingBox())!.y).toBeLessThan((await card.boundingBox())!.y)
  expect(await rings(win)).toBe(before)
  await expect.poll(() => juno.osNotifications()).toContainEqual({ title: 'Maya', body: 'Started a huddle', silent: true })

  // Dismiss hides it; the huddle goes on, and the DM's row still shows it running.
  await card.getByRole('button', { name: 'Dismiss' }).click()
  await expect(card).toBeHidden()
  await expect(juno.sidebar.row('Maya', { exact: true }).root.locator('[data-huddle-indicator]')).toBeVisible()

  // Leave the call. A huddle in a channel set to Never shows its card quietly: no pulse, no ring, no notification.
  const attendeeId = await attendee(win)
  await bar.getByRole('button', { name: 'Leave' }).click()
  await expect(bar).toBeHidden()
  await chimeDrops(win, fake, attendeeId!)
  const shown = (await juno.osNotifications()).length
  fake.control('startHuddle', { channel: 'C0PRODUCT', user: 'U0LEO' })
  await expect(card.getByRole('button', { name: 'Open huddle in #product' })).toBeVisible()
  await expect(card).toContainText('Leo started a huddle')
  await expect(card.locator('[data-pulse]')).toHaveCount(0)
  expect(await ringing(win)).toBe(false)

  // The huddle ends: the card goes.
  fake.control('endHuddle', { channel: 'C0PRODUCT' })
  await expect(card).toBeHidden()
  expect((await juno.osNotifications()).length).toBe(shown)

  // The notification opens Juno at the huddle: its tab, where the user can join.
  const eng = (await juno.osNotifications()).findIndex((notification) => notification.title === '#eng')
  await juno.clickOsNotification(eng)
  await juno.tabs.expectActive('eng · Huddle')
  await expect(win.getByRole('button', { name: 'Join huddle' })).toBeVisible()
})

test('a huddle the user started on another device shows no card', async ({ juno, fake, win }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row('#eng').chooseInMenu('notify-every')
  await juno.expectToast('#eng: Every message')
  await juno.sidebar.row('#product').chooseInMenu('notify-every')
  await juno.expectToast('#product: Every message')

  // The user starts one from their phone; then Maya starts one. Only Maya's has a card.
  fake.control('startHuddle', { channel: 'C0ENG', user: 'U0TUSHAR' })
  await expect(juno.sidebar.row('#eng').root.locator('[data-huddle-indicator]')).toBeVisible()
  fake.control('startHuddle', { channel: 'C0PRODUCT', user: 'U0MAYA' })
  const card = win.getByRole('region', { name: 'Incoming huddle' })
  await expect(card.getByRole('button', { name: 'Open huddle in #product' })).toBeVisible()
  await card.getByRole('button', { name: 'Dismiss' }).click()
  await expect(card).toBeHidden()
  expect((await juno.osNotifications()).map((notification) => notification.title)).toEqual(['#product'])
})
