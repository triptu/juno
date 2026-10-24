// What Juno keeps of the chat, in the app against the fake Slack and a fake OpenRouter:
// a pin from the owner's words, edited and then lost with its source, the chat's memory
// line masked by the removal and rebuilt (plan v3 §16 flow 10), and the owner's own
// Remember, Undo and Remove from the chat.
import type { OpenRouterRequest, ToolCallAnswer } from '@juno/agent-testing/openrouter'
import type { Juno } from '../driver/juno'
import { card, openChat, openPage, readySynced as ready } from './agent'
import { answer, expect, type JunoChatPane, test as base } from './chat'
import { startScriptedModel, type ScriptedModel } from './model'

const FACT = 'the launch moves to Thursday'
const EDITED = 'the launch moves to Friday'
const ASKED = `remember that ${FACT}`
// Over the 512 bytes a memory line keeps as written, so its line needs the compaction model.
const FORGET = `forget that. ${'These are my notes from the planning call, kept here for the record. '.repeat(9)}`.trim()

const wordsOf = (request: OpenRouterRequest) => request.input.replace(/<[^>]*>/g, '').trim()

/**
 * "remember that <words>" calls `remember` with the words, and "forget that" proposes removing
 * the first message. Anything else is echoed.
 */
function memoryAnswer(request: OpenRouterRequest): string | ToolCallAnswer {
  if (request.toolResult !== undefined) return '<say>Done.</say>'
  const words = wordsOf(request)
  const quote = /^remember that (.+)$/.exec(words)?.[1]
  if (quote !== undefined) return { toolCall: { name: 'remember', arguments: { quote } } }
  if (words.startsWith('forget that')) return { toolCall: { name: 'remove_messages', arguments: { messages: ['n1'] } } }
  return answer(request)
}

const test = base.extend<{ readonly model: ScriptedModel }>({
  // oxlint-disable-next-line no-empty-pattern
  model: async ({}, use) => {
    const model = await startScriptedModel({ answer: memoryAnswer })
    await use(model)
    await model.close()
  },
})

test.use({ synced: true })

test.describe.configure({ timeout: 180_000 })

