// Realtime hardening (M7, architecture 5.1, 5.8 and 2.5), the parts only the
// app shows: a rename reaches the open topic's header and tab, and an engine
// restart keeps what is on screen. The socket gap, offline writes and Slack's
// rate limits are checked in the engine's flow tests.
import { expect, hooks, test } from './fixtures'
import type { Juno } from './driver/juno'

test.describe.configure({ timeout: 120_000 })

const ENG_MAIN = '#eng'

async function openMain(juno: Juno): Promise<void> {
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row(ENG_MAIN).open()
  await juno.topic.expectTitle('Main')
  // Opening the row leaves the pointer on the list, which holds its order (SPEC 5): rows leaving would wait for it to go.
  await juno.sidebar.leave()
}

// What changes in Slack while the socket is down, and a message written offline, reach the store, the rows
// and the outbox in the engine's own tests (packages/engine/test/flows/gap-and-restart.flow.test.ts,
// outbox.flow.test.ts and metadata.test.ts). Here the open topic's header and its tab follow a rename.
test('a renamed channel shows its new name in the header and the tab of its open topic', async ({ juno, fake }) => {
  await openMain(juno)
  const { topic, tabs } = juno
  fake.renameChannel({ channel: 'C0ENG', name: 'engineering' })
  await expect(topic.header).toContainText('engineering')
  await expect.poll(() => tabs.titles()).toEqual([expect.stringContaining('engineering')])
})

test('an engine restart mid-session keeps the open topic, the unsent text and the sidebar, and live updates go on', { tag: '@electron' }, async ({ juno, app, fake }) => {
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
  await topic.send('Half a thought')
  await topic.expectSent('Half a thought')
  await juno.openSettings('About')
  await expect(juno.settings.engineStatus).toHaveText('Engine live')
  await juno.settings.pingButton.click()
  await expect(juno.settings.root.getByText(/Pong \d+/)).toBeVisible()
})
