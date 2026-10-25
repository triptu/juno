import { expect, syncedTest, test } from './fixtures'
import { test as agentTest } from './juno-agent/chat'

const POSTGRES = 'Draft plan is in the doc'
const postedText = (fake: { readonly calls: ReadonlyArray<{ readonly method: string; readonly args: Record<string, unknown> }> }) =>
  fake.calls.filter((call) => call.method === 'chat.postMessage').map((call) => String(call.args['text']))

// Picks insert through `execCommand`, which the DOM lane does not have, so these stay in the browser.
// Which emoji match and in what order, and that a colon inside a word starts no list, are domain rules
// (packages/domain/test/composer-emoji.test.ts). Home's Tab pick is in mentions.spec.ts.
syncedTest('colon suggestions insert Unicode in a reply and send it to Slack; in Main, Esc keeps the colon text and a closing colon converts it; :thumbs and the edit field', async ({ juno, fake }) => {
  await juno.sidebar.row(POSTGRES).open()
  const { topic } = juno
  await topic.composer.pressSequentially('Looking good :smi')
  await expect(topic.suggestions.getByRole('option', { name: ':smile:', exact: true })).toBeVisible()
  await topic.composer.press('ArrowDown')
  await topic.composer.press('ArrowUp')
  await topic.composer.press('Enter')
  await expect(topic.composer).toHaveValue('Looking good 😄 ')
  await topic.composer.press('Enter')
  await expect.poll(() => postedText(fake).at(-1)).toBe('Looking good 😄')

  await juno.sidebar.row('#eng').open()
  await topic.expectTitle('Main')
  await topic.composer.pressSequentially(':smi')
  await expect(topic.suggestions).toBeVisible()
  await topic.composer.press('Escape')
  await expect(topic.suggestions).toHaveCount(0)
  await expect(topic.composer).toHaveValue(':smi')
  await topic.composer.pressSequentially('le:')
  await expect(topic.composer).toHaveValue('😄')
  await topic.composer.press('Enter')
  await expect.poll(() => postedText(fake).at(-1)).toBe('😄')

  await test.step(':thumbs offers 👍 first, before any recent use', async () => {
    await juno.sidebar.row(POSTGRES).open()
    await juno.topic.composer.pressSequentially(':thumbs')
    await expect(juno.topic.suggestions.locator('[role="option"]').first()).toContainText(':thumbsup:')
    await juno.topic.composer.press('Enter')
    await expect(juno.topic.composer).toHaveValue('👍 ')
  })

  await test.step('the inline edit field suggests emoji, and Esc there closes the list, not the edit', async () => {
    await juno.sidebar.row('#eng').open()
    await juno.topic.send('Edit with emoji')
    await juno.topic.expectSent('Edit with emoji')
    await juno.topic.chooseInMessageMenu('Edit with emoji', 'edit')
    const edit = juno.topic.list.getByRole('textbox', { name: 'Edit message' })
    await expect(edit).toBeFocused()
    await edit.pressSequentially(' :tad')
    const list = juno.win.getByRole('listbox', { name: 'Emoji' })
    await expect(list).toBeVisible()
    await expect(list).toBeInViewport({ ratio: 1 })
    await edit.press('Escape')
    await expect(list).toHaveCount(0)
    await expect(edit).toBeVisible()
    await expect(edit).toHaveValue('Edit with emoji :tad')
    // As in the composer, the list stays closed for that word; written again, it opens.
    for (let i = 0; i < 4; i++) await edit.press('Backspace')
    await edit.pressSequentially(':tada')
    await expect(list).toBeVisible()
    await edit.press('Enter')
    await expect(edit).toHaveValue('Edit with emoji 🎉 ')
    await edit.press('Enter')
    await expect.poll(() => fake.messages('C0ENG').some((m) => m.text === 'Edit with emoji 🎉')).toBe(true)
  })
})

// Workspace emoji are set before sign-in, so this test signs in itself.
agentTest('workspace emoji and aliases show images and send shortcodes, and the Juno panel composer suggests emoji too', async ({ juno, fake }) => {
  fake.workspace.emoji.set('juno_wave', { name: 'juno_wave', value: `${fake.url}/avatars/U0MAYA.svg` })
  fake.workspace.emoji.set('juno_hello', { name: 'juno_hello', value: 'alias:juno_wave', alias: 'juno_wave', is_alias: true })
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row(POSTGRES).open()
  const { topic } = juno

  await agentTest.step('a workspace alias shows its image and sends the shortcode it points to', async () => {
    await topic.composer.pressSequentially(':juno_hello')
    const option = topic.suggestions.getByRole('option', { name: ':juno_hello:', exact: true })
    await expect(option.locator('img')).toBeVisible()
    await topic.composer.press('Tab')
    await expect(topic.composer).toHaveValue(':juno_wave: ')
    await topic.composer.press('Enter')
    await expect.poll(() => postedText(fake).at(-1)).toBe(':juno_wave:')
  })

  await agentTest.step('the Juno panel composer suggests emoji', async () => {
    await juno.tabs.menu('juno')
    const field = juno.win.locator('[data-juno-composer="panel"] textarea')
    await expect(field).toBeFocused()
    await field.pressSequentially(':smi')
    await expect(juno.win.getByRole('listbox', { name: 'Emoji' })).toBeVisible()
    await field.press('Tab')
    await expect(field).toHaveValue('😄 ')
  })
})
