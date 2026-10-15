// Realtime hardening (M7, architecture 5.1, 5.8 and 2.5): what changes in
// Slack while the socket is down reaches the open topic once it is back,
// Slack's rate limits slow Juno down without stopping it, a message written
// offline waits and goes once, and an engine restart keeps what is on screen.
import { expect, hooks, test } from './fixtures'
import type { Juno } from './driver/juno'

test.describe.configure({ timeout: 120_000 })

const ENG_MAIN = '#eng'

async function openMain(juno: Juno): Promise<void> {
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row(ENG_MAIN).open()
  await juno.topic.expectTitle('Main')
}

test('an edit, a delete and a reaction made while the socket is down show once it is back', async ({ juno, fake }) => {
  await openMain(juno)
  const { topic, sidebar } = juno
  const edited = fake.injectMessage({ channel: 'C0ENG', user: 'U0LEO', text: 'Deploy at 3.' })
  const deleted = fake.injectMessage({ channel: 'C0ENG', user: 'U0SAM', text: 'Wrong channel, sorry.' })
  const reacted = fake.injectMessage({ channel: 'C0ENG', user: 'U0PRIYA', text: 'Release notes are up.' })
  await topic.expectMessage('Release notes are up.')

  fake.goOffline()
  await sidebar.expectSyncStatus("You're offline")
  fake.editMessage({ channel: 'C0ENG', ts: edited.ts, text: 'Deploy at 4.' })
  fake.deleteMessage({ channel: 'C0ENG', ts: deleted.ts })
  fake.addReaction({ channel: 'C0ENG', ts: reacted.ts, name: 'tada', user: 'U0JONAS' })
  // Nothing reaches Juno while it is offline.
  await expect(topic.message('Wrong channel, sorry.')).toBeVisible()

  fake.goOnline()
  await sidebar.expectNoSyncStatus(30_000)
  await expect(topic.message('Deploy at 4.')).toContainText('edited', { timeout: 30_000 })
  await expect(topic.message('Deploy at 3.')).toHaveCount(0)
  await expect(topic.message('Wrong channel, sorry.')).toHaveCount(0)
  await expect(topic.message('Release notes are up.').getByRole('button', { name: /^1 🎉/ })).toBeVisible()
})

test('a 429 storm: the line says Slack asked us to slow down, every method waits out Retry-After, and the gap still arrives', async ({ juno, fake, slack }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { sidebar } = juno
  fake.goOffline()
  await sidebar.expectSyncStatus("You're offline")
  slack.as('Priya').postIn('product', 'Pricing page copy is live.')
  fake.resetCalls()
  // Every method the catch-up calls gets a 429 asking for six seconds, longer than the interactive lane waits.
  const methods = ['client.counts', 'conversations.history', 'subscriptions.thread.getView', 'search.modules.messages']
  for (const method of methods) fake.force429({ method, retryAfter: 6 })
  fake.goOnline()

  await sidebar.expectSyncStatus('Slack asked us to slow down')
  await sidebar.expectNoSyncStatus(60_000)
  await expect(sidebar.row('#product').preview).toContainText('Pricing page copy is live.', { timeout: 30_000 })

  const limited = fake.calls.filter((call) => call.kind === 'api' && call.status === 429)
  expect(new Set(limited.map((call) => call.method))).toEqual(new Set(methods))
  for (const call of limited) {
    const next = fake.calls.find((later) => later.method === call.method && later.at > call.at)
    if (next === undefined) continue
    expect(next.at - call.at, call.method).toBeGreaterThanOrEqual(6_000 - 50)
  }
})

test('a message written offline shows at once, waits, and is posted once when Slack is back', async ({ juno, fake }) => {
  await openMain(juno)
  const { topic, sidebar } = juno
  fake.goOffline()
  await sidebar.expectSyncStatus("You're offline")
  fake.resetCalls()

  await topic.send('Written on the train')
  await expect(topic.message('Written on the train')).toHaveAttribute('data-pending', /.*/)
  // Give a post a moment to leave; none does while offline.
  await juno.win.waitForTimeout(1_000)
  expect(fake.calls.filter((call) => call.method === 'chat.postMessage')).toHaveLength(0)

  fake.goOnline()
  await topic.expectSent('Written on the train')
  await sidebar.expectNoSyncStatus(30_000)
  expect(fake.calls.filter((call) => call.method === 'chat.postMessage')).toHaveLength(1)
  expect(fake.messages('C0ENG').filter((m) => m.text === 'Written on the train')).toHaveLength(1)
})

test('an engine restart mid-session keeps the open topic, the unsent text and the sidebar, and live updates go on', async ({ juno, app, fake }) => {
  await openMain(juno)
  const { topic, sidebar } = juno
  await topic.composer.fill('Half a thought')
  const pid = await hooks(app, 'enginePid')
  expect(pid).toBeDefined()

  process.kill(pid!, 'SIGKILL')
  await expect.poll(() => hooks(app, 'enginePid'), { timeout: 15_000 }).not.toBe(pid)
  await expect.poll(() => hooks(app, 'engineState'), { timeout: 15_000 }).toBe('ready')

  // Nothing on screen was rebuilt from scratch: the tab, its text and the rows are as they were.
  await topic.expectTitle('Main')
  await expect(topic.composer).toHaveValue('Half a thought')
  await sidebar.expectRows()
  await sidebar.expectNoSyncStatus()

  // The new engine's port carries live updates to the same topic.
  fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: 'Back after the restart.' })
  await topic.expectMessage('Back after the restart.')
})
