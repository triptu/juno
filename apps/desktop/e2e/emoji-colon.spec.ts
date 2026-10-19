import { expect, syncedTest, test } from './fixtures'
import { test as agentTest } from './juno-agent/chat'

const POSTGRES = 'Draft plan is in the doc'
const postedText = (fake: { readonly calls: ReadonlyArray<{ readonly method: string; readonly args: Record<string, unknown> }> }) =>
  fake.calls.filter((call) => call.method === 'chat.postMessage').map((call) => String(call.args['text']))

// Which emoji match and in what order, and that a colon inside a word starts no list, are domain rules
// (packages/domain/test/composer-emoji.test.ts). Home's Tab pick is in mentions.spec.ts.
syncedTest('colon suggestions insert Unicode in a reply and send it to Slack; in Main, Esc keeps the colon text and a closing colon converts it', async ({ juno, fake }) => {
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
})

test('workspace emoji and aliases show images and send shortcodes', async ({ juno, fake }) => {
  fake.workspace.emoji.set('juno_wave', { name: 'juno_wave', value: `${fake.url}/avatars/U0MAYA.svg` })
  fake.workspace.emoji.set('juno_hello', { name: 'juno_hello', value: 'alias:juno_wave', alias: 'juno_wave', is_alias: true })
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row(POSTGRES).open()
  const { topic } = juno
  await topic.composer.pressSequentially(':juno_he')
  const option = topic.suggestions.getByRole('option', { name: ':juno_hello:', exact: true })
  await expect(option.locator('img')).toBeVisible()
  await topic.composer.press('Tab')
  await expect(topic.composer).toHaveValue(':juno_hello: ')
  await topic.composer.press('Enter')
  await expect.poll(() => postedText(fake).at(-1)).toBe(':juno_hello:')
})

agentTest('the Juno panel composer suggests emoji too', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row(POSTGRES).open()
  await juno.tabs.menu('juno')
  const field = juno.win.locator('[data-juno-composer="panel"] textarea')
  await expect(field).toBeFocused()
  await field.pressSequentially(':smi')
  await expect(juno.win.getByRole('listbox', { name: 'Emoji' })).toBeVisible()
  await field.press('Tab')
  await expect(field).toHaveValue('😄 ')
})
