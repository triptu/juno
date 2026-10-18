import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, launchApp, tempUserData, test } from './fixtures'

/** Resolves a CSS custom property to the colour Chromium computes for it. */
async function resolveColorVar(win: Page, name: string): Promise<string> {
  return win.evaluate((variable) => {
    const probe = document.createElement('span')
    probe.style.color = `var(${variable})`
    document.body.append(probe)
    const color = getComputedStyle(probe).color
    probe.remove()
    return color
  }, name)
}

function brightness(rgb: string): number {
  const [r = 0, g = 0, b = 0] = rgb.match(/\d+/g)?.map(Number) ?? []
  return (r + g + b) / 3
}

// Two choices written just before quitting, the accent then the theme: neither may be lost. The coral fill is read in
// the light theme, before the switch to dark, and the teal one again in the dark theme, which the relaunch shows.
test('a chosen accent and the dark theme survive a relaunch', async () => {
  const userData = await tempUserData()
  try {
    await writeFile(join(userData, 'launch.json'), JSON.stringify({ theme: 'light' }))
    const first = await launchApp(userData)
    const lightBackground = await resolveColorVar(first.win, '--background')
    const lightWindow = await first.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getBackgroundColor())

    const coralFill = await resolveColorVar(first.win, '--hl')
    const signIn = first.win.getByRole('button', { name: 'Sign in to Slack' })
    await test.step('a chosen accent colours the primary button and survives a relaunch: choosing it', async () => {
      await expect(signIn).toHaveCSS('background-color', coralFill)
      await expect(first.win.getByRole('button', { name: 'Coral' })).toHaveAttribute('aria-pressed', 'true')

      await first.win.getByRole('button', { name: 'Teal' }).click()
      await expect(first.win.getByRole('button', { name: 'Teal' })).toHaveAttribute('aria-pressed', 'true')
      const tealFill = await resolveColorVar(first.win, '--hl')
      expect(tealFill).not.toBe(coralFill)
      await expect(signIn).toHaveCSS('background-color', tealFill)
      // Focus ring and selection follow the accent too.
      expect(await resolveColorVar(first.win, '--focus-ring')).not.toBe('rgba(0, 0, 0, 0)')
    })

    let darkBackground = ''
    let tealDarkFill = ''
    await test.step('a dark-theme user gets a dark window and a dark page on relaunch: choosing it', async () => {
      await first.win.getByRole('radio', { name: 'Dark' }).click()
      await expect(first.win.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true')
      darkBackground = await resolveColorVar(first.win, '--background')
      expect(brightness(darkBackground)).toBeLessThan(brightness(lightBackground))
      tealDarkFill = await resolveColorVar(first.win, '--hl')
    })

    // The choices are written in the background; quitting at once must not lose them.
    await first.close()

    const second = await launchApp(userData)
    try {
      await test.step('a dark-theme user gets a dark window and a dark page on relaunch: after the relaunch', async () => {
        // The window itself is painted dark before the page loads.
        const darkWindow = await second.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getBackgroundColor())
        expect(darkWindow).not.toBe(lightWindow)
        expect(brightness(hexToRgb(darkWindow))).toBeLessThan(brightness(hexToRgb(lightWindow)))

        // And the page renders dark from its first frame: the theme is in the
        // URL, so the first render does not go through light.
        await expect(second.win.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true')
        await expect(second.win.getByRole('main')).toHaveCSS('background-color', darkBackground)
        expect(await second.win.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark')
      })

      await test.step('a chosen accent colours the primary button and survives a relaunch: after the relaunch', async () => {
        // The accent is in the URL, so the first render is already teal.
        await expect(second.win.getByRole('button', { name: 'Teal' })).toHaveAttribute('aria-pressed', 'true')
        await expect(second.win.getByRole('button', { name: 'Sign in to Slack' })).toHaveCSS('background-color', tealDarkFill)
        expect(await second.win.evaluate(() => document.documentElement.dataset['accent'])).toBe('teal')
      })
    } finally {
      await second.close()
    }
  } finally {
    await rm(userData, { recursive: true, force: true })
  }
})

/** `#rrggbb` to `rgb(r, g, b)` so one brightness function serves both. */
function hexToRgb(hex: string): string {
  const n = Number.parseInt(hex.replace('#', ''), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}
