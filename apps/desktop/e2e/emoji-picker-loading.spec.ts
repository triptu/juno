import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { expect, test } from './fixtures'
import { holdWorkspaceEmoji } from './emojiDelay'

test('cold picker paints Frequently used complete and keeps its first cell still', async ({ juno, fake, relaunch, userData }) => {
  test.setTimeout(120_000)
  // The gate below holds the workspace emoji, so a few hundred stand for a large workspace; perf.spec.ts times 20,000.
  for (let i = 0; i < 300; i++) fake.addEmoji({ name: `cold_${i}`, url: `${fake.url}/emoji/juno_wave.svg?emoji=${i}` })
  await juno.signIn()
  await juno.waitForSync()
  const second = await relaunch({ whileClosed: () => {
  const db = new DatabaseSync(join(userData, 'workspaces', fake.teamId, 'user.db'))
  db.prepare('INSERT INTO prefs (key, value_json) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json').run('quickReactions', JSON.stringify([{ name: 'hello_juno', unicode: ':hello_juno:', url: `${fake.url}/emoji/juno_wave.svg` }, { name: '+1', unicode: '👍' }]))
  db.close()
  } })
    await second.waitForSync()
    await holdWorkspaceEmoji(second.win)
    await second.sidebar.row('#eng').open()
    const row = second.topic.list.locator('[data-message-row]').last()
    const menu = await second.messageMenu.openOnRow(row)
    // Sampled once the menu has turned into the picker: during the morph every cell moves with it.
    const frames = second.win.evaluate(() => new Promise<Array<{ names: Array<string | null>; top: number }>>((resolve) => {
      const result: Array<{ names: Array<string | null>; top: number }> = []
      let settledFrames = 0
      const tick = () => {
        const group = document.querySelector('[data-emoji-picker] [role="group"]')
        const cell = group?.querySelector('[data-emoji]')
        // The material layer is scaled while the menu grows and has no transform once the picker is in place.
        const surface = document.querySelector('[data-context-menu][data-morphed]')?.firstElementChild
        const moving = surface == null || getComputedStyle(surface).transform !== 'none'
        if (cell !== undefined && cell !== null && !moving) result.push({ names: Array.from(group!.querySelectorAll('[data-emoji]'), (node) => node.getAttribute('data-emoji')), top: cell.getBoundingClientRect().top })
        const resolved = cell?.getAttribute('data-emoji') === 'juno_wave' && !moving
        settledFrames = resolved ? settledFrames + 1 : 0
        if (settledFrames === 3) resolve(result)
        else requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }))
    await menu.more.click()
    const picker = second.win.locator('[data-emoji-picker]')
    await expect.poll(() => second.win.evaluate(() => window.emojiGate.count())).toBeGreaterThan(0)
    const recent = picker.getByRole('group', { name: 'Frequently used' })
    const pending = recent.locator('[data-emoji="hello_juno"]')
    await expect(pending.locator('[data-emoji-placeholder]')).toBeVisible()
    await picker.getByRole('textbox').press('ArrowDown')
    await expect(pending).toBeFocused()
    await second.win.evaluate(() => window.emojiGate.release())
    const resolved = recent.locator('[data-emoji="juno_wave"]')
    await expect(resolved).toBeFocused()
    await expect.poll(() => resolved.locator('img').evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    const seen = await frames
    expect(seen.length).toBeGreaterThan(0)
    // The custom emoji's cell is there from the first sampled frame, under its alias or its real name.
    expect(seen[0]!.names.some((name) => name === 'hello_juno' || name === 'juno_wave')).toBe(true)
    expect(new Set(seen.map((frame) => frame.names.length)).size).toBe(1)
    expect(new Set(seen.map((frame) => frame.top)).size).toBe(1)
})


test('standard emoji open while the workspace subscription is delayed', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  await holdWorkspaceEmoji(juno.win)
  await juno.openSettings('Appearance')
  await juno.settings.root.getByRole('button', { name: 'Add reaction' }).click()
  await expect.poll(() => juno.win.evaluate(() => window.emojiGate.count())).toBeGreaterThan(0)
  const picker = juno.win.getByRole('dialog', { name: 'Emoji' })
  await expect(picker.getByRole('textbox', { name: 'Search emoji' })).toBeFocused()
  await expect(picker.getByRole('group', { name: 'Smileys & emotion' }).locator('[data-emoji]').first()).toBeVisible()
  await expect(picker.getByRole('group', { name: 'Workspace', exact: true })).toHaveCount(0)
  await juno.win.evaluate(() => window.emojiGate.release())
  await expect(picker.getByRole('group', { name: 'Workspace', exact: true })).toHaveCount(1)
})
