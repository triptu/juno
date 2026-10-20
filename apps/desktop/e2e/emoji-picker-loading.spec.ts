import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { expect, launchApp, test } from './fixtures'
import { Juno } from './driver/juno'

test('cold picker paints Frequently used complete and keeps its first cell still', async ({ juno, fake, running, userData, slackApp }) => {
  test.setTimeout(120_000)
  for (let i = 0; i < 20_000; i++) fake.addEmoji({ name: `cold_${i}`, url: `${fake.url}/emoji/juno_wave.svg?emoji=${i}` })
  await juno.signIn()
  await juno.waitForSync()
  await running.close()
  const db = new DatabaseSync(join(userData, 'workspaces', fake.teamId, 'user.db'))
  db.prepare('INSERT INTO prefs (key, value_json) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json').run('quickReactions', JSON.stringify([{ name: 'hello_juno', unicode: ':hello_juno:', url: `${fake.url}/emoji/juno_wave.svg` }, { name: '+1', unicode: '👍' }]))
  db.close()
  const again = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword })
  try {
    const second = new Juno(again.app, again.win)
    await second.waitForSync()
    await second.sidebar.row('#eng').open()
    const row = second.topic.list.locator('[data-message-row]').last()
    await row.hover()
    const frames = again.win.evaluate(() => new Promise<Array<{ names: Array<string | null>; top: number }>>((resolve) => {
      const result: Array<{ names: Array<string | null>; top: number }> = []
      let remaining = 180
      const tick = () => {
        const group = document.querySelector('[data-emoji-picker] [role="group"]')
        const cell = group?.querySelector('[data-emoji]')
        if (cell !== undefined && cell !== null) result.push({ names: Array.from(group!.querySelectorAll('[data-emoji]'), (node) => node.getAttribute('data-emoji')), top: cell.getBoundingClientRect().top })
        if (--remaining === 0) resolve(result)
        else requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }))
    await row.getByRole('button', { name: 'More reactions' }).click()
    const picker = again.win.getByRole('dialog', { name: 'Emoji' })
    await expect(picker.getByRole('group', { name: 'Frequently used' }).locator('[data-emoji="juno_wave"]')).toBeVisible()
    const seen = await frames
    expect(seen.length).toBeGreaterThan(0)
    expect(seen[0]!.names).toContain('juno_wave')
    expect(new Set(seen.map((frame) => frame.top)).size).toBe(1)
  } finally {
    await again.close()
  }
})
