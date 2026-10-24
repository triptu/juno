// @ and # in the Juno chat (SPEC 13.1): the topic composer's people and
// channel suggestions, the picks sent with the message so Juno reads each
// one's id, and the bubble showing the names as plain text.
import type { Juno } from '../driver/juno'
import { hooks } from '../fixtures'
import { expect, JunoChatPane, test } from './chat'

test.describe.configure({ timeout: 90_000 })

async function ready(juno: Juno): Promise<void> {
  await juno.signIn()
  await juno.waitForSync()
  await expect.poll(() => hooks(juno.surface, 'agentState'), { timeout: 15_000 }).toBe('ready')
}

test('the Juno tab picks a person with @ and a channel with #, and Juno reads their ids', async ({ juno, model }) => {
  await ready(juno)
  await juno.win.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: /^Juno/ }).click()
  const chat = JunoChatPane.tab(juno.win)
  await expect(chat.composer).toBeFocused()

  await chat.composer.pressSequentially('Ask @Ma')
  await expect(chat.suggestion('Maya')).toBeVisible()
  await expect(chat.composer).toHaveAttribute('aria-activedescendant', /.+/)
  await chat.composer.press('Enter')
  await expect(chat.suggestions).toHaveCount(0)
  await expect(chat.composer).toHaveValue('Ask @Maya ')
  await expect(chat.composerChips).toHaveText(['@Maya'])

  await chat.composer.pressSequentially('about #en')
  await expect(chat.suggestion('eng')).toBeVisible()
  await chat.composer.press('Tab')
  await expect(chat.composer).toHaveValue('Ask @Maya about #eng ')
  await expect(chat.composerChips).toHaveText(['@Maya', '#eng'])
  await expect(chat.composerChips.last()).toHaveAttribute('data-mark', 'channel')

  await chat.composer.press('Enter')
  await chat.expectOwner('Ask @Maya about #eng')
  await chat.expectJuno('You said: Ask @Maya about #eng')
  expect(model.inputs().at(-1)).toBe('<message id="n1"><person id="U0MAYA" name="Maya"/><channel id="C0ENG" name="#eng"/>Ask @Maya about #eng</message>')

  // The bubble shows the names as its own text: no links, no chips.
  const bubble = chat.ownerBubble('Ask @Maya about #eng')
  await expect(bubble.locator('p')).toHaveText('Ask @Maya about #eng')
  await expect(bubble.locator('a, [data-person], [data-channel], [data-mark]')).toHaveCount(0)
  await expect(chat.composerChips).toHaveCount(0)
})

test('a question for Juno written on Home carries its picks', async ({ juno, model }) => {
  await ready(juno)
  const { write } = juno
  await write.expectDestination('Juno')
  await write.composer.pressSequentially('What did @Ma')
  await expect(write.suggestion('Maya')).toBeVisible()
  await write.composer.press('Enter')
  await write.composer.pressSequentially('say?')
  await write.send()
  const chat = JunoChatPane.tab(juno.win)
  await chat.expectOwner('What did @Maya say?')
  await expect.poll(() => model.inputs().at(-1)).toBe('<message id="n1"><person id="U0MAYA" name="Maya"/>What did @Maya say?</message>')
})
