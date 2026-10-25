// The sidebar from a first sign-in: the list while the first sync runs. Row
// previews and group DMs that need data in the fake before sign-in are in
// packages/engine/test/flows/sidebar.flow.test.ts. The signed-in sidebar is
// in sidebar.spec.ts.
import { expect, test } from './fixtures'
import { expectStableAnchor } from './shiftProbe'

// A failing test attaches the sidebar's order hold and topic list values (README, "Sidebar trace").
test.use({ sidebarTrace: true })

// Every test signs in and waits for the sync before it looks at rows.
test.describe.configure({ timeout: 60_000 })

// Titles are the first six words of the root message, so a prefix is enough.
const POSTGRES = 'Draft plan is in the doc'

test('during the first sync the list says Juno is getting the topics, then shows rows before history lands', async ({ juno, fake }) => {
  // Hold the first boot call, so nothing has arrived when the window opens.
  fake.holdNext({ method: 'client.userBoot', before: true })
  fake.holdNext({ method: 'conversations.history', before: true })
  await juno.signIn()
  const { sidebar } = juno
  await sidebar.expectEmpty('Getting your topics')
  await expect(sidebar.syncStatus).toHaveText('Syncing with Slack')
  await expect(sidebar.syncProgress).toHaveAttribute('aria-valuetext', 'Finding your conversations')
  await expect(sidebar.list.getByText("It's quiet")).toHaveCount(0)

  // The card sits at the foot of the sidebar, under the list; the header has no status line.
  await juno.allTopics.open()
  const header = sidebar.root.locator('header[aria-label="Sidebar title bar"]')
  const headerBox = await header.boundingBox()
  expect(await header.getByRole('progressbar').count()).toBe(0)
  const listBox = await sidebar.list.boundingBox()
  const cardBox = await sidebar.root.locator('[data-sync-status]').boundingBox()
  expect(listBox).not.toBeNull()
  expect(cardBox).not.toBeNull()
  expect(cardBox!.y).toBeGreaterThan(listBox!.y + listBox!.height)
  fake.release({ method: 'client.userBoot' })
  await expect.poll(() => fake.heldCount({ method: 'conversations.history' })).toBe(1)
  await expect(sidebar.syncProgress).toHaveAttribute('aria-valuetext', /^\d+ of \d+ conversations$/)
  // The quick start is done: rows show while history is still held, and the card stays until the sync ends.
  await sidebar.expectRows()
  await expect(sidebar.syncStatus).toHaveText('Syncing with Slack')
  // Rows take their places while history lands; the discovery search after it waits, so the sync cannot end yet.
  fake.holdNext({ method: 'search.modules.messages', before: true })
  fake.release({ method: 'conversations.history' })
  await expect.poll(() => fake.heldCount({ method: 'search.modules.messages' })).toBe(1)
  // The card goes when the sync ends; nothing above the list moves. The list's own rows still take their places and
  // bot channels leave for Automated as the last pages land (checked above), so only moves inside it are skipped.
  // All topics, beside it, takes the titles the last pages bring, so only the sidebar is checked.
  await expectStableAnchor(juno.win, 'nav[aria-label="Pages"]', async () => {
    fake.release({ method: 'search.modules.messages' })
    await juno.waitForSync()
    await sidebar.row(POSTGRES).expectVisible()
  }, { within: '[aria-label="Sidebar"]', outside: '[aria-label="Sidebar"] [role="group"][aria-label="Topics"]' })
  await sidebar.expectNoSyncStatus()
  expect(await header.boundingBox()).toEqual(headerBox)
})
