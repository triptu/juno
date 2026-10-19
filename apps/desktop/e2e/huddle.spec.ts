/**
 * Huddles (SPEC 20) as the user meets them, against the fake Slack on
 * `huddles_arch_v2`, as the owner's workspace runs. Under JUNO_E2E the page
 * runs the fake media session (`@juno/huddle-media/fake`), which the test
 * drives through `window.__junoHuddleMedia`; no test talks to Chime. On v2
 * Slack learns of a leave from Chime, so the test tells the fake when the
 * page's media stopped (`stopMedia`), as Chime would.
 */
import type { ElectronApplication, Locator, Page } from '@playwright/test'
import { TEAM, type FakeSlack } from '@juno/fake-slack'
import type { Juno } from './driver/juno'
import { expect, test } from './fixtures'
import { hooks } from './hooks'
import { expectStableAnchor } from './shiftProbe'

test.describe.configure({ timeout: 90_000 })

/** The fake media session's surface the test drives (`FakeMediaSession`). */
interface FakeMedia {
  getSnapshot(): {
    readonly local: { readonly attendeeId: string | undefined; readonly muted: boolean }
    readonly connection: { readonly state: string }
    readonly shares: ReadonlyArray<{ readonly userId: string | undefined; readonly ready: boolean }>
  }
  addRemote(remote: { readonly userId: string }): string
  /** Someone starts or stops sharing their screen; a shown share plays a drawn test pattern. */
  startShare(userId: string): string
  stopShare(userId: string): void
  end(reason: string): void
  setMicrophoneAccess(access: string): void
  /** The call sounds the page asked for, in order. */
  readonly played: ReadonlyArray<string>
}
type MediaWindow = Window & { readonly __junoHuddleMedia: FakeMedia }

const connection = (win: Page) => win.evaluate(() => (window as unknown as MediaWindow).__junoHuddleMedia.getSnapshot().connection.state)
const localMuted = (win: Page) => win.evaluate(() => (window as unknown as MediaWindow).__junoHuddleMedia.getSnapshot().local.muted)
const attendee = (win: Page) => win.evaluate(() => (window as unknown as MediaWindow).__junoHuddleMedia.getSnapshot().local.attendeeId ?? null)
const addRemote = (win: Page, userId: string) => win.evaluate((id) => (window as unknown as MediaWindow).__junoHuddleMedia.addRemote({ userId: id }), userId)
const played = (win: Page) => win.evaluate(() => [...(window as unknown as MediaWindow).__junoHuddleMedia.played])
const microphoneAccess = (win: Page, access: string) => win.evaluate((given) => (window as unknown as MediaWindow).__junoHuddleMedia.setMicrophoneAccess(given), access)
const startShare = (win: Page, userId: string) => win.evaluate((id) => (window as unknown as MediaWindow).__junoHuddleMedia.startShare(id), userId)
const stopShare = (win: Page, userId: string) => win.evaluate((id) => (window as unknown as MediaWindow).__junoHuddleMedia.stopShare(id), userId)
const sharesReady = (win: Page) => win.evaluate(() => (window as unknown as MediaWindow).__junoHuddleMedia.getSnapshot().shares.map((share) => share.ready))
/** The video has frames, plays and moves on. */
const playing = (video: Locator) => video.evaluate((element: HTMLVideoElement) => element.readyState >= 2 && !element.paused && element.videoWidth > 0 && element.currentTime > 0)
const endMedia = (win: Page, reason: string) => win.evaluate((why) => (window as unknown as MediaWindow).__junoHuddleMedia.end(why), reason)

