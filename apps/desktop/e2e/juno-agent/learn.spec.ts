// Juno learns how the owner works (SPEC 13.6, 13.8), in the app against the fake Slack and a fake
// OpenRouter: the proactive ask on Home, Start, the background pass over the owner's own Slack
// messages, the memory page with each note's source, the outline in the next chat's request, and
// Undo on a later update.
import type { OpenRouterRequest, ToolCallAnswer } from '@juno/agent-testing/openrouter'
import { openChat, openPage, ready } from './agent'
import { answer, expect, test as base } from './chat'
import { startScriptedModel, type ScriptedModel } from './model'

/** The pass's first message (`LEARN` in `memory-docs/learn.ts`). */
const PASS = 'Learn how the owner works'
const STYLE = 'Short messages, mostly lowercase, no sign-off'
const STYLE_EDITED = 'Short messages, mostly lowercase, signs off with a single initial'
const PEOPLE = 'Maya Chen: owns the Postgres 16 migration plan'
const UPDATE = 'I sign off with my initial now'

/**
 * The learning pass reads the owner's own messages, writes a style note and a people note, and
 * ends. In the chat, the update message changes the style note; anything else is echoed.
 */
function learnAnswer(request: OpenRouterRequest): string | ToolCallAnswer {
  if (request.input.startsWith(PASS)) {
    const result = request.toolResult
    if (result === undefined) return { toolCall: { name: 'slack_search', arguments: { query: 'from:me' } } }
    if (/^Added e\d+ in People/.test(result)) return 'Learned your style and one colleague.'
    if (/^Added e\d+ in Writing style/.test(result)) return { toolCall: { name: 'memory_write', arguments: { doc: 'people', text: PEOPLE, source: 'slack' } } }
    return { toolCall: { name: 'memory_write', arguments: { doc: 'style', text: STYLE, source: 'slack' } } }
  }
  if (request.toolResult !== undefined) return '<say>Done.</say>'
  if (request.input.includes(UPDATE)) return { toolCall: { name: 'memory_write', arguments: { entry: 'e1', text: STYLE_EDITED, source: 'owner' } } }
  return answer(request)
}

const test = base.extend<{ readonly model: ScriptedModel }>({
  // oxlint-disable-next-line no-empty-pattern
  model: async ({}, use) => {
    const model = await startScriptedModel({ answer: learnAnswer })
    await use(model)
    await model.close()
  },
})

test.describe.configure({ timeout: 180_000 })

test('Home offers to learn, the pass fills the memory page with sources, the next chat carries the outline, and Undo takes back an update', async ({ juno, model }) => {
  await ready(juno)

  // The ask is offered once the owner is set up; Home lists it when it next appears.
  const ask = juno.home.item('ask')
  await expect.poll(async () => {
    await juno.home.open()
    return ask.count()
  }, { timeout: 30_000 }).toBe(1)
  await expect(juno.home.title('ask')).toHaveText('Let Juno learn how you work')
  await expect(juno.home.meta('ask')).toHaveText('Reads your Slack messages · You can edit what it keeps')
  await ask.getByRole('button', { name: 'Start', exact: true }).click()

  // The pass runs in the background and never shows the typing bubble; the chat's ask says what it kept.
  const chat = await openChat(juno)
  const card = chat.root.locator('[data-chat-ask="learn"]')
  await expect(card).toHaveAttribute('data-ask-status', 'done', { timeout: 30_000 })
  await expect(card.locator('[data-ask-after]')).toContainText('Done · Kept 2 notes')
  await expect(chat.root.locator('[data-chat-status]')).toHaveCount(0)
  const passNote = chat.root.locator('[data-chat-note="memoryUpdated"]')
  await expect(passNote).toContainText('Updated memory · People, Writing style')
  expect(model.requests.filter((request) => request.input.startsWith(PASS)).map((request) => request.toolResult === undefined)).toEqual([true, false, false, false])

  // Each note with where it came from, marked as written after reading Slack.
  let page = await openPage(juno, 'What Juno remembers')
  const style = page.locator('[data-memory-doc="style"] [data-memory-entry]')
  await expect(style).toHaveCount(1)
  await expect(style).toContainText(STYLE)
  await expect(style).toHaveAttribute('data-memory-source', 'slack')
  await expect(style).toContainText('Slack · ')
  await expect(style).toContainText('Written after reading outside content')
  await expect(page.locator('[data-memory-doc="people"] [data-memory-entry]')).toContainText(PEOPLE)
  await expect(page.locator('[data-memory-change="add"]')).toHaveCount(2)

  // The next chat's request carries the outline, between the summary and the recent messages.
  await openChat(juno)
  await chat.send('what is on today?')
  await chat.expectJuno('You said: what is on today?')
  const asked = model.requests.filter((request) => !request.compaction && request.input.includes('what is on today?')).at(-1)!
  expect(asked.memory).toMatch(/<\/memory>\n<about-owner rev="\d+">/)
  expect(asked.memory).toContain(`Writing style: ${STYLE}`)
  expect(asked.memory).toContain(`People: ${PEOPLE}`)

  // A chat run updates a note: its note offers Undo, which puts the earlier words back.
  await chat.send(UPDATE)
  await chat.expectJuno('Done.')
  const updated = chat.root.locator('[data-chat-note="memoryUpdated"]').filter({ hasText: 'Writing style' }).last()
  await expect(updated).toHaveText('Updated memory · Writing style · Undo')
  page = await openPage(juno, 'What Juno remembers')
  await expect(style).toContainText(STYLE_EDITED)
  await openChat(juno)
  await updated.getByRole('button', { name: 'Undo' }).click()
  // The update's note goes once nothing it changed is left; the pass's note stays.
  await expect(chat.root.locator('[data-chat-note="memoryUpdated"]')).toHaveCount(1)
  page = await openPage(juno, 'What Juno remembers')
  await expect(style).toContainText(STYLE)
  await expect(style).not.toContainText(STYLE_EDITED)
  await expect(page.locator('[data-memory-change="update"][data-memory-undone]')).toHaveCount(1)
})