/** Whether the "Removed" note comes before the owner's bubble that holds `text`. */
const noteBefore = (chat: JunoChatPane, text: string) =>
  chat.root.evaluate((root, words) => {
    const note = root.querySelector('[data-chat-note="removed"]')
    const bubble = [...root.querySelectorAll('[data-chat-owner]')].find((el) => el.textContent?.includes(words))
    return note !== null && bubble !== undefined && (note.compareDocumentPosition(bubble) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
  }, text)

const pins = (juno: Juno) => juno.win.locator('main [data-pin]')
const memoryLines = (juno: Juno) => juno.win.locator('main [data-memory-line]')

test('a pin from the owner\'s words is edited, then goes with its source, whose memory line is masked and rebuilt', async ({ juno, model }) => {
  await ready(juno)
  let chat = await openChat(juno)
  await chat.send(ASKED)
  await chat.expectJuno('Done.')

  let page = await openPage(juno, 'What Juno remembers')
  await expect(pins(juno)).toHaveCount(1)
  await expect(pins(juno)).toContainText(FACT)
  await expect(pins(juno)).toContainText('From your message')
  await pins(juno).getByRole('button', { name: 'Edit' }).click()
  await page.getByRole('textbox', { name: 'Pin' }).fill(EDITED)
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(pins(juno)).toHaveAttribute('data-pin', 'pinned')
  await expect(pins(juno)).toContainText(EDITED)
  // An edit is the owner's own pin (plan v3 §4.4), and it keeps its source.
  await expect(pins(juno)).toContainText('Edited · ')

  chat = await openChat(juno)
  await chat.send(FORGET)
  const remove = card(chat, 'remove')
  await expect(remove).toHaveAttribute('data-card-status', 'open', { timeout: 15_000 })
  await expect(remove).toContainText(ASKED)

  // Each message has its own line once its run ends. The long one is summarised by the model.
  page = await openPage(juno, 'Memory of this chat')
  const asked = memoryLines(juno).filter({ hasText: ASKED })
  const forget = memoryLines(juno).filter({ hasText: 'These are my notes' })
  await expect(asked).toHaveCount(1, { timeout: 20_000 })
  await expect(forget).toContainText(/Summary of messages \d+–\d+: /, { timeout: 20_000 })
  const index = (filter: string) => memoryLines(juno).evaluateAll((rows, text) => rows.findIndex((row) => row.textContent?.includes(text)), filter)
  const askedLine = memoryLines(juno).nth(await index(ASKED))
  const forgetLine = memoryLines(juno).nth(await index('These are my notes'))
  const span = /Summary of messages (\d+)–/.exec((await forget.textContent()) ?? '')![1]
  // The long message read the removed one as context, so its line is rebuilt by the model too.
  // Holding that rebuild keeps the line masked until the test lets it through.
  const rebuild = model.hold(`compress messages ${span}–`)

  chat = await openChat(juno)
  await remove.getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(remove).toHaveAttribute('data-card-status', 'done')
  await expect(remove).toContainText('Removed 1 message')
  // Where the message was: before the message that asked for its removal, and it does not come back at the bottom.
  await expect(chat.root.locator('[data-chat-note="removed"]')).toHaveText('Removed')
  expect(await noteBefore(chat, 'forget that')).toBe(true)
  await expect(chat.ownerBubble(ASKED)).toHaveCount(0)

  page = await openPage(juno, 'What Juno remembers')
  await expect(page.getByText('Nothing pinned yet')).toBeVisible()
  await expect(pins(juno)).toHaveCount(0)

  page = await openPage(juno, 'Memory of this chat')
  await expect.poll(rebuild.arrived, { timeout: 20_000 }).toBe(true)
  await expect(forgetLine).toHaveAttribute('data-memory-line', 'masked')
  await expect(forgetLine).toContainText('being updated')
  await expect(page).not.toContainText(ASKED)

  rebuild.release()
  await expect(forgetLine).toHaveAttribute('data-memory-line', 'line', { timeout: 20_000 })
  await expect(forgetLine).toContainText(`Summary of messages ${span}–`)
  await expect(askedLine).toHaveAttribute('data-memory-line', 'line')
  await expect(page.locator('[data-memory-line="masked"]')).toHaveCount(0)
  await expect(page).not.toContainText(ASKED)
})

test('Remember shows "Remembered · Undo", and words selected in a message are remembered from its menu and removed with their pin', async ({ juno }) => {
  await ready(juno)
  let chat = await openChat(juno)
  await chat.send(ASKED)
  const note = chat.root.locator('[data-chat-note="remembered"]')
  await expect(note).toHaveText('Remembered · Undo', { timeout: 15_000 })
  await openPage(juno, 'What Juno remembers')
  await expect(pins(juno)).toContainText(FACT)
  chat = await openChat(juno)
  await note.getByRole('button', { name: 'Undo' }).click()
  await expect(note).toHaveCount(0)
  let page = await openPage(juno, 'What Juno remembers')
  await expect(page.getByText('Nothing pinned yet')).toBeVisible()

  chat = await openChat(juno)
  const message = `My notes: ${FACT}. Ask the owner before changing it.`
  await chat.send(message)
  await chat.expectJuno(`You said: ${message}`)
  const remember = async () => {
    await chat.ownerBubble(message).locator('p').evaluate((node, text) => {
      const content = node.firstChild
      if (content === null) throw new Error('No message text')
      const start = (content.textContent ?? '').indexOf(text)
      if (start < 0) throw new Error('No selected words')
      const range = document.createRange()
      range.setStart(content, start)
      range.setEnd(content, start + text.length)
      const selection = document.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    }, FACT)
    // The context-menu key: the menu opens at once, and Remember this takes the selected words.
    await chat.ownerBubble(message).locator('p').dispatchEvent('contextmenu')
    await juno.messageMenu.choose('remember')
    await expect(note).toContainText('Remembered')
  }
  await remember()
  await note.getByRole('button', { name: 'Undo' }).click()
  await expect(note).toHaveCount(0)
  await remember()
  await openPage(juno, 'What Juno remembers')
  await expect(pins(juno)).toContainText(FACT)
  await expect(pins(juno)).not.toContainText('Ask the owner')

  // Remove takes the message and its pin, and neither the bubble nor the note comes back.
  chat = await openChat(juno)
  await (await chat.menu(message, { owner: true })).choose('remove')
  const sheet = juno.win.getByRole('dialog', { name: 'Remove from Juno' })
  await sheet.getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(sheet).toHaveCount(0)
  await expect(chat.root.locator('[data-chat-note="removed"]')).toHaveText('Removed')
  await expect(chat.ownerBubble(message)).toHaveCount(0)
  await expect(note).toHaveCount(0)
  page = await openPage(juno, 'What Juno remembers')
  await expect(page.getByText('Nothing pinned yet')).toBeVisible()
})
