import { expect, test } from './fixtures'

// Starts signed in and synced (README, "Synced start"); Slack's use counts arrive as a pref change, as from another
// client, and the fake keeps them for the relaunches.
test.use({ synced: true })

test('frequently used emoji survive a restart and an update from their first picker paint', async ({ juno, fake, relaunch }) => {
  test.setTimeout(120_000)
  const used = JSON.stringify({
    eyes: 5, tada: 20, hello_juno: 30, '+1::skin-tone-3': 12, thumbsup: 10,
    missing_emoji: 100, deleted_custom: 90,
  })
  fake.workspace.prefs = { ...fake.workspace.prefs, emoji_use: used }
  fake.emitFrame({ type: 'pref_change', name: 'emoji_use', value: used })
  await juno.sidebar.row('#eng').open()
  const row = juno.topic.list.locator('[data-message-row]').last()
  const ts = await row.getAttribute('data-message-row')
  await (await juno.messageMenu.openOnRow(row)).more.click()
  const frequents = () => juno.win.locator('[data-emoji-section][aria-label="Frequently used"] [data-emoji]')
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
  await (await juno.messageMenu.openOnRow(row)).more.click()
  await expect.poll(() => frequents().evaluateAll((cells) => cells.map((cell) => cell.getAttribute('data-emoji')))).toEqual([
    'rocket', 'tada', 'eyes', '+1', 'white_check_mark',
  ])
  await search.press('Escape')

  // An update's relaunch migrates the cache, and is a restart too.
  for (const cacheMigration of [true]) {
    const second = await relaunch({ cacheMigration })
    await second.waitForSync()
    await second.sidebar.row('#eng').open()
    const message = second.topic.list.locator('[data-message-row]').last()
    const menu = await second.messageMenu.openOnRow(message)
    const firstPaint = second.win.evaluate(() => new Promise<string | null>((resolve) => {
      const sample = () => {
        const picker = document.querySelector('[data-emoji-picker]')
        if (picker !== null) resolve(picker.querySelector('[role="group"] [data-emoji]')?.getAttribute('data-emoji') ?? null)
        else requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    }))
    await menu.more.click()
    const frequent = second.win.locator('[data-emoji-section][aria-label="Frequently used"] [data-emoji]').first()
    await expect(frequent).toHaveAttribute('data-emoji', 'rocket')
    expect(await firstPaint).toBe('rocket')
  }
})
