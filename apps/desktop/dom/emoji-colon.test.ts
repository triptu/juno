// Colon emoji suggestions in the composers (spec section 8): picked with the
// keyboard they insert Unicode, Esc keeps the colon text, a closing colon
// converts it, the edit field suggests too, workspace emoji and aliases send
// their shortcodes, and the Juno panel's composer suggests emoji. Which emoji
// match and in what order are domain rules
// (packages/domain/test/composer-emoji.test.ts). Where the edit field's list
// sits is in the browser lane (`e2e/emoji-colon.spec.ts`).
import { startFakeOpenRouter } from '@juno/agent-testing/openrouter'
import type { FakeSlack } from '@juno/fake-slack'
import { answer } from '../e2e/juno-agent/model'
import { agentReady } from './driver/agent'
import { expect } from './expect'
import { domTest } from './test'

const POSTGRES = 'Draft plan is in the doc'
const postedText = (fake: FakeSlack) => fake.calls.filter((call) => call.method === 'chat.postMessage').map((call) => String(call.args['text']))

domTest('colon suggestions insert Unicode in a reply and send it to Slack; in Main, Esc keeps the colon text and a closing colon converts it; :thumbs and the edit field', async ({ juno, fake, step }) => {
  await juno.sidebar.row(POSTGRES).open()
  const { topic } = juno
  await topic.expectTitle(POSTGRES)
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

  await step(':thumbs offers 👍 first, before any recent use', async () => {
    await juno.sidebar.row(POSTGRES).open()
    await juno.topic.expectTitle(POSTGRES)
    await juno.topic.composer.pressSequentially(':thumbs')
    await expect(juno.topic.suggestions.getByRole('option').first()).toHaveAccessibleName(':thumbsup:')
    await juno.topic.composer.press('Enter')
    await expect(juno.topic.composer).toHaveValue('👍 ')
  })

  await step('the inline edit field suggests emoji, and Esc there closes the list, not the edit', async () => {
    await juno.sidebar.row('#eng').open()
    await juno.topic.expectTitle('Main')
    await juno.topic.send('Edit with emoji')
    await juno.topic.expectSent('Edit with emoji')
    await juno.topic.chooseInMessageMenu('Edit with emoji', 'edit')
    const edit = juno.topic.list.getByRole('textbox', { name: 'Edit message' })
    await expect(edit).toBeFocused()
    await edit.pressSequentially(' :tad')
    const list = juno.win.getByRole('listbox', { name: 'Emoji' })
    await expect(list).toBeVisible()
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
domTest('workspace emoji and aliases show images and send shortcodes, and the Juno panel composer suggests emoji too', async ({ juno, fake, step }) => {
  fake.workspace.emoji.set('juno_wave', { name: 'juno_wave', value: `${fake.url}/avatars/U0MAYA.svg` })
  fake.workspace.emoji.set('juno_hello', { name: 'juno_hello', value: 'alias:juno_wave', alias: 'juno_wave', is_alias: true })
  await juno.signIn()
  await juno.waitForSync()
  await agentReady(juno)
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.expectTitle(POSTGRES)
  const { topic } = juno

  await step('a workspace alias shows its image and sends the shortcode it points to', async () => {
    await topic.composer.pressSequentially(':juno_hello')
    const option = topic.suggestions.getByRole('option', { name: ':juno_hello:', exact: true })
    // Its image shows once loaded, which needs a browser; the list's look with workspace images is the gallery's (Composer, Emoji).
    await expect(option.locator('img')).toHaveCount(1)
    await topic.composer.press('Tab')
    await expect(topic.composer).toHaveValue(':juno_wave: ')
    await topic.composer.press('Enter')
    await expect.poll(() => postedText(fake).at(-1)).toBe(':juno_wave:')
  })

  await step('the Juno panel composer suggests emoji', async () => {
    await juno.tabs.menu('juno')
    const field = juno.win.locator('[data-juno-composer="panel"] textarea')
    await expect(field).toBeFocused()
    await field.pressSequentially(':smi')
    await expect(juno.win.getByRole('listbox', { name: 'Emoji' })).toBeVisible()
    await field.press('Tab')
    await expect(field).toHaveValue('😄 ')
  })
}, { synced: false, model: () => startFakeOpenRouter({ answer }) })
