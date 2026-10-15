import { startFakeOpenRouter } from '@juno/agent-testing/openrouter'
import type { Juno } from '../driver/juno'
import { hooks } from '../fixtures'
import { answer, expect, JunoChatPane, test as base } from './chat'

const test = base.extend({
  // oxlint-disable-next-line no-empty-pattern
  model: async ({}, use) => {
    const model = await startFakeOpenRouter({ answer: (request) => {
      const match = /send to (m:C\w+) and (m:C\w+)/.exec(request.input)
      if (match && request.toolResult === undefined) return { toolCall: { name: 'send_message', arguments: { messages: [match[1], match[2]].map((topic) => ({ topic, text: 'A synthetic launch update' })) } } }
      return request.toolResult === undefined ? answer(request) : '<say>Ready for your click.</say>'
    } })
    await use(model)
    await model.close()
  },
})
test.describe.configure({ timeout: 120_000 })
async function open(juno: Juno) {
  await juno.signIn()
  await juno.waitForSync()
  await expect.poll(() => hooks(juno.app, 'agentState'), { timeout: 30_000 }).toBe('ready')
  await juno.win.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: /^Juno/ }).click()
  return JunoChatPane.tab(juno.win)
}

test('a clicked multi-send posts once per row and keeps one rejection failed', async ({ juno, slack, fake }) => {
  const chat = await open(juno)
  const channels = [slack.channel('eng'), slack.channel('product')]
  await chat.send(`send to m:${channels[0]} and m:${channels[1]}`)
  const card = chat.root.locator('[data-chat-card="sendMessage"]')
  await expect(card).toHaveAttribute('data-card-status', 'open')
  expect(channels.flatMap((channel) => fake.messages(channel)).filter((m) => m.text === 'A synthetic launch update')).toHaveLength(0)
  fake.forceError({ method: 'chat.postMessage', error: 'channel_not_found', times: 1 })
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(card).toContainText('Sent 1 of 2')
  await expect(card.locator('[data-send-row="failed"]')).toHaveCount(1)
  await expect(card.locator('[data-send-row="failed"]').getByRole('button')).toHaveCount(0)
  expect(channels.flatMap((channel) => fake.messages(channel)).filter((m) => m.text === 'A synthetic launch update')).toHaveLength(1)
})

test('offline input waits for the socket and makes one model request', async ({ juno, fake, model }) => {
  const chat = await open(juno)
  fake.goOffline()
  await expect(chat.root.locator('[data-banner="offline"]')).toBeVisible({ timeout: 30_000 })
  const before = model.inputs().length
  await chat.send('Hold this until online')
  await expect(chat.ownerBubble('Hold this until online')).toContainText('Waiting for network')
  expect(model.inputs()).toHaveLength(before)
  fake.goOnline()
  await chat.expectJuno('You said: Hold this until online')
  expect(model.inputs()).toHaveLength(before + 1)
})

test('selected words can be remembered, undone and removed without the optimistic bubble returning', async ({ juno }) => {
  const chat = await open(juno)
  const text = 'My notes: café on Tuesday. Ask before changing it.'
  await chat.send(text)
  await chat.expectJuno(`You said: ${text}`)
  const remember = async () => {
    await chat.ownerBubble(text).locator('p').evaluate((node) => {
      const content = node.firstChild!
      const start = content.textContent!.indexOf('café')
      const range = document.createRange()
      range.setStart(content, start)
      range.setEnd(content, start + 'café on Tuesday'.length)
      const selection = document.getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
    })
    await juno.chooseNextMenuItem('remember')
    await chat.ownerBubble(text).locator('p').dispatchEvent('contextmenu')
  }
  await remember()
  const note = chat.root.locator('[data-chat-note="remembered"]')
  await expect(note).toContainText('Remembered')
  await note.getByRole('button', { name: 'Undo' }).click()
  await expect(note).toHaveCount(0)
  await remember()
  await expect(note).toContainText('Remembered')
  await juno.chooseNextMenuItem('remove')
  await chat.ownerBubble(text).locator('p').dispatchEvent('contextmenu')
  const sheet = juno.win.getByRole('dialog', { name: 'Remove from Juno' })
  await sheet.getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(sheet).toHaveCount(0)
  await expect(chat.root.locator('[data-chat-note="removed"]')).toHaveText('Removed')
  await expect(chat.ownerBubble(text)).toHaveCount(0)
  await expect(note).toHaveCount(0)
})
