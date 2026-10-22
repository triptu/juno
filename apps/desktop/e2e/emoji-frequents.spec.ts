import { expect, launchApp, test } from './fixtures'
import { Juno } from './driver/juno'

test('frequently used emoji survive a restart and an update from their first picker paint', async ({ juno, fake, running, userData, slackApp }) => {
  test.setTimeout(120_000)
  fake.workspace.prefs = { ...fake.workspace.prefs, emoji_use: JSON.stringify({
    eyes: 5, tada: 20, hello_juno: 30, '+1::skin-tone-3': 12, thumbsup: 10,
    missing_emoji: 100, deleted_custom: 90,
  }) }
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row('#eng').open()
  const row = juno.topic.list.locator('[data-message-row]').last()
  const ts = await row.getAttribute('data-message-row')
  await row.hover()
  await row.getByRole('button', { name: 'More reactions' }).click()
  const frequents = () => juno.win.getByRole('group', { name: 'Frequently used' }).locator('[data-emoji]')
  await expect.poll(() => frequents().evaluateAll((cells) => cells.map((cell) => cell.getAttribute('data-emoji')))).toEqual([
    'juno_wave', '+1', 'tada', 'eyes', 'white_check_mark',
  ])
  // Socket updates change the next picker, while the open picker keeps its cells still.
  fake.emitFrame({ type: 'pref_change', name: 'emoji_use', value: JSON.stringify({ tada: 40, eyes: 3 }) })
  const search = juno.win.getByRole('textbox', { name: 'Search emoji' })
  await search.fill('rocket')
  await search.press('Enter')
  await expect(row.getByRole('button', { name: '1 🚀, including you' })).toBeVisible()
  await expect.poll(() => fake.messages('C0ENG').find((message) => message.ts === ts)?.reactions?.some((reaction) => reaction.name === 'rocket')).toBe(true)
  await row.hover()
  await row.getByRole('button', { name: 'More reactions' }).click()
  await expect.poll(() => frequents().evaluateAll((cells) => cells.map((cell) => cell.getAttribute('data-emoji')))).toEqual([
    'rocket', 'tada', 'eyes', '+1', 'white_check_mark',
  ])
  await search.press('Escape')
  await running.close()

  for (const cacheMigration of [false, true]) {
    const again = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword, cacheMigration })
    try {
      const second = new Juno(again.app, again.win)
      await second.waitForSync()
      await second.sidebar.row('#eng').open()
      const message = second.topic.list.locator('[data-message-row]').last()
      await message.hover()
      const firstPaint = again.win.evaluate(() => new Promise<string | null>((resolve) => {
        const sample = () => {
          const picker = document.querySelector('[data-emoji-picker]')
          if (picker !== null) resolve(picker.querySelector('[role="group"] [data-emoji]')?.getAttribute('data-emoji') ?? null)
          else requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
      }))
      await message.getByRole('button', { name: 'More reactions' }).click()
      const frequent = again.win.getByRole('group', { name: 'Frequently used' }).locator('[data-emoji]').first()
      await expect(frequent).toHaveAttribute('data-emoji', 'rocket')
      expect(await firstPaint).toBe('rocket')
    } finally {
      await again.close()
    }
  }
})
