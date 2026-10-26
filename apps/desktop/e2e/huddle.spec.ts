/**
 * Huddles (SPEC 20) as the user meets them, against the fake Slack on
 * `huddles_arch_v2`, as the owner's workspace runs. Under JUNO_E2E the page
 * runs the fake media session (`@juno/huddle-media/fake`), which the test
 * drives through `window.__junoHuddleMedia`; no test talks to Chime. On v2
 * Slack learns of a leave from Chime, so the test tells the fake when the
 * page's media stopped (`stopMedia`), as Chime would.
 */
import type { ElectronApplication } from '@playwright/test'
import { expect, syncedTest, test } from './fixtures'
import { hooks } from './hooks'
import { addRemote, attendee, chimeDrops, connection, huddleMenuItem, localMuted, microphoneAccess, openEngMain, playing, sharesReady, startHuddleFromMenu, startShare, stopShare } from './huddleFake'
import { expectStableAnchor } from './shiftProbe'

test.describe.configure({ timeout: 90_000 })

/** Main's quit dialog under JUNO_E2E: recorded, and answered as the test says (`main/index.ts`). */
interface QuitHooks {
  readonly junoTest: { huddleQuitAsked: () => ReadonlyArray<{ title: string; detail: string; confirm: string }>; huddleQuitAnswer: (answer: 'confirm' | 'cancel') => void }
}
const quitAsked = (app: ElectronApplication) => app.evaluate(() => [...(globalThis as unknown as QuitHooks).junoTest.huddleQuitAsked()])
const answerQuit = (app: ElectronApplication, answer: 'confirm' | 'cancel') => app.evaluate((_, given) => (globalThis as unknown as QuitHooks).junoTest.huddleQuitAnswer(given), answer)

