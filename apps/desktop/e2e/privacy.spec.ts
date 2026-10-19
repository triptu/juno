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
const ALERTS_MAIN = '#alerts-prod'

test('privacy mode blurs previews from the account menu, hides notification text, survives a relaunch and turns off from the footer', async ({ juno, slack, fake, slackApp, userData, running }) => {
  const { sidebar, privacy, accountMenu } = juno
  const rina = sidebar.row(RINA)
  await rina.expectVisible()
  await privacy.expectBlurred(rina.preview, false)
  await expect(privacy.footer).toHaveCount(0)
  expect(await privacy.menuLabel()).toBe('Hide Message Text')

  await accountMenu.open()
  await accountMenu.item(/^Hide message text/).click()
  await expect(accountMenu.root).toHaveCount(0)
  await privacy.expectBlurred(rina.preview)
  await expect(privacy.footer).toBeVisible()
  expect(await privacy.menuLabel()).toBe('Show Message Text')
  // With AI off the title is the message's first words, so it blurs too; hovering the row reveals nothing.
  await privacy.expectBlurred(rina.titleText)
  await rina.root.hover()
  await privacy.expectBlurred(rina.preview)

  // The menu offers the way back.
  await accountMenu.open()
  await expect(accountMenu.item(/^Show message text/)).toBeVisible()
  await accountMenu.close()

  // A notification says where it came from, not what was written. #alerts-prod is a bot channel, in Automated.
  await sidebar.selectView('Automated')
  await sidebar.row(ALERTS_MAIN).chooseInMenu('notify-every')
  await juno.expectToast('#alerts-prod: Every message')
  await sidebar.filter('All')
  slack.as('Leo').postIn('alerts-prod', 'Payroll export failed for 3 people')
  await expect.poll(async () => (await juno.osNotifications()).map((shown) => shown.body), { timeout: 15_000 }).toContain('Message hidden')
  expect((await juno.osNotifications()).some((shown) => shown.body.includes('Payroll'))).toBe(false)

  // All topics blurs its previews too.
  await juno.allTopics.open()
  const row = juno.allTopics.row('Rina finished the onsite')
  await row.expectVisible()
  await privacy.expectBlurred(row.preview)

  // Still on after a relaunch, from the first render.
  await running.close()
  const again = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword })
  try {
    const second = new Juno(again.app, again.win)
    await expect(second.privacy.footer).toBeVisible({ timeout: 30_000 })
    expect(await again.win.evaluate(() => document.documentElement.hasAttribute('data-privacy'))).toBe(true)
    const rinaAgain = second.sidebar.row(RINA)
    await rinaAgain.expectVisible()
    await second.privacy.expectBlurred(rinaAgain.preview)

    // Show in the footer turns it off in one click.
    await second.privacy.showButton.click()
    await expect(second.privacy.footer).toHaveCount(0)
    await second.privacy.expectBlurred(rinaAgain.preview, false)
    expect(await second.privacy.menuLabel()).toBe('Hide Message Text')

    // View › Hide Message Text (⌃⌘H) turns it on and off again.
    await second.privacy.toggleWithMenu()
    await expect(second.privacy.footer).toBeVisible()
    await second.privacy.expectBlurred(rinaAgain.preview)
    await second.privacy.toggleWithMenu()
    await expect(second.privacy.footer).toHaveCount(0)
  } finally {
    await again.close()
  }

  // Off is remembered too.
  const third = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword })
  try {
    const last = new Juno(third.app, third.win)
    const rinaLast = last.sidebar.row(RINA)
    await rinaLast.expectVisible()
    await last.privacy.expectBlurred(rinaLast.preview, false)
    await expect(last.privacy.footer).toHaveCount(0)
  } finally {
    await third.close()
  }
})

test('View › Reload keeps privacy mode on', async ({ juno, app }) => {
  await juno.privacy.toggleWithMenu()
  await expect(juno.privacy.footer).toBeVisible()

  await app.evaluate(({ Menu, BrowserWindow }) => Menu.getApplicationMenu()?.getMenuItemById('reload')?.click(undefined, BrowserWindow.getAllWindows()[0]))
  const rina = juno.sidebar.row(RINA)
  await rina.expectVisible()
  await expect(juno.privacy.footer).toBeVisible()
  await juno.privacy.expectBlurred(rina.preview)
  expect(await juno.privacy.menuLabel()).toBe('Show Message Text')
})

test('a launch.json field the app cannot read does not turn privacy mode off', async ({ running, userData, fake, slackApp }) => {
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
