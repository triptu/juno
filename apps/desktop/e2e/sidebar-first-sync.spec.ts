// The sidebar from a first sign-in: the list while the first sync runs, and
// row previews and group DMs that need data in the fake before sign-in. The
// signed-in sidebar is in sidebar.spec.ts.
import { SELF_ID, TEAM } from '@juno/fake-slack'
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

// Both steps need data in the fake before the first sign-in.
test('previews name people and label an image, and a group DM shows as soon as someone posts in it', async ({ juno, fake }) => {
  for (const [id, name, real] of [
    ['U0ALEXK', 'alexk', 'Alex Kim'],
    ['U0ALEXR', 'alexr', 'Alex Rivera'],
    ['U0ROBIN', 'robin', 'Robin Okafor'],
  ] as const) {
    fake.workspace.addUser({ id, team_id: TEAM.id, name, real_name: real, profile: { display_name: real, real_name: real } })
  }
  fake.workspace.post({ channel: 'D0MAYA', user: 'U0MAYA', text: '', files: [{ id: 'F0SIDEPIC', name: 'whiteboard.png', title: 'whiteboard.png', mimetype: 'image/png' }], silent: true })
  fake.workspace.post({ channel: 'D0SAM', user: SELF_ID, text: 'Sent the notes', silent: true })
  fake.workspace.post({ channel: 'C0ENG', user: 'U0ALEXR', text: 'Deploy window moved', silent: true })
  fake.workspace.post({ channel: 'C0ENG', user: 'U0ALEXK', text: 'Works for me', silent: true })
  fake.workspace.post({ channel: 'C0PRODUCT', user: 'U0ROBIN', text: 'Pricing copy is final', silent: true })
  // Slack's counts leaves a closed group DM out, and a message opens it again with no membership event.
  fake.addGroupDm({ id: 'G0CLOSED', users: ['U0MAYA', 'U0SAM'], open: false })
  await juno.signIn()
  await juno.waitForSync()
  const { sidebar } = juno

  // The preview line (SPEC 5, "Row anatomy"): a message with only an image reads "Image"; the other side of a
  // one-to-one DM has no name, yours read "You:"; a channel shows a first name, with a last initial when two people
  // there share it.
  await test.step('previews name people by first name, drop the other side of a DM, and label an image', async () => {
    await sidebar.row('Maya', { exact: true }).expectPreview('Image')
    await sidebar.row('Sam', { exact: true }).expectPreview('You: Sent the notes')
    await sidebar.row('#product').expectPreview('Robin: Pricing copy is final')
    await sidebar.row('#eng').expectPreview('Alex K: Works for me')
  })

  await test.step('a group DM shows as soon as someone posts in it, when it was closed or Juno has never seen it', async () => {
    const closed = juno.win.locator('[data-topic-id="m:G0CLOSED"]')
    await expect(closed).toHaveCount(0)
    fake.injectMessage({ channel: 'G0CLOSED', user: 'U0SAM', text: 'Picking the launch notes back up' })
    await expect(closed).toBeVisible()

    // One made after Juno loaded the list, which Slack never announced either.
    fake.addGroupDm({ id: 'G0FRESH', users: ['U0LEO', 'U0JONAS'] })
    fake.injectMessage({ channel: 'G0FRESH', user: 'U0LEO', text: 'Quick question about the offsite' })
    await expect(juno.win.locator('[data-topic-id="m:G0FRESH"]')).toBeVisible()
  })
})
