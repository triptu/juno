import { startFakeOpenRouter } from '@juno/agent-testing/openrouter'
import type { Juno } from '../driver/juno'
import { hooks } from '../fixtures'
import { answer, expect, JunoChatPane, test as base } from './chat'

const test = base.extend({
  // oxlint-disable-next-line no-empty-pattern
  model: async ({}, use) => {
    const model = await startFakeOpenRouter({ answer: (request) => {
      const reply = /reply in (m:C\w+)/.exec(request.input)
      if (reply && request.toolResult === undefined) return { toolCall: { name: 'send_message', arguments: { messages: [{ topic: reply[1], text: REPLY }] } } }
      return request.toolResult === undefined ? answer(request) : '<say>Ready for your click.</say>'
    } })
    await use(model)
    await model.close()
  },
})
const REPLY = 'A synthetic reply from Juno'

test.use({ synced: true })

test.describe.configure({ timeout: 120_000 })
async function open(juno: Juno) {
  await juno.waitForSync()
  await expect.poll(() => hooks(juno.surface, 'agentState'), { timeout: 30_000 }).toBe('ready')
  return showChat(juno)
}
async function showChat(juno: Juno) {
  await juno.win.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: /^Juno/ }).click()
  return JunoChatPane.tab(juno.win)
}

test('Juno proposes a reply, nothing reaches Slack without the click, and Send posts it once', async ({ juno, slack, fake }) => {
  const chat = await open(juno)
  const eng = slack.channel('eng')
  const sent = () => fake.messages(eng).filter((m) => m.text === REPLY)
  await chat.send(`reply in m:${eng}`)
  const card = chat.root.locator('[data-chat-card="sendMessage"]')
  await expect(card).toHaveAttribute('data-card-status', 'open')
  // Juno never sends on its own: the card waits, and nothing leaves.
  await expect(chat.root.locator('[data-chat-status]')).toHaveCount(0)
  expect(sent()).toHaveLength(0)
  expect(fake.callCount('chat.postMessage')).toBe(0)

  // Hold before Slack handles the post: its socket echo can mark it sent before the HTTP reply.
  fake.holdNext({ method: 'chat.postMessage', before: true })
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  const row = card.locator('[data-send-row]')
  await expect(row).toHaveAttribute('data-send-row', 'sending')
  await expect(row).toContainText('Sending')
  fake.release({ method: 'chat.postMessage' })
  await expect(row).toHaveAttribute('data-send-row', 'sent')
  await expect(row).toContainText('Sent · Open')
  await expect(card).toHaveAttribute('data-card-status', 'done')
  expect(sent()).toHaveLength(1)
  expect(fake.callCount('chat.postMessage')).toBe(1)
})

test('a refused send retried from the topic moves its card from Failed to Sent · Open', async ({ juno, slack, fake }) => {
  const chat = await open(juno)
  const eng = slack.channel('eng')
  await chat.send(`reply in m:${eng}`)
  const card = chat.root.locator('[data-chat-card="sendMessage"]')
  await expect(card).toHaveAttribute('data-card-status', 'open')
  fake.forceError({ method: 'chat.postMessage', error: 'not_in_channel' })
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  const row = card.locator('[data-send-row]')
  await expect(row).toHaveAttribute('data-send-row', 'failed')
  await expect(row).toContainText("Failed · You're not in this channel")
  await expect(card).toHaveAttribute('data-card-status', 'failed')

  // The same send waits in the topic as Not sent; the owner's Retry there posts it, and the card follows.
  await juno.sidebar.row('#eng').open()
  const failed = juno.topic.failed(REPLY)
  await expect(failed.row).toContainText('Not sent.')
  await failed.retry()
  await juno.topic.expectSent(REPLY)
  const again = await showChat(juno)
  const retried = again.root.locator('[data-chat-card="sendMessage"]')
  await expect(retried.locator('[data-send-row]')).toHaveAttribute('data-send-row', 'sent')
  await expect(retried.locator('[data-send-row]')).toContainText('Sent · Open')
  await expect(retried).toHaveAttribute('data-card-status', 'done')
  expect(fake.messages(eng).filter((m) => m.text === REPLY)).toHaveLength(1)
})
