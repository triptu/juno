/**
 * Huddles (SPEC 20) as the user meets them, against the fake Slack on
 * `huddles_arch_v2`, as the owner's workspace runs. Under JUNO_E2E the page
 * runs the fake media session (`@juno/huddle-media/fake`), which the test
 * drives through `window.__junoHuddleMedia`; no test talks to Chime. On v2
 * Slack learns of a leave from Chime, so the test tells the fake when the
 * page's media stopped (`stopMedia`), as Chime would.
 */
import type { Page } from '@playwright/test'
import type { FakeSlack } from '@juno/fake-slack'
import type { Juno } from './driver/juno'
import { expect, test } from './fixtures'

test.describe.configure({ timeout: 90_000 })

/** The fake media session's surface the test drives (`FakeMediaSession`). */
interface FakeMedia {
  getSnapshot(): { readonly local: { readonly attendeeId: string | undefined; readonly muted: boolean }; readonly connection: { readonly state: string } }
  addRemote(remote: { readonly userId: string }): string
  end(reason: string): void
}
type MediaWindow = Window & { readonly __junoHuddleMedia: FakeMedia }

const connection = (win: Page) => win.evaluate(() => (window as unknown as MediaWindow).__junoHuddleMedia.getSnapshot().connection.state)
const localMuted = (win: Page) => win.evaluate(() => (window as unknown as MediaWindow).__junoHuddleMedia.getSnapshot().local.muted)
const attendee = (win: Page) => win.evaluate(() => (window as unknown as MediaWindow).__junoHuddleMedia.getSnapshot().local.attendeeId ?? null)
const addRemote = (win: Page, userId: string) => win.evaluate((id) => (window as unknown as MediaWindow).__junoHuddleMedia.addRemote({ userId: id }), userId)
const endMedia = (win: Page, reason: string) => win.evaluate((why) => (window as unknown as MediaWindow).__junoHuddleMedia.end(why), reason)

async function openEngMain(juno: Juno): Promise<void> {
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row('#eng').open()
  await juno.topic.expectTitle('Main')
  await juno.sidebar.leave()
}

/** The page's media stopped: Chime drops the attendee, which on v2 is how Slack learns of the leave. */
async function chimeDrops(win: Page, fake: FakeSlack, attendeeId: string): Promise<void> {
  await expect.poll(() => connection(win)).toBe('ended')
  fake.control('stopMedia', { attendeeId })
}

test('start a huddle from the header, mute from the bar, open the tab and leave', async ({ juno, fake, win }) => {
  await openEngMain(juno)
  const header = win.getByRole('button', { name: 'Start huddle' })
  await header.click()

  // The bar shows at once, under the title bar, and the call connects.
  const bar = win.getByRole('region', { name: 'Huddle' })
  await expect(bar).toBeVisible()
  await expect(bar.getByRole('button', { name: 'Open huddle in #eng' })).toBeVisible()
  await expect.poll(() => connection(win)).toBe('connected')
  const joined = fake.calls.filter((call) => call.method === 'rooms.join')
  expect(joined).toHaveLength(1)
  expect(joined[0]?.args).toMatchObject({ channel_id: 'C0ENG', regions: 'us-east-1', _x_reason: 'calls-api/joinRoom' })
  await expect(win.getByRole('button', { name: /^In huddle/ })).toBeVisible()
  // The row shows the huddle running in its channel.
  await expect(juno.sidebar.row('#eng').root.locator('[data-huddle-indicator]')).toBeVisible()

  // Mute from the bar, then with the shortcut.
  const mute = bar.getByRole('button', { name: /^Mute/ })
  await mute.click()
  await expect(mute).toHaveAttribute('aria-pressed', 'true')
  expect(await localMuted(win)).toBe(true)
  await win.keyboard.press('Meta+Shift+Space')
  await expect(mute).toHaveAttribute('aria-pressed', 'false')

  // Someone joins: the bar shows them.
  fake.control('joinHuddle', { channel: 'C0ENG', user: 'U0MAYA' })
  await addRemote(win, 'U0MAYA')
  await expect(bar.locator('img, [data-avatar]').first()).toBeVisible()

  // The bar's first row opens the huddle tab.
  await bar.getByRole('button', { name: 'Open huddle in #eng' }).click()
  await juno.tabs.expectActive('eng · Huddle')
  await expect(win.getByRole('group', { name: 'Huddle controls' })).toBeVisible()

  // Leave: the bar goes at once and the leave goes to Slack as the official client sends it.
  const attendeeId = await attendee(win)
  expect(attendeeId).not.toBeNull()
  await bar.getByRole('button', { name: 'Leave' }).click()
  await expect(bar).toBeHidden()
  await expect.poll(() => fake.calls.filter((call) => call.method === 'rooms.leave').length).toBe(1)
  expect(fake.calls.find((call) => call.method === 'rooms.leave')?.args).toMatchObject({ channel_id: 'C0ENG', attendee_id: attendeeId, reason: 'user_initiated' })
  await chimeDrops(win, fake, attendeeId!)
  // The tab stays, and shows the huddle without the user: Maya is still in it.
  await expect(win.getByRole('button', { name: 'Join huddle' })).toBeVisible({ timeout: 15_000 })
})

test('join a running huddle, and Join here after joining on another device', async ({ juno, fake, win }) => {
  await openEngMain(juno)
  fake.control('startHuddle', { channel: 'C0ENG', user: 'U0MAYA' })
  const join = win.getByRole('button', { name: /^Join/ })
  await expect(join).toBeVisible({ timeout: 15_000 })
  await expect(juno.sidebar.row('#eng').root.locator('[data-huddle-indicator]')).toBeVisible()
  await join.click()
  const bar = win.getByRole('region', { name: 'Huddle' })
  await expect(bar).toBeVisible()
  await expect.poll(() => connection(win)).toBe('connected')
  const first = await attendee(win)

  // The user joins the same huddle from their phone: Chime moves them there.
  await endMedia(win, 'another-device')
  await expect(bar).toBeHidden()
  await juno.expectToast('You joined this huddle on another device')
  fake.control('stopMedia', { attendeeId: first! })

  // Join here joins again, with a new attendee.
  await juno.toast('You joined this huddle on another device').getByRole('button', { name: 'Join here' }).click()
  await expect(bar).toBeVisible()
  await expect.poll(() => connection(win)).toBe('connected')
  const second = await attendee(win)
  expect(second).not.toBe(first)
  expect(fake.calls.filter((call) => call.method === 'rooms.join')).toHaveLength(2)

  await bar.getByRole('button', { name: 'Leave' }).click()
  await expect(bar).toBeHidden()
  await chimeDrops(win, fake, second!)
})
