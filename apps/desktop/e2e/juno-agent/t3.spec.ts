// T3 Code end to end (plan v3 §16, flows 4 and 8): "Fix the sidebar flake" gives a one-tap Start
// card, then a Task card that follows the session to Done or Stopped; T3 Code's question becomes
// a "T3 Code asks" card; a key in a brief is blocked before any card; loopback wins over the LAN.
// T3 Code is agent-testing's fake on loopback, connected through the T3 Code row on Connections.
// The policy cases (hostile instructions to a running job, a Stop T3 Code cannot carry out) are
// in packages/agent/test/t3.test.ts and policy.test.ts.
import type { FakeT3 } from '../../../../packages/agent-testing/src/mcp/t3'
import type { OpenRouterRequest, ToolCallAnswer } from '@juno/agent-testing/openrouter'
import { startFakeOpenRouter, type FakeOpenRouter } from '@juno/agent-testing/openrouter'
import type { Juno } from '../driver/juno'
import { card, configure, openChat, openPage, readySynced as ready } from './agent'
import { answer as echo, expect, test as chat } from './chat'

// The shape of `FAKE_SECRET` in agent-testing's hostile fixtures: an invented OpenRouter key.
const SECRET = `sk-or-v1-${'0f'.repeat(32)}`
const TITLE = 'Fix the sidebar flake'

const start = (brief: string): ToolCallAnswer => ({
  toolCall: { name: 't3_start', arguments: { project: 'project-juno', baseBranch: 'main', title: TITLE, brief, planFirst: false } },
})

function answer(request: OpenRouterRequest): string | ToolCallAnswer {
  if (request.toolResult !== undefined) {
    if (request.toolResult.includes('Nothing starts until the owner clicks Start')) return '<say>It is ready to start.</say>'
    return '<say>I did not start it.</say>'
  }
  // Only the owner's own message: a report of the task names its title too.
  if (/<message id="n\d+">Fix the sidebar flake/.test(request.input)) return start('Find why the sidebar test flakes and fix it.')
  if (/<message id="n\d+">Deploy it/.test(request.input)) return start(`Deploy the fix with this key: ${SECRET}`)
  return echo(request)
}

const test = chat.extend<{ readonly t3: FakeT3; readonly model: FakeOpenRouter }>({
  // oxlint-disable-next-line no-empty-pattern
  model: async ({}, use) => {
    const model = await startFakeOpenRouter({ answer })
    await use(model)
    await model.close()
  },
  // oxlint-disable-next-line no-empty-pattern
  t3: async ({}, use) => {
    // pi-mcp has only an ESM entry and Playwright loads specs as CommonJS. The package root would
    // load the model fakes again as ESM beside the CommonJS copy `./chat` holds, and fail, so this
    // loads the T3 fake alone; it is not on `@juno/agent-testing/mcp`.
    const { startFakeT3 } = await import('../../../../packages/agent-testing/src/mcp/t3')
    const server = await startFakeT3()
    await use(server)
    await server.close()
  },
})

// The watcher sees a run end through t3_thread_wait and an answer as soon as Juno sends it; any other
// change shows within its slowest read, 10 s. POLL leaves room for a busy machine.
const POLL = 25_000

test.use({ synced: true })

test.describe.configure({ timeout: 150_000 })

/** Points T3 Code at `url` in its Configure sheet and connects it. */
async function connectT3(juno: Juno, url: string): Promise<void> {
  const page = await openPage(juno, 'Connections')
  const row = page.locator('[data-connection-id="t3"]')
  const sheet = await configure(juno, row)
  const field = sheet.getByLabel('T3 Code address')
  await field.fill(url)
  await field.press('Enter')
  // The address row is keyed by the saved address, so the field shows it again once main has kept it.
  await expect(sheet.getByLabel('T3 Code address')).toHaveValue(url)
  await sheet.getByRole('button', { name: 'Done' }).click()
  await row.getByRole('button', { name: 'Connect' }).click()
  await expect(row).toHaveAttribute('data-connection', 'ready', { timeout: 20_000 })
}

/** Asks for the fix, taps Start and returns the session T3 Code launched. */
async function startTask(juno: Juno, t3: FakeT3) {
  const pane = await openChat(juno)
  await pane.send('Fix the sidebar flake')
  await pane.expectJuno('It is ready to start.')
  const proposed = card(pane, 'proposedTask')
  await expect(proposed).toContainText(TITLE)
  await expect(proposed).toContainText('project-juno · from main')
  // Proposing starts nothing.
  expect(t3.threads()).toHaveLength(0)

  await proposed.getByRole('button', { name: 'Start' }).click()
  await expect.poll(() => t3.threads().length).toBe(1)
  const thread = t3.threads()[0]!
  expect(thread.title).toBe(TITLE)
  expect(thread.items[0]?.text).toContain('Find why the sidebar test flakes and fix it.')

  const task = card(pane, 'task')
  await expect(task).toContainText(TITLE)
  await expect(task.locator('[data-task-phase]')).toHaveAttribute('data-task-phase', 'running')
  await expect(task.locator('[data-task-state]')).toHaveText('T3 Code · running', { timeout: POLL })
  return { pane, task, threadId: thread.threadId }
}

