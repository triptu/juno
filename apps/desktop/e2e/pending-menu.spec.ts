import { expect, test } from './fixtures'

// Starts signed in and synced (README, "Synced start").
test.use({ synced: true })

test.describe.configure({ timeout: 120_000 })

test('Edit from a held menu follows a message that finishes sending', async ({ juno, fake }) => {
  await juno.sidebar.row('#eng').open()
  await juno.topic.expectTitle('Main')
  fake.holdNext({ method: 'chat.postMessage', before: true })
  await juno.topic.send('Menu during send')
  await expect(juno.topic.message('Menu during send')).toHaveAttribute('data-pending', 'sending')
  await juno.chooseNextMenuItem('edit', { hold: true })
  await juno.topic.message('Menu during send').click({ button: 'right' })
  fake.release()
  await juno.topic.expectSent('Menu during send')
  await juno.releaseMenu()
  const field = juno.topic.list.getByRole('textbox', { name: 'Edit message' })
  await expect(field).toHaveValue('Menu during send')
  await field.fill('Edited after send')
  await field.press('Enter')
  await expect.poll(() => fake.messages('C0ENG').filter((m) => m.text === 'Edited after send').length).toBe(1)
})
