import type { FakeSlack } from '@juno/fake-slack'
import { expect, test } from './fixtures'
import type { Juno } from './driver/juno'

test.use({ synced: true })

test.describe.configure({ timeout: 120_000 })

async function setup(juno: Juno, fake: FakeSlack) {
  await juno.sidebar.row('#eng').open()
  const message = fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: 'Reaction delivery target' })
  const row = juno.topic.message('Reaction delivery target')
  await expect(row).toBeVisible()
  const react = async () => (await juno.messageMenu.openOnRow(row)).react('eyes')
  const sent = () => fake.messages('C0ENG').find((m) => m.ts === message.ts)?.reactions?.some((r) => r.name === 'eyes') === true
  return { row, react, sent, ts: message.ts }
}

test('reaction stops after five failures, toasts once, and Retry starts a new attempt', async ({ juno, fake }) => {
  const target = await setup(juno, fake)
  fake.forceError({ method: 'reactions.add', error: 'internal_error', times: 5 })
  await target.react()
  await expect(target.row.locator('[data-reaction-issue="waiting"]')).toBeVisible({ timeout: 6000 })
  await expect(target.row.locator('[data-reaction-issue="failed"]')).toBeVisible({ timeout: 20_000 })
  await juno.expectToast('Reaction not sent')
  expect(fake.calls.filter((c) => c.method === 'reactions.add')).toHaveLength(5)
  await expect(target.row.getByRole('button', { name: '1 👀, including you' })).toHaveCount(0)
  await expect(juno.toast('Reaction not sent')).toHaveCount(0, { timeout: 6000 })
  await juno.sidebar.row('#product').open()
  await juno.sidebar.row('#eng').open()
  await expect(target.row.locator('[data-reaction-issue="failed"]')).toBeVisible()
  await expect(juno.toast('Reaction not sent')).toHaveCount(0)
  await target.row.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect.poll(target.sent).toBe(true)
  await expect(target.row.locator('[data-reaction-issue]')).toHaveCount(0)
  expect(fake.calls.filter((c) => c.method === 'reactions.add')).toHaveLength(6)
})

test.describe('custom workspace emoji', () => {
  test.use({ synced: false })

  test('workspace emoji are searchable by name and alias, react by name and show their image', async ({ juno, fake }) => {
    fake.addEmoji({ name: 'missing_image', url: 'alias:absent_target' })
    fake.addEmoji({ name: 'unavailable_image', url: `${fake.url}/no-such-emoji.png` })
    await juno.signIn()
    await juno.waitForSync()
    const target = await setup(juno, fake)
    const open = async () => {
      const menu = await juno.messageMenu.openOnRow(target.row)
      await menu.more.click()
      return menu.root.locator('[data-emoji-picker]')
    }
    let picker = await open()
    const workspace = picker.getByRole('group', { name: 'Workspace', exact: true })
    await workspace.evaluate((node) => node.scrollIntoView({ block: 'start' }))
    await expect(workspace.locator('[data-emoji="juno_wave"]')).toBeVisible()
    await expect(picker.locator('[data-emoji="hello_juno"]')).toHaveCount(0)
    await picker.getByRole('textbox', { name: 'Search emoji' }).fill('unavailable_image')
    const unavailable = picker.locator('[data-emoji="unavailable_image"]')
    await expect(unavailable.locator('[data-emoji-placeholder]')).toBeVisible()
    await expect(unavailable).toHaveAccessibleName(':unavailable_image:')
    await picker.getByRole('textbox', { name: 'Search emoji' }).fill('missing_image')
    await expect(picker.getByText('No match.', { exact: true })).toBeVisible()
    await picker.getByRole('textbox', { name: 'Search emoji' }).fill('')
    await picker.getByRole('textbox', { name: 'Search emoji' }).fill('juno_wave')
    const image = picker.locator('[data-emoji="juno_wave"] img')
    await expect(image).toBeVisible()
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)
    await picker.getByRole('textbox', { name: 'Search emoji' }).fill('juno_wave')
    await expect(picker.locator('[data-emoji]')).toHaveCount(1)
    await picker.getByRole('textbox', { name: 'Search emoji' }).fill('hello_juno')
    await expect(picker.locator('[data-emoji]')).toHaveCount(1)
    await picker.getByRole('button', { name: ':juno_wave:', exact: true }).click()
    await expect.poll(() => fake.calls.some((call) => call.method === 'reactions.add' && call.args['name'] === 'juno_wave' && call.args['timestamp'] === target.ts && call.ok)).toBe(true)
    const chip = target.row.getByRole('button', { name: /1.*juno_wave.*including you/ })
    await expect(chip.locator('img')).toBeVisible()
    await expect.poll(() => chip.locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)
    // Now frequently used: in the menu's grid as its image, and first in the picker it turns into.
    const menu = await juno.messageMenu.openOnRow(target.row)
    await expect(menu.cell('juno_wave').locator('img')).toBeVisible()
    await expect(menu.cell('juno_wave')).toHaveAttribute('aria-pressed', 'true')
    await menu.more.click()
    picker = menu.root.locator('[data-emoji-picker]')
    await expect(picker.getByRole('heading', { name: 'Frequently used', exact: true })).toBeVisible()
    await expect(picker.locator('[data-emoji="juno_wave"]').first()).toBeVisible()
  })

})
