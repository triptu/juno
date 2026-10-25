/**
 * Privacy mode for screen sharing (SPEC section 5): message text blurs in
 * the sidebar and All topics, and so do titles that are only a message's first
 * words (AI titles and renames stay readable), notifications leave the text
 * out, the sidebar footer turns it off, and it survives a relaunch.
 */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, launchApp, test } from './fixtures'
import { Juno } from './driver/juno'

// Starts signed in and synced (README, "Synced start").
test.use({ synced: true })

const RINA = 'Rina finished the onsite'

test('View › Reload keeps privacy mode on, and a launch.json field the app cannot read does not turn it off', { tag: '@electron' }, async ({ juno, app, running, userData, fake, slackApp }) => {
  await test.step('View › Reload keeps privacy mode on', async () => {
    expect(await juno.privacy.menuLabel()).toBe('Hide Message Text')
    await juno.privacy.toggleWithMenu()
    await expect(juno.privacy.footer).toBeVisible()

    await app.evaluate(({ Menu, BrowserWindow }) => Menu.getApplicationMenu()?.getMenuItemById('reload')?.click(undefined, BrowserWindow.getAllWindows()[0]))
    const rina = juno.sidebar.row(RINA)
    await rina.expectVisible()
    await expect(juno.privacy.footer).toBeVisible()
    await juno.privacy.expectBlurred(rina.preview)
    expect(await juno.privacy.menuLabel()).toBe('Show Message Text')
    await juno.privacy.toggleWithMenu()
    await expect(juno.privacy.footer).toHaveCount(0)
    expect(await juno.privacy.menuLabel()).toBe('Hide Message Text')
  })

  await test.step('a launch.json field the app cannot read does not turn privacy mode off', async () => {
    await running.close()
    // An accent this version does not know, as after going back to an older version.
    await writeFile(join(userData, 'launch.json'), JSON.stringify({ theme: 'dark', privacy: true, accent: 'ultraviolet' }))
    const again = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword })
    try {
      const restarted = new Juno(again.app, again.win)
      await expect(restarted.privacy.footer).toBeVisible({ timeout: 30_000 })
      await restarted.privacy.expectBlurred(restarted.sidebar.row(RINA).preview)
      expect(await again.win.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark')
    } finally {
      await again.close()
    }
  })
})
