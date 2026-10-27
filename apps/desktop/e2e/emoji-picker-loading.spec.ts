import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import type { FakeSlack } from '@juno/fake-slack'
import type { Juno } from './driver/juno'
import { expect, test } from './fixtures'
import { holdWorkspaceEmoji } from './emojiDelay'

// Starts signed in and synced (README, "Synced start"); the relaunch reads the emoji the fake gains after it.
test.use({ synced: true })

test('a cold picker paints Frequently used complete and keeps its first cell still; workspace emoji are found by name and alias, react by name and show their image', async ({ fake, relaunch, userData }) => {
  // The gate below holds the workspace emoji, so a few hundred stand for a large workspace; perf.spec.ts times 20,000.
  for (let i = 0; i < 300; i++) fake.addEmoji({ name: `cold_${i}`, url: `${fake.url}/emoji/juno_wave.svg?emoji=${i}` })
  // An alias of an emoji that does not exist, and one whose image does not load.
  fake.addEmoji({ name: 'missing_image', url: 'alias:absent_target' })
  fake.addEmoji({ name: 'unavailable_image', url: `${fake.url}/no-such-emoji.png` })
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
    const recent = picker.locator('[data-emoji-section][aria-label="Frequently used"]')
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
    await second.win.keyboard.press('Escape')
    await expect(second.win.locator('[data-emoji-picker]')).toHaveCount(0)
    await test.step('workspace emoji are searchable by name and alias, react by name and show their image', () => workspaceEmoji(second, fake))
})

async function workspaceEmoji(juno: Juno, fake: FakeSlack): Promise<void> {
  const message = fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: 'Reaction delivery target' })
  const row = juno.topic.message('Reaction delivery target')
  await expect(row).toBeVisible()
  const open = async () => {
    const menu = await juno.messageMenu.openOnRow(row)
    await menu.more.click()
    return menu.root.locator('[data-emoji-picker]')
  }
  let picker = await open()
  await picker.getByRole('textbox', { name: 'Search emoji' }).fill('unavailable_image')
  const unavailable = picker.locator('[data-emoji="unavailable_image"]')
  await expect(unavailable.locator('[data-emoji-placeholder]')).toBeVisible()
  await picker.getByRole('textbox', { name: 'Search emoji' }).fill('missing_image')
  await expect(picker.getByText('No match.', { exact: true })).toBeVisible()
  await picker.getByRole('textbox', { name: 'Search emoji' }).fill('')
  await picker.getByRole('textbox', { name: 'Search emoji' }).fill('juno_wave')
  const image = picker.locator('[data-emoji="juno_wave"] img')
  await expect(image).toBeVisible()
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)
  await picker.getByRole('textbox', { name: 'Search emoji' }).fill('juno_wave')
  await expect(picker.locator('[data-emoji]')).toHaveCount(1)
  // The alias finds the emoji it names, not a cell of its own.
  await picker.getByRole('textbox', { name: 'Search emoji' }).fill('hello_juno')
  await expect(picker.locator('[data-emoji]')).toHaveCount(1)
  await expect(picker.locator('[data-emoji="juno_wave"]')).toHaveCount(1)
  await picker.getByRole('button', { name: ':juno_wave:', exact: true }).click()
  await expect.poll(() => fake.calls.some((call) => call.method === 'reactions.add' && call.args['name'] === 'juno_wave' && call.args['timestamp'] === message.ts && call.ok)).toBe(true)
  const chip = row.locator('[data-reaction="juno_wave"][aria-label="1 :juno_wave:, including you"]')
  await expect(chip.locator('img')).toBeVisible()
  await expect.poll(() => chip.locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)
  // Now frequently used: in the menu's grid as its image, and first in the picker it turns into.
  const menu = await juno.messageMenu.openOnRow(row)
  await expect(menu.cell('juno_wave').locator('img')).toBeVisible()
  await expect(menu.cell('juno_wave')).toHaveAttribute('aria-pressed', 'true')
  await menu.more.click()
  picker = menu.root.locator('[data-emoji-picker]')
  await expect(picker.getByRole('heading', { name: 'Frequently used', exact: true })).toBeVisible()
  await expect(picker.locator('[data-emoji="juno_wave"]').first()).toBeVisible()
}
