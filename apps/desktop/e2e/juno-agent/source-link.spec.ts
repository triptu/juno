// A Juno source link to a message far up a long thread that is open at its
// bottom: the topic scrolls to the message, and a reply that arrives after
// does not take the list back to the bottom.
import { startFakeOpenRouter, type OpenRouterRequest } from '@juno/agent-testing/openrouter'
import { seedWorkspace, startFakeSlack, topic300Seed } from '@juno/fake-slack'
import type { Juno } from '../driver/juno'
import { hooks } from '../fixtures'
import { expect, JunoChatPane, test as chatTest } from './chat'

const THREAD = 'Review the rollout checklist 1'
const LINKED = 'Review the rollout checklist 220.'

/** Searches for the linked message, then cites it as a source. */
function answer(request: OpenRouterRequest) {
  if (request.toolResult === undefined) return { toolCall: { name: 'slack_search', arguments: { query: 'checklist 220 in:#perf-thread' } } }
  return '<say>It is in <src m="m1">the rollout checklist</src>.</say>'
}

const test = chatTest.extend({
  // oxlint-disable-next-line no-empty-pattern
  fake: async ({}, use) => {
    const fake = await startFakeSlack({
      seed: (workspace, avatars) => {
        seedWorkspace(workspace, avatars)
        topic300Seed()(workspace, avatars)
      },
    })
    await use(fake)
    await fake.close()
  },
  // oxlint-disable-next-line no-empty-pattern
  model: async ({}, use) => {
    const model = await startFakeOpenRouter({ answer })
    await use(model)
    await model.close()
  },
})

test.describe.configure({ timeout: 90_000 })

/** The message's top and bottom inside the topic's scroller, in px from its top. */
const placeIn = (juno: Juno, text: string) =>
  juno.topic.scroller.evaluate((scroller, wanted) => {
    const row = [...scroller.querySelectorAll('[data-message-row]')].find((node) => node.textContent?.includes(wanted))
    if (row === undefined) return undefined
    const view = scroller.getBoundingClientRect()
    const box = row.getBoundingClientRect()
    return { top: box.top - view.top, bottom: box.bottom - view.top, height: view.height }
  }, text)

test('a source link scrolls the open topic to the message, and a reply that arrives after leaves it there', async ({ juno, slack }) => {
  await juno.signIn()
  await juno.waitForSync()
  await expect.poll(() => hooks(juno.app, 'agentState'), { timeout: 15_000 }).toBe('ready')
  await juno.app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]!
    window.setSize(1400, window.getSize()[1]!)
  })
  const row = juno.sidebar.row(THREAD)
  await row.open()
  await juno.topic.expectAtBottom()

  await juno.tabs.menu('juno')
  const panel = JunoChatPane.panel(juno.win)
  await panel.send('where is checklist 220?')
  await panel.expectJuno('It is in the rollout checklist.')
  // Cover a reply committed before the browser reports that the jump settled.
  // Keep the real source click and scrolling, but defer scrollend until the reply is drawn.
  await juno.topic.scroller.evaluate((scroller) => {
    scroller.dataset.deferScrollEnd = 'true'
    scroller.addEventListener('scrollend', (event) => {
      if (scroller.dataset.deferScrollEnd === 'true') event.stopImmediatePropagation()
    }, { capture: true })
  })
  await panel.junoBubble('It is in the rollout checklist.').locator('[data-source]').click()

  // The message is in view, well away from the bottom.
  await expect.poll(async () => {
    const at = await placeIn(juno, LINKED)
    return at !== undefined && at.top >= 0 && at.bottom <= at.height
  }, { timeout: 10_000 }).toBe(true)
  expect(await juno.topic.distanceFromBottom()).toBeGreaterThan(2_000)

  await expect(panel.root).toBeVisible()
  const before = (await placeIn(juno, LINKED))!

  // A reply arrives: the list does not go back to the bottom, so the cited message stays in view.
  slack.as('Leo').replyIn(THREAD, 'Cutover is a go')
  await expect(juno.topic.scroller.locator('[data-message-row]').filter({ hasText: 'Cutover is a go' })).toHaveCount(1)
  const after = (await placeIn(juno, LINKED))!
  expect(after.top).toBe(before.top)
  expect(after.top).toBeGreaterThanOrEqual(0)
  expect(after.bottom).toBeLessThanOrEqual(after.height)
  expect(await juno.topic.distanceFromBottom()).toBeGreaterThan(2_000)
  await juno.topic.scroller.evaluate((scroller) => {
    delete scroller.dataset.deferScrollEnd
    scroller.dispatchEvent(new Event('scrollend'))
  })
  await juno.topic.expectPill('1 new message')
})