/** Main's quit dialog under JUNO_E2E: recorded, and answered as the test says (`main/index.ts`). */
interface QuitHooks {
  readonly junoTest: { huddleQuitAsked: () => ReadonlyArray<{ title: string; detail: string; confirm: string }>; huddleQuitAnswer: (answer: 'confirm' | 'cancel') => void }
}
const quitAsked = (app: ElectronApplication) => app.evaluate(() => [...(globalThis as unknown as QuitHooks).junoTest.huddleQuitAsked()])
const answerQuit = (app: ElectronApplication, answer: 'confirm' | 'cancel') => app.evaluate((_, given) => (globalThis as unknown as QuitHooks).junoTest.huddleQuitAnswer(given), answer)

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
  // The join sound plays once the call connects, and the bar is live once the engine has it.
  await expect.poll(() => played(win)).toEqual(['join'])
  await expect(bar).not.toContainText('Joining…')
  // The row shows the huddle running in its channel.
  await expect(juno.sidebar.row('#eng').root.locator('[data-huddle-indicator]')).toBeVisible()

  // Mute from the bar, then with the shortcut.
  const mute = bar.getByRole('button', { name: /^Mute/ })
  await mute.click()
  await expect(mute).toHaveAttribute('aria-pressed', 'true')
  expect(await localMuted(win)).toBe(true)
  await win.keyboard.press('Meta+Shift+Space')
  await expect(mute).toHaveAttribute('aria-pressed', 'false')

  // Someone joins: the bar shows them, and the join sound plays.
  fake.control('joinHuddle', { channel: 'C0ENG', user: 'U0MAYA' })
  await addRemote(win, 'U0MAYA')
  await expect(bar.locator('img, [data-avatar]').first()).toBeVisible()
  await expect.poll(() => played(win)).toEqual(['join', 'join'])

  // Someone the store has never seen joins: Juno asks Slack who they are, and the bar names them.
  fake.workspace.addUser({ id: 'U0RINSATO', team_id: TEAM.id, name: 'rin', real_name: 'Rin Sato', profile: { display_name: 'Rin Sato', real_name: 'Rin Sato' } })
  fake.control('joinHuddle', { channel: 'C0ENG', user: 'U0RINSATO' })
  await addRemote(win, 'U0RINSATO')
  await expect(bar.getByRole('img', { name: /Rin Sato/ })).toBeVisible()

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
  // Two joins (Maya, then Rin), then the user's own leave.
  await expect.poll(() => played(win)).toEqual(['join', 'join', 'join', 'leave'])
  // The tab stays, and shows the huddle without the user: Maya is still in it.
  await expect(win.getByRole('button', { name: 'Join huddle' })).toBeVisible({ timeout: 15_000 })
})

test('someone shares their screen: the bar says so, the tab shows it, two can share, and it goes when they stop', async ({ juno, fake, win }) => {
  await openEngMain(juno)
  await win.getByRole('button', { name: 'Start huddle' }).click()
  const bar = win.getByRole('region', { name: 'Huddle' })
  await expect.poll(() => connection(win)).toBe('connected')
  for (const user of ['U0MAYA', 'U0LEO']) {
    fake.control('joinHuddle', { channel: 'C0ENG', user })
    await addRemote(win, user)
  }
  // The faces sit after the status line: a longer line must not push them.
  const faces = '[data-huddle-bar] button [role="img"]'
  await expect(bar.getByRole('img', { name: 'Maya Chen, Leo Park' })).toBeVisible()

  // Maya shares: the bar says so at once, and nothing in it moves or changes size.
  const before = await bar.boundingBox()
  await expectStableAnchor(win, faces, async () => {
    await startShare(win, 'U0MAYA')
    await expect(bar).toContainText('Maya is sharing')
  })
  expect(await bar.boundingBox()).toEqual(before)
  // With no tab showing it, the share is not played.
  expect(await sharesReady(win)).toEqual([false])

  // The bar opens the tab, which shows her screen playing, named for her, in place of the tiles.
  await bar.getByRole('button', { name: 'Open huddle in #eng' }).click()
  await juno.tabs.expectActive('eng · Huddle')
  const maya = win.getByRole('region', { name: "Maya's screen" })
  await expect(maya.locator('video')).toBeVisible()
  await expect.poll(() => playing(maya.locator('video'))).toBe(true)
  await expect(maya).not.toContainText('Loading')
  await expect(maya).toContainText("Maya's screen")
  await expect(win.locator('[data-share]')).toHaveCount(1)

  // Leo shares too: both screens show, and Expand gives one all the room until Esc.
  await startShare(win, 'U0LEO')
  await expect(bar).toContainText('Maya and Leo are sharing')
  const leo = win.getByRole('region', { name: "Leo's screen" })
  await expect.poll(() => playing(leo.locator('video'))).toBe(true)
  await expect(maya).toBeVisible()
  await leo.hover()
  await leo.getByRole('button', { name: "Expand Leo's screen" }).click()
  await expect(maya).toHaveCount(0)
  await expect.poll(() => playing(leo.locator('video'))).toBe(true)
  await win.keyboard.press('Escape')
  await expect(maya).toBeVisible()
  await expect.poll(() => playing(maya.locator('video'))).toBe(true)

  // They stop: each screen goes, then the stage, and the tiles come back.
  await stopShare(win, 'U0MAYA')
  await expect(maya).toHaveCount(0)
  await expect(bar).toContainText('Leo is sharing')
  await stopShare(win, 'U0LEO')
  await expect(win.locator('[data-share]')).toHaveCount(0)
  await expect(bar).not.toContainText('sharing')
  await expect(win.locator('[data-huddle-page]').getByRole('listitem', { name: 'Maya Chen' })).toBeVisible()

  const attendeeId = await attendee(win)
  await bar.getByRole('button', { name: 'Leave' }).click()
  await chimeDrops(win, fake, attendeeId!)
})

