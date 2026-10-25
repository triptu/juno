/**
 * An incoming huddle (SPEC 20, "Incoming huddles") as the user meets it,
 * against the fake Slack: someone starts a huddle where the user is, the
 * card shows at the top of the sidebar, rings and posts a notification;
 * Join joins, Dismiss hides it, and it goes when the huddle ends. An
 * ignored channel rings like any other, Ring for huddles off keeps the card
 * and notification without the ring, and the dock bounces only while Juno
 * is not frontmost. The ring is recorded, not played, under JUNO_E2E
 * (`window.__junoHuddleRing`), and main counts the dock's bounces.
 *
 * Notification hours depend on the clock, so each test first sets them
 * around now. The channels that ring are set to Always; #product is set to
 * Never, which keeps its card quiet.
 */
import { expect } from './expect'
import { attendee, chimeDrops, connection, ringing, rings } from './huddle'
import { domTest } from './test'

domTest('someone starts a huddle: the card rings, Join joins, Dismiss hides it, and it goes when the huddle ends', async ({ juno, fake }) => {
  const { win } = juno
  await juno.notificationHoursNow()
  await juno.sidebar.row('#eng').chooseInMenu('notify-always')
  await juno.expectToast('#eng: Always')
  await juno.sidebar.row('Maya', { exact: true }).chooseInMenu('notify-always')
  await juno.expectToast('Maya: Always')
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
  // The bar shows while the join is on its way to Slack.
  await expect.poll(() => fake.calls.filter((call) => call.method === 'rooms.join').map((call) => call.args['channel_id'])).toEqual(['C0ENG'])
  await expect.poll(() => connection(win)).toBe('connected')

  // While in a call, Maya's DM huddle shows its card under the bar with Switch, and does not ring.
  const before = await rings(win)
  fake.control('startHuddle', { channel: 'D0MAYA', user: 'U0MAYA' })
  await expect(card).toBeVisible()
  await expect(card.getByRole('button', { name: 'Switch to the huddle in Maya' })).toBeVisible()
  await expect(card).toContainText('Started a huddle')
  expect(await rings(win)).toBe(before)
  expect(await ringing(win)).toBe(false)
  await expect.poll(() => juno.osNotifications()).toContainEqual({ title: 'Maya', body: 'Started a huddle', silent: true })

  // Dismiss hides it; the huddle goes on, and the DM's row still shows it running.
  await card.getByRole('button', { name: 'Dismiss' }).click()
  await expect(card).toBeHidden()
  await expect(juno.sidebar.row('Maya', { exact: true }).root.locator('[data-huddle-indicator]')).toBeVisible()

  // Leave the call. A huddle in a channel set to Never shows its card quietly: no pulse, no ring, no notification, and no bounce even with Juno in the background.
  const attendeeId = await attendee(win)
  await bar.getByRole('button', { name: 'Leave' }).click()
  await expect(bar).toBeHidden()
  await chimeDrops(win, fake, attendeeId!)
  const shown = (await juno.osNotifications()).length
  await juno.setFrontmost(false)
  fake.control('startHuddle', { channel: 'C0PRODUCT', user: 'U0LEO' })
  await expect(card.getByRole('button', { name: 'Open huddle in #product' })).toBeVisible()
  await expect(card).toContainText('Leo started a huddle')
  await expect(card.locator('[data-pulse]')).toHaveCount(0)
  expect(await ringing(win)).toBe(false)
  expect(await juno.dockBounces()).toBe(0)

  // The huddle ends: the card goes.
  fake.control('endHuddle', { channel: 'C0PRODUCT' })
  await expect(card).toBeHidden()
  expect((await juno.osNotifications()).length).toBe(shown)

  // The notification opens Juno at the huddle: its tab, where the user can join.
  const eng = (await juno.osNotifications()).findIndex((notification) => notification.title === '#eng')
  await juno.clickOsNotification(eng)
  await juno.tabs.expectActive('eng · Huddle')
  await expect(win.getByRole('button', { name: 'Join huddle' })).toBeVisible()
}, { timeout: 90_000 })

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
    expect((await juno.osNotifications()).slice(shown).map((notification) => notification.title)).toEqual(['#product'])
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
