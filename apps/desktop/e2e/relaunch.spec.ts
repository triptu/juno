// What main keeps for the window, in one synced launch and one relaunch on its data folder: privacy mode
// (turned on by a screen share through main's screen watch, by hand, and across View › Reload), the sidebar's width
// and hidden state, the theme and accent, which main paints into the window before the page loads, and a window
// saved on a display that is gone. How main reads a launch.json it cannot parse, or a field from another version,
// is `test/launch.test.ts`.
// Privacy mode's blur, notifications and footer are in the DOM lane (`dom/privacy.test.ts`).
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, launchApp, test, type LaunchOptions } from './fixtures'
import { Juno } from './driver/juno'

// Starts signed in and synced (README, "Synced start").
test.use({ synced: true })

test.describe.configure({ timeout: 120_000 })

// No full stop: the AI title (the first sentence, cut short) replaces the message text once the title job runs.
const RINA = 'Rina finished the onsite'
const SWITCH = 'Hide message text while sharing the screen'

/** Resolves a CSS custom property to the colour Chromium computes for it. */
function resolveColorVar(win: Page, name: string): Promise<string> {
  return win.evaluate((variable) => {
    const probe = document.createElement('span')
    probe.style.color = `var(${variable})`
    document.body.append(probe)
    const color = getComputedStyle(probe).color
    probe.remove()
    return color
  }, name)
}

/** `#rrggbb` or `rgb(r, g, b)` to its mean channel. */
function brightness(color: string): number {
  const channels = color.startsWith('#')
    ? [0, 2, 4].map((at) => Number.parseInt(color.slice(1 + at, 3 + at), 16))
    : color.match(/\d+/g)?.map(Number) ?? []
  const [r = 0, g = 0, b = 0] = channels
  return (r + g + b) / 3
}

