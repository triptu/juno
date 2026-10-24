// The `agent.codemode` flag in the built app: the QuickJS worker and binary load in the agent
// process, a script reads Slack through the host, the answer cites what the script returned,
// and Activity lists the script's read.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { startFakeOpenRouter, type OpenRouterRequest } from '@juno/agent-testing/openrouter'
import { seedWorkspace, startFakeSlack, topic300Seed } from '@juno/fake-slack'
import { openChat, openPage, openRuns, ready } from './agent'
import { expect, test as chatTest } from './chat'

/** One script that searches and keeps only the matching line, then an answer citing it. */
function answer(request: OpenRouterRequest) {
  if (request.toolResult === undefined) {
    const code = `
      const found = await tools.slack_search({ query: 'checklist 220 in:#perf-thread' })
      text(found.split('\\n').filter((line) => line.includes('checklist 220')).join('\\n'))
    `
    return { toolCall: { name: 'codemode', arguments: { code } } }
  }
  return request.toolResult.includes('m1 ') ? '<say>It is in <src m="m1">the rollout checklist</src>.</say>' : '<say>The script found nothing.</say>'
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
  agentOptions: async ({ model }, use) => {
    await use({ agent: true, fakeOpenRouterUrl: model.origin, codemode: true })
  },
})

test.describe.configure({ timeout: 90_000 })

test('a read-only script runs in the built app, its answer cites what it read, and Activity lists the read', { tag: '@canary' }, async ({ juno, userData }) => {
  await ready(juno)
  // The agent ran one script in the sandbox at start: the worker and the QuickJS binary loaded.
  await expect.poll(async () => JSON.parse(await readFile(join(userData, 'agent', 'codemode-probe.json'), 'utf8').catch(() => '{}')), { timeout: 20_000 }).toEqual({ ok: true, value: 12 })

  const chat = await openChat(juno)
  await chat.send('where is checklist 220?')
  await chat.expectJuno('It is in the rollout checklist.')
  await expect(chat.junoBubble('It is in the rollout checklist.').locator('[data-source]')).toHaveCount(1)

  const page = await openPage(juno, 'Activity')
  await openRuns(page)
  await expect(page.getByText('Ran 1 script: 1 read', { exact: true })).toBeVisible()
  await expect(page.locator('[data-activity-script-call="done"]')).toContainText('slack_search {"query":"checklist 220 in:#perf-thread"}')
})