// Starts signed in and synced (README, "Synced start").
syncedTest('someone shares their screen: the bar says so, the tab shows it, two can share, and it goes when they stop; then Switch leaves the huddle for another', { tag: ['@nightly', '@nightly-huddle'] }, async ({ juno, fake, win }) => {
  const bar = win.getByRole('region', { name: 'Huddle', exact: true })

  await test.step('someone shares their screen: the bar says so, the tab shows it, two can share, and it goes when they stop', async () => {
    await openEngMain(juno, { signedIn: true })
    await startHuddleFromMenu(juno)
    // The bar shows once the media session has loaded.
    await expect(bar).toBeVisible()
    await expect.poll(() => connection(win)).toBe('connected')
    for (const user of ['U0MAYA', 'U0LEO']) {
      fake.control('joinHuddle', { channel: 'C0ENG', user })
      await addRemote(win, user)
    }
    // The faces sit after the status line: a longer line must not push them.
    const faces = '[data-huddle-bar] button [role="img"]'
    const stack = win.locator(faces)
    await expect(stack.locator(':scope > span')).toHaveCount(2)

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
    const maya = win.locator(`section[aria-label="Maya's screen"]`)
    await expect(maya.locator('video')).toBeVisible()
    await expect.poll(() => playing(maya.locator('video'))).toBe(true)
    await expect(maya).not.toContainText('Loading')
    await expect(maya).toContainText("Maya's screen")
    await expect(win.locator('[data-share]')).toHaveCount(1)

    // Leo shares too: both screens show, and Expand gives one all the room until Esc.
    await startShare(win, 'U0LEO')
    await expect(bar).toContainText('Maya and Leo are sharing')
    const leo = win.locator(`section[aria-label="Leo's screen"]`)
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
    await expect(win.locator('[data-huddle-page]').getByRole('listitem', { name: 'Maya' })).toBeVisible()
  })

  await test.step('Switch leaves the huddle the user is in, joins the other, and says so', async () => {
    const first = await attendee(win)

    // Maya's huddle in #product: its header offers Switch, with no confirmation.
    fake.control('startHuddle', { channel: 'C0PRODUCT', user: 'U0MAYA' })
    // The huddle's message moves Main; wait for that update before aiming the click.
    await juno.sidebar.expectTop('#product')
    await juno.sidebar.row('#product').open()
    await juno.topic.expectTitle('Main')
    await juno.sidebar.leave()
    const switchButton = juno.topic.header.getByRole('button', { name: /^Switch/ })
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
})

test('start, mute and leave a huddle from the palette, with the Huddle menu following; while macOS blocks the microphone, Mute says so and opens System Settings', { tag: ['@electron', '@nightly', '@nightly-huddle'] }, async ({ juno, fake, win, app }) => {
  const { palette } = juno
  const bar = win.getByRole('region', { name: 'Huddle', exact: true })

  await test.step('start and mute a huddle from the palette, with the Huddle menu following, and show it', async () => {
    await openEngMain(juno)
    // No huddle: the Huddle menu is dimmed, and the palette offers only Start huddle on a Main.
    expect(await huddleMenuItem(app, 'huddle-show')).toEqual({ label: 'Show Huddle', enabled: false })
    expect(await huddleMenuItem(app, 'huddle-mute')).toEqual({ label: 'Mute Microphone', enabled: false })
    expect(await huddleMenuItem(app, 'huddle-leave')).toEqual({ label: 'Leave Huddle', enabled: false })
    await palette.open()
    await palette.type('huddle')
    await expect(palette.root.getByRole('option', { name: 'Leave huddle', exact: true })).toHaveCount(0)
    await palette.root.getByRole('option', { name: 'Start huddle' }).click()

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
    await palette.root.getByRole('option', { name: 'Show huddle', exact: true }).click()
    await juno.tabs.expectActive('eng · Huddle')
  })

  await test.step('while macOS blocks the microphone, Mute says so and opens System Settings; with no microphone it only says so', async () => {
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
    const controls = win.locator('[data-huddle-page]').getByRole('group', { name: 'Huddle controls' })
    await controls.getByRole('button', { name: 'Allow the microphone in System Settings' }).click()
    await expect.poll(() => hooks(app, 'microphoneSettingsOpened')).toBe(2)

    // Access comes back: Mute returns, and the user, muted from the palette, stays muted until they unmute.
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
  })

  await test.step('leave from the palette: the bar goes and the Huddle menu dims again', async () => {
    const attendeeId = await attendee(win)
    await palette.open()
    await palette.type('leave huddle')
    await palette.root.getByRole('option', { name: 'Leave huddle', exact: true }).click()
    await expect(bar).toBeHidden()
    await expect.poll(() => fake.calls.filter((call) => call.method === 'rooms.leave').length).toBe(1)
    await chimeDrops(win, fake, attendeeId!)
    await expect.poll(() => huddleMenuItem(app, 'huddle-leave')).toEqual({ label: 'Leave Huddle', enabled: false })
  })
})

test('quitting in a huddle asks first: Cancel keeps the huddle, Quit leaves it', { tag: ['@electron', '@nightly', '@nightly-huddle'] }, async ({ juno, fake, win, app, running }) => {
  await openEngMain(juno)
  await startHuddleFromMenu(juno)
  const bar = win.getByRole('region', { name: 'Huddle', exact: true })
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

test('once the engine stops for good, quitting in a huddle does not ask', { tag: ['@electron', '@nightly', '@nightly-huddle'] }, async ({ juno, win, app }) => {
  await openEngMain(juno)
  await startHuddleFromMenu(juno)
  // The bar shows once the media session has loaded.
  await expect(win.getByRole('region', { name: 'Huddle', exact: true })).toBeVisible()
  await expect.poll(() => connection(win)).toBe('connected')

  // With the engine gone there is nothing left to leave; a Cancel answer would keep the app open if it asked.
  await hooks(app, 'failEngine')
  await answerQuit(app, 'cancel')
  const closed = app.waitForEvent('close')
  await app.evaluate(({ app: electron }) => electron.quit())
  await closed
})
