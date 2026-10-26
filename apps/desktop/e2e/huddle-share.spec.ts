/**
 * Sharing your own screen or window in a huddle (SPEC 20, "Sharing your
 * own"), against the fake media session and main's drawn sources
 * (`huddleFake.ts`). Real capture and the macOS prompt are checked by hand.
 */
import type { Page } from '@playwright/test'
import type { FakeSlack } from '@juno/fake-slack'
import type { Juno } from './driver/juno'
import { expect, test } from './fixtures'
import { hooks } from './hooks'
import { addRemote, attendee, chimeDrops, closeShareWindow, connection, huddleMenuItem, openEng, ownShare, playing, screenRecording, startHuddleFromMenu, startShare, type MediaWindow } from './huddleFake'
import { expectStableAnchor } from './shiftProbe'

// Starts signed in and synced (README, "Synced start").
test.use({ synced: true })

test.describe.configure({ timeout: 90_000 })

const endOwnSource = (win: Page) => win.evaluate(() => (window as unknown as MediaWindow).__junoHuddleMedia.endOwnSource())

/** Starts a huddle in #eng with Maya in it, and returns the bar. */
async function startWithMaya(juno: Juno, fake: FakeSlack, win: Page) {
  await openEng(juno)
  await startHuddleFromMenu(juno)
  const bar = win.getByRole('region', { name: 'Huddle', exact: true })
  await expect(bar).toBeVisible()
  await expect.poll(() => connection(win)).toBe('connected')
  fake.control('joinHuddle', { channel: 'C0ENG', user: 'U0MAYA' })
  await addRemote(win, 'U0MAYA')
  return bar
}

async function leave(win: Page, fake: FakeSlack) {
  const attendeeId = await attendee(win)
  await win.getByRole('region', { name: 'Huddle', exact: true }).getByRole('button', { name: 'Leave' }).click()
  await chimeDrops(win, fake, attendeeId!)
}

