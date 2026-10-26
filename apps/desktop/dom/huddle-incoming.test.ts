/**
 * Which incoming huddles ring (SPEC 20, "Incoming huddles"), against the fake
 * Slack: a huddle the user started on another device shows no card, an
 * ignored channel rings like any other, Ring for huddles off keeps the card
 * and notification without the ring, and the dock bounces only while Juno is
 * not frontmost. The ring is recorded, not played, under JUNO_E2E
 * (`window.__junoHuddleRing`), and main counts the dock's bounces. Join,
 * Dismiss and a huddle that ends are in huddle.test.ts (@heavy).
 *
 * Notification hours depend on the clock, so the test first sets them around
 * now. The channels that ring are set to Always.
 */
import { expect } from './expect'
import { ringing, rings } from './huddle'
import { domTest } from './test'

domTest('a huddle the user started elsewhere shows no card, an ignored channel rings like any other, the dock bounces while Juno is behind, and Ring for huddles off keeps it silent', async ({ juno, fake, step }) => {
  const { win } = juno
  await juno.notificationHoursNow()
  await juno.sidebar.row('#eng').chooseInMenu('notify-always')
  await juno.expectToast('#eng: Always')
  await juno.sidebar.row('#product').chooseInMenu('notify-always')
  await juno.expectToast('#product: Always')
  const card = win.getByRole('region', { name: 'Incoming huddle' })

  await step('a huddle the user started on another device shows no card', async () => {
    const shown = (await juno.osNotifications()).length
    // The user starts one from their phone; then Maya starts one. Only Maya's has a card.
    fake.control('startHuddle', { channel: 'C0ENG', user: 'U0TUSHAR' })
    await expect(juno.sidebar.row('#eng').root.locator('[data-huddle-indicator]')).toBeVisible()
    fake.control('startHuddle', { channel: 'C0PRODUCT', user: 'U0MAYA' })
    await expect(card.getByRole('button', { name: 'Open huddle in #product' })).toBeVisible()
    await card.getByRole('button', { name: 'Dismiss' }).click()
    await expect(card).toBeHidden()
    // The notification reaches the shell on its own path, not with the card.
    await expect.poll(async () => (await juno.osNotifications()).slice(shown).map((notification) => notification.title)).toEqual(['#product'])
    // Both end, so the next huddle in #eng is a new one.
    fake.control('endHuddle', { channel: 'C0ENG' })
    fake.control('endHuddle', { channel: 'C0PRODUCT' })
    await expect(juno.sidebar.row('#eng').root.locator('[data-huddle-indicator]')).toHaveCount(0)
  })

  await step('an ignored channel rings like any other, the dock bounces while Juno is behind, and Ring for huddles off keeps it silent', async () => {
    await juno.sidebar.selectView('Automated')
    await juno.sidebar.row('#alerts-prod').chooseInMenu('notify-always')
    await juno.expectToast('#alerts-prod: Always')
    await juno.sidebar.row('#alerts-prod').chooseInMenu('ignore-channel')
    await juno.expectToast('Ignoring #alerts-prod')

    // With Juno behind another app, Maya starts a huddle in the ignored #alerts-prod: it rings, notifies and bounces the dock once.
    await juno.setFrontmost(false)
    fake.control('startHuddle', { channel: 'C0ALERTSPROD', user: 'U0MAYA' })
    await expect(card.getByRole('button', { name: 'Open huddle in #alerts-prod' })).toBeVisible()
    await expect(card.locator('[data-pulse]')).toHaveCount(1)
    await expect.poll(() => ringing(win)).toBe(true)
    await expect.poll(() => juno.osNotifications()).toContainEqual({ title: '#alerts-prod', body: 'Maya started a huddle', silent: true })
    await expect.poll(() => juno.dockBounces()).toBe(1)
    await card.getByRole('button', { name: 'Dismiss' }).click()
    await expect(card).toBeHidden()
    await expect.poll(() => ringing(win)).toBe(false)

    // Ring for huddles is on by default. Off, with Juno frontmost, Leo's huddle in #eng shows its card, pulse and notification, with no ring and no bounce.
    await juno.setFrontmost(true)
    await juno.openNotifications()
    const ring = win.getByRole('switch', { name: 'Ring for huddles' })
    await expect(ring).toBeChecked()
    await ring.click()
    await expect(ring).not.toBeChecked()
    const before = await rings(win)
    fake.control('startHuddle', { channel: 'C0ENG', user: 'U0LEO' })
    await expect(card.getByRole('button', { name: 'Open huddle in #eng' })).toBeVisible()
    await expect(card.locator('[data-pulse]')).toHaveCount(1)
    await expect.poll(() => juno.osNotifications()).toContainEqual({ title: '#eng', body: 'Leo started a huddle', silent: true })
    expect(await rings(win)).toBe(before)
    expect(await ringing(win)).toBe(false)
    expect(await juno.dockBounces()).toBe(1)
  })
}, { timeout: 90_000 })
