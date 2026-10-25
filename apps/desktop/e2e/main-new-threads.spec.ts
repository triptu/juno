// A Main row's count of threads others started since Main was last read sits on the title line, so it
// leaves the row's height alone when it shows and when reading Main clears it. The count itself is engine
// data (`counts the threads others started` in packages/engine/test/reads.test.ts).
import { expect, test } from './fixtures'

// Starts signed in and synced (README, "Synced start").
test.use({ synced: true })

test.use({ sidebarTrace: true })

test('the new-thread count on a Main row keeps the row height, and reading Main clears it', async ({ juno }) => {
  const main = juno.sidebar.row('#eng')
  // #eng was read up to the Postgres plan; the staging bill thread started after it.
  await main.expectNewThreads(1)
  const height = await main.height()

  await main.open()
  await juno.topic.expectTitle('Main')
  await main.expectNoNewThreads()
  expect(await main.height()).toBe(height)
})