// One huddle with Maya in it for every step; each step ends with nothing of the user's shared.
test('sharing your own screen or window: from the bar, the tab, ⌘K and the keys; how a share ends; and the Screen Recording steps', { tag: ['@nightly', '@nightly-huddle'] }, async ({ juno, fake, win, app }) => {
  const bar = await startWithMaya(juno, fake, win)
  const sheet = win.getByRole('dialog', { name: 'Share your screen' })

  await test.step('share a window from the bar, previewed in the tab; then a screen with the keys, not previewed; stop from the bar', async () => {
    const faces = '[data-huddle-bar] button [role="img"]'
    await expect(win.locator(faces)).toHaveAccessibleName('Maya')
    expect(await huddleMenuItem(app, 'huddle-share')).toEqual({ label: 'Share Screen…', enabled: true })

    // Share screen opens the sheet: the screens, then the windows, Juno's own left out, the first screen chosen.
    await bar.getByRole('button', { name: 'Share screen' }).click()
    await expect(sheet.getByRole('radio')).toHaveCount(4)
    await expect(sheet.getByRole('radio', { name: 'Built-in display' })).toHaveAttribute('aria-checked', 'true')

    // Pick the window and share it: the bar names it, and nothing in the bar moves.
    const before = await bar.boundingBox()
    await sheet.getByRole('radio', { name: 'Q4 roadmap — Docs' }).click()
    await expectStableAnchor(win, faces, async () => {
      await sheet.getByRole('button', { name: 'Share', exact: true }).click()
      await expect(bar).toContainText("You're sharing Q4 roadmap — Docs")
    })
    expect(await bar.boundingBox()).toEqual(before)
    await expect(sheet).toBeHidden()
    expect(await ownShare(win)).toBe('window:101:0')
    await expect(bar.getByRole('button', { name: 'Stop sharing' })).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => huddleMenuItem(app, 'huddle-share')).toEqual({ label: 'Stop Sharing', enabled: true })

    // The tab previews the window from the capture itself.
    await bar.getByRole('button', { name: 'Open huddle in #eng' }).click()
    await juno.tabs.expectActive('eng · Huddle')
    const preview = win.getByRole('region', { name: 'Your window, Q4 roadmap — Docs' })
    await expect(preview).toContainText('Your window')
    await expect.poll(() => playing(preview.locator('video'))).toBe(true)

    // Stop sharing on the preview, then share a screen with the keyboard: the arrows choose, Enter shares.
    await preview.getByRole('button', { name: 'Stop sharing' }).click()
    await expect(preview).toHaveCount(0)
    await expect.poll(() => ownShare(win)).toBeNull()
    await win.locator('[data-huddle-page]').getByRole('button', { name: 'Share screen' }).click()
    await expect(sheet.getByRole('radio', { name: 'Built-in display' })).toBeFocused()
    await win.keyboard.press('ArrowRight')
    await expect(sheet.getByRole('radio', { name: 'Studio Display' })).toHaveAttribute('aria-checked', 'true')
    await win.keyboard.press('Enter')
    await expect(sheet).toBeHidden()
    // A whole screen is named, never previewed.
    await expect(win.locator('[data-huddle-page]')).toContainText("You're sharing Studio Display")
    await expect(win.locator('[data-share="own"]')).toHaveCount(0)
    await expect(win.locator('[data-huddle-page]').getByRole('listitem', { name: 'Maya' })).toBeVisible()

    // Stop from the bar.
    await bar.getByRole('button', { name: 'Stop sharing' }).click()
    await expect.poll(() => ownShare(win)).toBeNull()
    await expect(bar).not.toContainText('sharing')
    await expect.poll(() => huddleMenuItem(app, 'huddle-share')).toEqual({ label: 'Share Screen…', enabled: true })
  })

  await test.step('until macOS lets Juno record the screen, the share sheet asks, then points to System Settings', async () => {
    // Not asked yet: Continue shows the macOS prompt, which the test answers with Allow.
    await screenRecording(app, 'unknown')
    await bar.getByRole('button', { name: 'Share screen' }).click()
    await expect(sheet).toContainText('Allow screen recording')
    await sheet.getByRole('button', { name: 'Continue' }).click()
    await expect(sheet.getByRole('radio', { name: 'Built-in display' })).toBeVisible()
    await sheet.getByRole('button', { name: 'Cancel' }).click()
    await expect(sheet).toBeHidden()

    // Off for Juno: the sheet says so, and Open System Settings opens them at Screen Recording.
    await screenRecording(app, 'denied')
    await bar.getByRole('button', { name: 'Share screen' }).click()
    await expect(sheet).toContainText('Screen recording is off for Juno')
    await expect(sheet.getByRole('radio')).toHaveCount(0)
    await sheet.getByRole('button', { name: 'Open System Settings' }).click()
    await expect.poll(() => hooks(app, 'screenRecordingSettingsOpened')).toBe(1)
    await win.keyboard.press('Escape')
    await expect(sheet).toBeHidden()
    expect(await ownShare(win)).toBeNull()
    await screenRecording(app, 'granted')
  })

  await test.step('a share ends by itself: a closed window says so, a capture stopped from macOS does not, a failed one says so; Esc and two others sharing share nothing', async () => {
    // From ⌘K. The window closes: the share stops with a toast.
    await juno.palette.open()
    await juno.palette.type('share screen')
    await juno.palette.root.getByRole('option', { name: 'Share screen…' }).click()
    await sheet.getByRole('radio', { name: 'Terminal' }).dblclick()
    await expect.poll(() => ownShare(win)).toBe('window:102:0')
    await closeShareWindow(app, 'window:102:0')
    await endOwnSource(win)
    await juno.expectToast('Stopped sharing. The window closed.')
    await expect(bar).not.toContainText('sharing')

    // The window is still there, so the user stopped the capture from macOS: no toast.
    await bar.getByRole('button', { name: 'Share screen' }).click()
    await sheet.getByRole('radio', { name: 'Q4 roadmap — Docs' }).dblclick()
    await expect.poll(() => ownShare(win)).toBe('window:101:0')
    await endOwnSource(win)
    await expect.poll(() => ownShare(win)).toBeNull()
    await expect(juno.toast('Stopped sharing. The window closed.')).toHaveCount(0)

    // The capture cannot start.
    await win.evaluate(() => {
      ;(window as unknown as MediaWindow).__junoHuddleMedia.failNextShare = true
    })
    await bar.getByRole('button', { name: 'Share screen' }).click()
    await sheet.getByRole('button', { name: 'Share', exact: true }).click()
    await juno.expectToast("Couldn't share your screen")
    expect(await ownShare(win)).toBeNull()

    // Esc closes the sheet without sharing.
    await bar.getByRole('button', { name: 'Share screen' }).click()
    await expect(sheet).toBeVisible()
    await win.keyboard.press('Escape')
    await expect(sheet).toBeHidden()
    expect(await ownShare(win)).toBeNull()

    // Two others share: no room for a third, in the bar and the menu.
    fake.control('joinHuddle', { channel: 'C0ENG', user: 'U0LEO' })
    await addRemote(win, 'U0LEO')
    await startShare(win, 'U0MAYA')
    await startShare(win, 'U0LEO')
    await expect(bar.getByRole('button', { name: 'Two people are sharing already' })).toBeVisible()
    await expect.poll(() => huddleMenuItem(app, 'huddle-share')).toEqual({ label: 'Share Screen…', enabled: false })
    await leave(win, fake)
  })
})
