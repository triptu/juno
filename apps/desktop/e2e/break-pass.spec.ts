import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, launchApp, syncedTest, test } from './fixtures'

test.describe.configure({ timeout: 120_000 })

syncedTest('a deleted message cannot be edited from its already open menu', async ({ juno, fake }) => {
  await juno.sidebar.row('#eng').open()
  await juno.topic.send('Delete under menu')
  await juno.topic.expectSent('Delete under menu')
  const message = fake.messages('C0ENG').find((m) => m.text === 'Delete under menu')!
  await juno.chooseNextMenuItem('edit', { hold: true })
  await juno.topic.message('Delete under menu').click({ button: 'right' })
  fake.deleteMessage({ channel: 'C0ENG', ts: message.ts })
  await expect(juno.topic.message('Delete under menu')).toHaveCount(0)
  await juno.releaseMenu()
  await juno.topic.composer.fill('Still usable')
  await expect(juno.topic.list.getByRole('textbox', { name: 'Edit message' })).toHaveCount(0)
  await juno.topic.composer.press('Enter')
  await juno.topic.expectSent('Still usable')
})

syncedTest('deleting the source of a Slack quote keeps the written reply', async ({ juno, fake }) => {
  await juno.sidebar.row('#eng').open()
  const message = fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: 'Keep this quote' })
  const row = juno.topic.message('Keep this quote')
  await expect(row).toBeVisible()
  await row.hover()
  await row.getByRole('button', { name: 'Quote' }).click()
  await expect(juno.topic.composer).toHaveValue('> Keep this quote\n')
  fake.deleteMessage({ channel: 'C0ENG', ts: message.ts })
  await expect(row).toHaveCount(0)
  await expect(juno.topic.composer).toHaveValue('> Keep this quote\n')
  await juno.topic.composer.press('Enter')
  await expect.poll(() => fake.messages('C0ENG').some((m) => m.text?.includes('Keep this quote'))).toBe(true)
})

syncedTest('fast Enter presses send the draft once while the post waits', async ({ juno, fake }) => {
  await juno.sidebar.row('#eng').open()
  fake.holdNext({ method: 'chat.postMessage', before: true })
  await juno.topic.composer.fill('Only one copy')
  await juno.topic.composer.press('Enter')
  await juno.topic.composer.press('Enter')
  await juno.topic.composer.press('Enter')
  await expect(juno.topic.composer).toHaveValue('')
  fake.release()
  await juno.topic.expectSent('Only one copy')
  await juno.topic.send('After the burst')
  await juno.topic.expectSent('After the burst')
  expect(fake.messages('C0ENG').filter((m) => m.text === 'Only one copy')).toHaveLength(1)
})

syncedTest('long RTL and zero-width text leaves the composer usable', async ({ juno, fake }) => {
  await juno.sidebar.row('#eng').open()
  const text = 'مرحبا\u200b עולם '.repeat(700) + 'End of long message'
  fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text })
  await expect(juno.topic.message('End of long message')).toBeVisible()
  await juno.topic.send('Reply after long text')
  await juno.topic.expectSent('Reply after long text')
  expect(await juno.win.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('a malformed launch.json still opens a usable window', async ({ running, userData }) => {
  await running.close()
  await writeFile(join(userData, 'launch.json'), '{"theme":')
  const again = await launchApp(userData)
  try {
    await expect(again.win.getByRole('button', { name: 'Sign in to Slack' })).toBeVisible()
    await again.win.getByRole('radio', { name: 'Dark' }).click()
    await expect(again.win.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true')
  } finally {
    await again.close()
  }
})


test('a deleted sender and a live rename keep their messages readable', async ({ juno, fake }) => {
  const old = fake.workspace.users.get('U0MAYA')!
  fake.workspace.users.set(old.id, { ...old, deleted: true })
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row('#eng').open()
  fake.injectMessage({ channel: 'C0ENG', user: old.id, text: 'A former teammate wrote this' })
  const row = juno.topic.message('A former teammate wrote this')
  await expect(row).toBeVisible()
  const renamed = { ...old, deleted: true, real_name: 'Former teammate', profile: { ...old.profile, display_name: 'Former teammate', real_name: 'Former teammate' } }
  fake.workspace.users.set(old.id, renamed)
  fake.emitFrame({ type: 'user_change', user: renamed })
  await expect(row).toContainText('Former teammate')
  await juno.topic.send('Reply to the old message')
  await juno.topic.expectSent('Reply to the old message')
})

syncedTest('repeated window minimize and restore keeps the draft', async ({ juno, app }) => {
  await juno.sidebar.row('#eng').open()
  await juno.topic.composer.fill('Draft through window changes')
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]!
    for (let i = 0; i < 5; i++) {
      window.minimize()
      window.restore()
    }
    window.show()
    window.focus()
  })
  await expect(juno.topic.composer).toHaveValue('Draft through window changes')
  await juno.topic.composer.press('Enter')
  await juno.topic.expectSent('Draft through window changes')
})
