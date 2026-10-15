import { startFakeOpenRouter } from '@juno/agent-testing/openrouter'
import { hooks } from '../fixtures'
import { expect, JunoChatPane, test as base } from './chat'

const test = base.extend({
  // oxlint-disable-next-line no-empty-pattern
  model: async ({}, use) => {
    const model = await startFakeOpenRouter({ answer: (request) => {
      const topic = /resolve (m:C\w+)/.exec(request.input)?.[1]
      return topic && request.toolResult === undefined
        ? { toolCall: { name: 'topics_resolve', arguments: { topicIds: [topic] } } }
        : '<say>Ready for your click.</say>'
    } })
    await use(model)
    await model.close()
  },
})

test('Resolve waits for a click, hides the topic, and Undo brings it back', async ({ juno, slack }) => {
  await juno.signIn()
  await juno.waitForSync()
  await expect.poll(() => hooks(juno.app, 'agentState'), { timeout: 30_000 }).toBe('ready')
  const topic = `m:${slack.channel('eng')}`
  const visibleTopic = juno.win.locator(`[data-topic-row][data-topic-id="${topic}"]`)
  await juno.win.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: /^Juno/ }).click()
  const chat = JunoChatPane.tab(juno.win)
  await chat.send(`resolve ${topic}`)
  const card = chat.root.locator('[data-chat-card="resolve"]')
  await expect(card).toHaveAttribute('data-card-status', 'open')
  await expect(visibleTopic).toBeVisible()
  await card.getByRole('button', { name: 'Resolve', exact: true }).click()
  await expect(card).toContainText('Resolved')
  await expect(visibleTopic).toHaveCount(0)
  await card.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(visibleTopic).toBeVisible()
  await expect(card).toContainText('Undone')
})
