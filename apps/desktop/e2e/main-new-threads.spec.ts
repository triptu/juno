// A Main row's count of threads others started since Main was last read,
// against the fake Slack: it grows with a new thread, leaves out your own,
// and clears when Main is read, without changing the row's height.
import { expect, test } from './fixtures'

// Starts signed in and synced (README, "Synced start").
test.use({ synced: true })

test.use({ sidebarTrace: true })
test.describe.configure({ timeout: 60_000 })

test("a thread started in a channel shows on its Main row, your own does not, and reading Main clears it", async ({ juno, fake }) => {
  const main = juno.sidebar.row('#eng')
  // #eng was read up to the Postgres plan; the staging bill thread started after it.
  await main.expectNewThreads(1)
  const height = await main.height()

  const root = fake.injectMessage({ channel: 'C0ENG', user: 'U0SAM', text: 'Load test results are in.' })
  fake.injectMessage({ channel: 'C0ENG', threadTs: root.ts, user: 'U0DEV', text: 'Looking now.' })
  await main.expectNewThreads(2)

  // A thread you started from another client is not new to you.
  const own = fake.injectMessage({ channel: 'C0ENG', user: fake.selfId, text: 'Who owns the flaky deploy step?' })
  fake.injectMessage({ channel: 'C0ENG', threadTs: own.ts, user: 'U0LEO', text: 'I do.' })
  await main.expectPreview('You: Who owns the flaky deploy step?')
  await main.expectNewThreads(2)
  // The count sits on the title line: the row keeps its height.
  expect(await main.height()).toBe(height)

  await main.open()
  await juno.topic.expectTitle('Main')
  await main.expectNoNewThreads()
  expect(await main.height()).toBe(height)
})