/** A Huddle menu item as main built it: its label and whether it is enabled. */
const huddleMenuItem = (app: ElectronApplication, id: 'huddle-show' | 'huddle-mute' | 'huddle-leave') =>
  app.evaluate(({ Menu }, itemId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(itemId)
    return item === undefined || item === null ? null : { label: item.label, enabled: item.enabled }
  }, id)

test('start, mute and leave a huddle from the palette, with the Huddle menu following', async ({ juno, fake, win, app }) => {
  await openEngMain(juno)
  // No huddle: the Huddle menu is dimmed, and the palette offers only Start huddle on a Main.
  expect(await huddleMenuItem(app, 'huddle-show')).toEqual({ label: 'Show Huddle', enabled: false })
  expect(await huddleMenuItem(app, 'huddle-mute')).toEqual({ label: 'Mute Microphone', enabled: false })
  expect(await huddleMenuItem(app, 'huddle-leave')).toEqual({ label: 'Leave Huddle', enabled: false })
  const { palette } = juno
  await palette.open()
  await palette.type('huddle')
  await expect(palette.root.getByRole('option', { name: 'Leave huddle' })).toHaveCount(0)
  await palette.root.getByRole('option', { name: 'Start huddle' }).click()

  const bar = win.getByRole('region', { name: 'Huddle' })
  await expect(bar).toBeVisible()
  await expect.poll(() => connection(win)).toBe('connected')
  await expect.poll(() => huddleMenuItem(app, 'huddle-leave')).toEqual({ label: 'Leave Huddle', enabled: true })
  expect(await huddleMenuItem(app, 'huddle-show')).toEqual({ label: 'Show Huddle', enabled: true })

  // Mute from the palette: the menu names the way back.
  await palette.open()
  await palette.type('mute')
  await palette.root.getByRole('option', { name: /^Mute/ }).click()
  await expect.poll(() => localMuted(win)).toBe(true)
  await expect(bar.getByRole('button', { name: /^Mute/ })).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => huddleMenuItem(app, 'huddle-mute')).toEqual({ label: 'Unmute Microphone', enabled: true })

  // Show huddle opens the huddle tab.
  await palette.open()
  await palette.type('show huddle')
  await palette.root.getByRole('option', { name: 'Show huddle' }).click()
  await juno.tabs.expectActive('eng · Huddle')

  // Leave from the palette: the bar goes and the menu dims again.
  const attendeeId = await attendee(win)
  await palette.open()
  await palette.type('leave huddle')
  await palette.root.getByRole('option', { name: 'Leave huddle' }).click()
  await expect(bar).toBeHidden()
  await expect.poll(() => fake.calls.filter((call) => call.method === 'rooms.leave').length).toBe(1)
  await chimeDrops(win, fake, attendeeId!)
  await expect.poll(() => huddleMenuItem(app, 'huddle-leave')).toEqual({ label: 'Leave Huddle', enabled: false })
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

test('quitting in a huddle asks first: Cancel keeps the huddle, Quit leaves it', async ({ juno, fake, win, app, running }) => {
  await openEngMain(juno)
  await win.getByRole('button', { name: 'Start huddle' }).click()
  const bar = win.getByRole('region', { name: 'Huddle' })
  await expect(bar).toBeVisible()
  await expect.poll(() => connection(win)).toBe('connected')
  const attendeeId = await attendee(win)

  // ⌘Q, the menu's Quit and the Dock's Quit all start the same app quit. Cancel keeps the huddle.
  await answerQuit(app, 'cancel')
  await app.evaluate(({ app: electron }) => electron.quit())
  await expect.poll(() => quitAsked(app)).toEqual([{ title: 'Leave the huddle and quit?', detail: "You're in a huddle in #eng.", confirm: 'Quit' }])
  await expect(bar).toBeVisible()
  expect(await connection(win)).toBe('connected')
  expect(fake.calls.filter((call) => call.method === 'rooms.leave')).toHaveLength(0)

  // Quit leaves the huddle before Juno exits.
  await answerQuit(app, 'confirm')
  await running.close()
  expect(fake.calls.find((call) => call.method === 'rooms.leave')?.args).toMatchObject({ channel_id: 'C0ENG', attendee_id: attendeeId })
})

test('once the engine stops for good, quitting in a huddle does not ask', async ({ juno, win, app }) => {
  await openEngMain(juno)
  await win.getByRole('button', { name: 'Start huddle' }).click()
  // The bar shows once the media session has loaded.
  await expect(win.getByRole('region', { name: 'Huddle' })).toBeVisible()
  await expect.poll(() => connection(win)).toBe('connected')

  // With the engine gone there is nothing left to leave; a Cancel answer would keep the app open if it asked.
  await hooks(app, 'failEngine')
  await answerQuit(app, 'cancel')
  const closed = app.waitForEvent('close')
  await app.evaluate(({ app: electron }) => electron.quit())
  await closed
})

test('while macOS blocks the microphone, Mute says so and opens System Settings; with no microphone it only says so', async ({ juno, fake, win, app }) => {
  await openEngMain(juno)
  await win.getByRole('button', { name: 'Start huddle' }).click()
  const bar = win.getByRole('region', { name: 'Huddle' })
  // The bar shows once the media session has loaded.
  await expect(bar).toBeVisible()
  await expect.poll(() => connection(win)).toBe('connected')

  // macOS turns the microphone off for Juno: the call goes on, muted, so the user can listen.
  await microphoneAccess(win, 'denied')
  await expect(bar).toContainText('Microphone blocked')
  expect(await localMuted(win)).toBe(true)
  await expect(bar.getByRole('button', { name: /^Mute/ })).toHaveCount(0)
  await bar.getByRole('button', { name: 'Allow the microphone in System Settings' }).click()
  await expect.poll(() => hooks(app, 'microphoneSettingsOpened')).toBe(1)

  // The tab's Mute is the same.
  await bar.getByRole('button', { name: 'Open huddle in #eng' }).click()
  await juno.tabs.expectActive('eng · Huddle')
  const controls = win.getByRole('group', { name: 'Huddle controls' })
  await controls.getByRole('button', { name: 'Allow the microphone in System Settings' }).click()
  await expect.poll(() => hooks(app, 'microphoneSettingsOpened')).toBe(2)

  // Access comes back: Mute returns, and the user stays muted until they unmute.
  await microphoneAccess(win, 'granted')
  await expect(bar).not.toContainText('Microphone blocked')
  const mute = bar.getByRole('button', { name: /^Mute/ })
  await expect(mute).toHaveAttribute('aria-pressed', 'true')
  await mute.click()
  await expect.poll(() => localMuted(win)).toBe(false)

  // The microphone is unplugged and none is left: that is not a block, and System Settings cannot help.
  await microphoneAccess(win, 'unavailable')
  await expect(bar).toContainText('No microphone')
  await expect(bar).not.toContainText('Microphone blocked')
  expect(await localMuted(win)).toBe(true)
  const missing = bar.getByRole('button', { name: 'No microphone connected' })
  await expect(missing).toHaveAttribute('aria-disabled', 'true')
  await expect(bar.getByRole('button', { name: 'Allow the microphone in System Settings' })).toHaveCount(0)
  await expect(controls.getByRole('button', { name: 'No microphone connected' })).toBeVisible()

  const attendeeId = await attendee(win)
  await bar.getByRole('button', { name: 'Leave' }).click()
  await chimeDrops(win, fake, attendeeId!)
})

test('Switch leaves the huddle the user is in, joins the other, and says so', async ({ juno, fake, win }) => {
  await openEngMain(juno)
  await win.getByRole('button', { name: 'Start huddle' }).click()
  const bar = win.getByRole('region', { name: 'Huddle' })
  await expect(bar).toBeVisible()
  await expect.poll(() => connection(win)).toBe('connected')
  const first = await attendee(win)

  // Maya's huddle in #product: its header offers Switch, with no confirmation.
  fake.control('startHuddle', { channel: 'C0PRODUCT', user: 'U0MAYA' })
  await juno.sidebar.row('#product').open()
  await juno.topic.expectTitle('Main')
  await juno.sidebar.leave()
  const switchButton = win.getByRole('button', { name: /^Switch/ })
  await expect(switchButton).toBeVisible({ timeout: 15_000 })
  await switchButton.click()
  await juno.expectToast('Left the huddle in #eng')

  // The first huddle is left before the second is joined; there is never a second call.
  await expect.poll(() => fake.calls.filter((call) => call.method === 'rooms.leave').map((call) => call.args['attendee_id'])).toEqual([first])
  // Chime drops the first attendee; the page may already be connecting the second, so the test does not wait for `ended`.
  fake.control('stopMedia', { attendeeId: first! })
  await expect(bar.getByRole('button', { name: 'Open huddle in #product' })).toBeVisible()
  await expect.poll(() => attendee(win)).not.toBe(first)
  await expect.poll(() => connection(win)).toBe('connected')
  const joins = fake.calls.filter((call) => call.method === 'rooms.join').map((call) => call.args['channel_id'])
  expect(joins).toEqual(['C0ENG', 'C0PRODUCT'])
  const second = await attendee(win)

  await bar.getByRole('button', { name: 'Leave' }).click()
  await chimeDrops(win, fake, second!)
})