test('privacy mode, the sidebar, the theme and the accent survive a relaunch, and a window saved on a display that is gone opens on screen', { tag: '@electron' }, async ({ juno, app, running, userData, fake, slackApp }) => {
  const options: LaunchOptions = { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword }
  const { privacy, sidebar, frame } = juno
  const rina = sidebar.row(RINA)
  await rina.expectVisible()

  await test.step('a share that starts while Juno runs hides message text, and stopping shows it again', async () => {
    await privacy.startSharing()
    await privacy.expectBlurred(rina.preview)
    expect(await privacy.footerText()).toBe('Message text hidden while sharing')
    await privacy.stopSharing()
    await expect(privacy.footer).toHaveCount(0)
    await privacy.expectBlurred(rina.preview, false)

    // Show turns it off for this share; the next share hides the text again.
    await privacy.startSharing()
    await privacy.showButton.click()
    await expect(privacy.footer).toHaveCount(0)
    await privacy.startSharing()
    await privacy.expectBlurred(rina.preview, false)
    await privacy.stopSharing()
    await privacy.startSharing()
    await expect(privacy.footer).toBeVisible()
    await privacy.stopSharing()
    await expect(privacy.footer).toHaveCount(0)
  })

  await test.step('a mode turned on by hand stays on after sharing stops, and the setting turns hiding off', async () => {
    await privacy.toggleWithMenu()
    await privacy.startSharing()
    await privacy.stopSharing()
    expect(await privacy.footerText()).toBe('Message text hidden')
    await privacy.expectBlurred(rina.preview)
    // Turned on by sharing, then touched by hand (off and on again): it is the user's now and stays on.
    await privacy.toggleWithMenu()
    await expect(privacy.footer).toHaveCount(0)
    await privacy.startSharing()
    await expect(privacy.footer).toBeVisible()
    await privacy.toggleWithMenu()
    await privacy.toggleWithMenu()
    await privacy.stopSharing()
    expect(await privacy.footerText()).toBe('Message text hidden')
    await privacy.toggleWithMenu()
    await expect(privacy.footer).toHaveCount(0)

    // Off in Settings › General: sharing leaves the text alone.
    await juno.openSettings('General')
    const toggle = juno.settings.root.getByRole('switch', { name: SWITCH })
    await toggle.uncheck()
    await expect(toggle).not.toBeChecked()
    await privacy.startSharing()
    await privacy.stopSharing()
    await expect(privacy.footer).toHaveCount(0)
    await juno.tabs.close('Settings')
  })

  await test.step('View › Reload keeps privacy mode on', async () => {
    await privacy.toggleWithMenu()
    await expect(privacy.footer).toBeVisible()
    await app.evaluate(({ Menu, BrowserWindow }) => Menu.getApplicationMenu()?.getMenuItemById('reload')?.click(undefined, BrowserWindow.getAllWindows()[0]))
    await rina.expectVisible()
    await expect(privacy.footer).toBeVisible()
    await privacy.expectBlurred(rina.preview)
    expect(await privacy.menuLabel()).toBe('Show Message Text')
  })

  await test.step('the sidebar resizes by its edge, resets on double-click, and hides', async () => {
    await frame.expectWidth(384)
    await frame.drag(60)
    await frame.expectWidth(444)
    await frame.drag(200)
    await frame.expectWidth(480)
    // Past the narrowest but not below 200: it stops at 312.
    await frame.drag(-250)
    await frame.expectWidth(312)
    await frame.doubleClickEdge()
    await frame.expectWidth(384)
    await frame.drag(-40)
    await frame.expectWidth(344)
    await frame.toggleWithButton()
    await frame.expectHidden()
    await frame.toggleWithMenu()
    await frame.expectHidden(false)
    await frame.expectWidth(344)
    // Dragging the edge far enough left hides it and keeps its width.
    await frame.drag(-250)
    await frame.expectHidden()
    await expect.poll(async () => {
      try {
        return (JSON.parse(await readFile(join(userData, 'launch.json'), 'utf8')) as { sidebar?: unknown }).sidebar
      } catch {
        return undefined
      }
    }).toEqual({ width: 344, collapsed: true })
  })

  // Two choices made just before quitting, the accent then the theme: neither may be lost.
  const lightWindow = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getBackgroundColor())
  let dark = { background: '', accent: '' }
  await test.step('choosing the teal accent and the dark theme in Settings › Appearance', async () => {
    const lightBackground = await resolveColorVar(juno.win, '--background')
    // Settings is in the account menu, in the sidebar; it hides again just before quitting.
    await frame.toggleWithMenu()
    await juno.openSettings('Appearance')
    const teal = juno.settings.root.getByRole('button', { name: 'Teal' })
    await teal.click()
    await expect(teal).toHaveAttribute('aria-pressed', 'true')
    await juno.settings.themeRadio('Dark').click()
    await expect(juno.settings.themeRadio('Dark')).toHaveAttribute('aria-checked', 'true')
    dark = { background: await resolveColorVar(juno.win, '--background'), accent: await resolveColorVar(juno.win, '--hl') }
    expect(brightness(dark.background)).toBeLessThan(brightness(lightBackground))
    await frame.toggleWithMenu()
    await frame.expectHidden()
  })
  await running.close()
  // Its saved window is on a display that is gone.
  const saved = JSON.parse(await readFile(join(userData, 'launch.json'), 'utf8')) as Record<string, unknown>
  await writeFile(join(userData, 'launch.json'), JSON.stringify({ ...saved, bounds: { x: -6000, y: -6000, width: 1100, height: 760 } }))

  const second = await launchApp(userData, options)
  try {
    const restarted = new Juno(second.app, second.win)
    await test.step('after the relaunch: a dark window before the page loads, the dark page and the teal accent', async () => {
      const window = await second.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getBackgroundColor())
      expect(brightness(window)).toBeLessThan(brightness(lightWindow))
      // The theme and accent are in the URL, so the first render does not go through light or coral.
      expect(await second.win.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark')
      expect(await second.win.evaluate(() => document.documentElement.dataset['accent'])).toBe('teal')
      await expect.poll(() => resolveColorVar(second.win, '--background')).toBe(dark.background)
      await expect.poll(() => resolveColorVar(second.win, '--hl')).toBe(dark.accent)
    })
    await test.step('after the relaunch: the window is on screen at its saved size', async () => {
      const placed = await second.app.evaluate(({ BrowserWindow, screen }) => {
        const bounds = BrowserWindow.getAllWindows()[0]!.getBounds()
        const { workArea } = screen.getPrimaryDisplay()
        return { bounds, inside: bounds.x >= workArea.x && bounds.y >= workArea.y && bounds.x + bounds.width <= workArea.x + workArea.width && bounds.y + bounds.height <= workArea.y + workArea.height }
      })
      expect(placed.inside).toBe(true)
      expect(placed.bounds.width).toBe(1100)
      expect(placed.bounds.height).toBe(760)
    })
    await test.step('after the relaunch: the sidebar is hidden at its width, and privacy mode is on', async () => {
      await restarted.frame.expectHidden()
      await restarted.frame.toggleWithMenu()
      await restarted.frame.expectWidth(344)
      await expect(restarted.privacy.footer).toBeVisible({ timeout: 30_000 })
      await restarted.privacy.expectBlurred(restarted.sidebar.row(RINA).preview)
    })
  } finally {
    await second.close()
  }
})