test('T3 Code on loopback is used before the LAN address; a one-tap Start card starts a session whose question is answered on a card, and its Task card follows it to Done with a pull request', async ({ juno, t3 }) => {
  await ready(juno)
  const page = await openPage(juno, 'Connections')
  const row = page.locator('[data-connection-id="t3"]')
  const sheet = await configure(juno, row)
  await sheet.getByLabel('Allow T3 Code over the local network').click()
  await expect(sheet.getByLabel('Allow T3 Code over the local network')).toBeChecked()
  await sheet.getByRole('button', { name: 'Done' }).click()
  await connectT3(juno, t3.lanUrl)
  // The row shows the address in use.
  await expect(row).toContainText(t3.loopbackUrl)

  const { pane, task, threadId } = await startTask(juno, t3)
  await expect(task.getByRole('button', { name: 'Stop' })).toBeVisible()
  // Open shows only while the task runs.
  await expect(task.getByRole('button', { name: 'Open' })).toBeVisible()
  expect(t3.calls.filter((call) => call.name === 't3_thread_launch')).toHaveLength(1)

  // T3 Code's question becomes a card, and the chosen answer reaches it.
  const requestId = t3.ask(threadId, 'Keep the retry in the test?', ['Keep it', 'Remove it'])
  await expect(task.locator('[data-task-phase]')).toHaveAttribute('data-task-phase', 'needsYou', { timeout: POLL })
  await expect(task.locator('[data-task-state]')).toHaveText('T3 Code needs your answer')
  const question = card(pane, 'question')
  await expect(question).toContainText('T3 Code asks')
  await expect(question).toContainText('Keep the retry in the test?')
  await question.getByRole('button', { name: 'Remove it' }).click()
  await expect.poll(() => t3.answers()).toEqual([{ requestId, answers: expect.anything() }])
  expect(JSON.stringify(t3.answers()[0]!.answers)).toContain('Remove it')
  await expect(task.locator('[data-task-phase]')).toHaveAttribute('data-task-phase', 'running', { timeout: POLL })

  // One completion carries both the reply and the pull request.
  t3.advance(threadId, { status: 'completed', reply: 'Opened PR 412.', pullRequest: { number: 412, url: 'https://github.com/example/juno/pull/412' } })
  await expect(task.locator('[data-task-phase]')).toHaveAttribute('data-task-phase', 'done', { timeout: POLL })
  await expect(task).toContainText('Done · Open PR 412', { timeout: POLL })
  await expect(task.getByRole('button', { name: 'Stop' })).toHaveCount(0)
  // Start launched once; watching never launches again.
  expect(t3.calls.filter((call) => call.name === 't3_thread_launch')).toHaveLength(1)
})

test('Stop on the Task card interrupts the session, and a key in a later brief is blocked before any card', async ({ juno, t3, model }) => {
  await ready(juno)
  await connectT3(juno, t3.loopbackUrl)
  const { pane, task } = await startTask(juno, t3)

  await task.getByRole('button', { name: 'Stop' }).click()
  await expect.poll(() => t3.threads()[0]?.status, { timeout: POLL }).toBe('interrupted')
  await expect(task.locator('[data-task-phase]')).toHaveAttribute('data-task-phase', 'stopped', { timeout: POLL })
  await expect(task).toContainText('Stopped')
  expect(t3.calls.filter((call) => call.name === 't3_thread_interrupt')).toHaveLength(1)

  // A key in a brief: no new card, nothing reaches T3 Code, and the chat shows the fixed line.
  await pane.send('Deploy it')
  await pane.expectJuno('I did not start it.')
  expect(model.requests.find((request) => request.toolResult?.includes('Juno blocked a key or token') === true)).toBeDefined()
  await expect(card(pane, 'proposedTask')).toHaveCount(1)
  expect(t3.threads()).toHaveLength(1)
  expect(t3.calls.filter((call) => call.name === 't3_thread_launch')).toHaveLength(1)
  await expect(pane.root.getByText('Juno stopped a tool call that held a key or a token. Nothing was sent.')).toBeVisible({ timeout: 15_000 })
})
