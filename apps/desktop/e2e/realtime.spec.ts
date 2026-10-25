// Realtime hardening (M7, architecture 5.1, 5.8 and 2.5), the part only the
// app shows: a rename reaches the open topic's header and tab. The socket gap,
// offline writes and Slack's rate limits are checked in the engine's flow
// tests; an engine restart keeping what is on screen is in the restart
// journey (juno-agent/crash.spec.ts).
import { expect, test } from './fixtures'
import type { Juno } from './driver/juno'

// Starts signed in and synced (README, "Synced start").
test.use({ synced: true })

const ENG_MAIN = '#eng'

async function openMain(juno: Juno): Promise<void> {
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
