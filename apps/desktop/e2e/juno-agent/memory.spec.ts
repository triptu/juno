// What Juno keeps of the chat, in the app against the fake Slack and a fake OpenRouter:
// a pin from the owner's words, edited and then lost with its source, the chat's memory
// line masked by the removal and rebuilt (plan v3 §16 flow 10), and recall with a
// citation that scrolls (flow 9).
import type { OpenRouterRequest, ToolCallAnswer } from '@juno/agent-testing/openrouter'
import type { Juno } from '../driver/juno'
import { card, openChat, openPage, ready } from './agent'
import { answer, expect, type JunoChatPane, test as base } from './chat'
import { startScriptedModel, type ScriptedModel } from './model'

const FACT = 'the launch moves to Thursday'
const EDITED = 'the launch moves to Friday'
const ASKED = `remember that ${FACT}`
// Over the 512 bytes a memory line keeps as written, so its line needs the compaction model.
const FORGET = `forget that. ${'These are my notes from the planning call, kept here for the record. '.repeat(9)}`.trim()
const CONTRACT = 'note: the vendor contract renews on 3 March'

const wordsOf = (request: OpenRouterRequest) => request.input.replace(/<[^>]*>/g, '').trim()

/**
 * "remember that <words>" calls `remember` with the words, "forget that" proposes removing
 * the first message, a "note" gets no answer, and the contract question cites the note.
 * Anything else is echoed.
 */
function memoryAnswer(request: OpenRouterRequest): string | ToolCallAnswer {
  if (request.toolResult !== undefined) return '<say>Done.</say>'
  const words = wordsOf(request)
  const quote = /^remember that (.+)$/.exec(words)?.[1]
  if (quote !== undefined) return { toolCall: { name: 'remember', arguments: { quote } } }
  if (words.startsWith('forget that')) return { toolCall: { name: 'remove_messages', arguments: { messages: ['n1'] } } }
  if (words.startsWith('note')) return ''
  if (words === 'when does the vendor contract renew?') return '<say>It renews on <src m="n1">3 March</src>.</say>'
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
  // Where the message was: before the message that asked for its removal.
  await expect(chat.root.locator('[data-chat-note="removed"]')).toHaveText('Removed')
  expect(await noteBefore(chat, 'forget that')).toBe(true)

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

test('a message removed from a card does not come back at the bottom of the chat', async ({ juno }) => {
  await ready(juno)
  const chat = await openChat(juno)
  await chat.send(ASKED)
  await chat.expectJuno('Done.')
  await chat.send(FORGET)
  const remove = card(chat, 'remove')
  await remove.getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(remove).toContainText('Removed 1 message')
  await expect(chat.root.locator('[data-chat-note="removed"]')).toHaveText('Removed')
  await expect(chat.ownerBubble(ASKED)).toHaveCount(0)
})

test('Remember shows "Remembered · Undo" in the chat, and Undo drops the pin', async ({ juno }) => {
  await ready(juno)
  const chat = await openChat(juno)
  await chat.send(ASKED)
  const note = chat.root.locator('[data-chat-note="remembered"]')
  await expect(note).toHaveText('Remembered · Undo', { timeout: 15_000 })
  await openPage(juno, 'What Juno remembers')
  await expect(pins(juno)).toContainText(FACT)

  await openChat(juno)
  await note.getByRole('button', { name: 'Undo' }).click()
  await expect(note).toHaveCount(0)
  const page = await openPage(juno, 'What Juno remembers')
  await expect(page.getByText('Nothing pinned yet')).toBeVisible()
})

test('Remember this and Remove in an owner message\'s menu pin it and remove it with the pin', async ({ juno }) => {
  await ready(juno)
  let chat = await openChat(juno)
  const message = `My notes: ${FACT}. Ask the owner before changing it.`
  await chat.send(message)
  await chat.expectJuno(`You said: ${message}`)
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

  await juno.chooseNextMenuItem('remember')
  await chat.ownerBubble(FACT).click({ button: 'right' })
  await openPage(juno, 'What Juno remembers')
  await expect(pins(juno)).toContainText(FACT)
  await expect(pins(juno)).not.toContainText('Ask the owner')

  chat = await openChat(juno)
  await juno.chooseNextMenuItem('remove')
  await chat.ownerBubble(FACT).click({ button: 'right' })
  const sheet = juno.win.getByRole('dialog', { name: 'Remove from Juno' })
  await sheet.getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(sheet).toHaveCount(0)
  await expect(chat.ownerBubble(FACT)).toHaveCount(0)
  await expect(chat.root.locator('[data-chat-note="removed"]')).toHaveText('Removed')
  const page = await openPage(juno, 'What Juno remembers')
  await expect(page.getByText('Nothing pinned yet')).toBeVisible()
})

const NOTES = 5_001

test.fixme('recall over a long chat answers with a citation that scrolls to the message', async ({ juno }) => {
  // No recall tool exists and packages/agent/src/serve/chat.ts:468 builds only text and source inlines,
  // so no answer carries the `cite` that JunoBubble renders as [data-cite].
  await ready(juno)
  const chat = await openChat(juno)
  await chat.send(CONTRACT)
  for (let n = 2; n <= NOTES; n++) await chat.send(`note ${n}`)
  await chat.expectOwner(`note ${NOTES}`)
  await expect(chat.ownerBubble(CONTRACT)).not.toBeInViewport()

  await chat.send('when does the vendor contract renew?')
  await chat.expectJuno('It renews on 3 March.')
  const cite = chat.junoBubble('It renews on 3 March.').locator('[data-cite]')
  await expect(cite).toHaveText('3 March')
  await cite.click()
  await expect(chat.ownerBubble(CONTRACT)).toBeInViewport()
})
