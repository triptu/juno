// The topic actions against the fake Slack (SPEC 5 "Row actions"): resolve and reopen, and
// pin, each with its toast, and each undone with the toast's Undo or ⌘Z (Edit › Undo).
import { expect } from './expect'
import { domTest } from './test'

const POSTGRES = 'Draft plan is in the doc'
const ROADMAP = 'Proposal: cut offline mode and public'
const MARKS = ['conversations.mark', 'subscriptions.thread.mark']

domTest('resolves and reopens topics, with Undo and pinned rows', async ({ juno, slack, step }) => {
  const { sidebar } = juno
  await step('Resolve hides the row and marks it read, Undo brings it back unread, and a new reply reopens it', async () => {
    const roadmap = sidebar.row(ROADMAP)
    await roadmap.expectUnread(3)
    slack.resetCalls()

    // From the row's menu.
    await roadmap.chooseInMenu('resolve')
    await roadmap.expectAbsent()
    await juno.expectToast(`Resolved · ${ROADMAP}`)
    // Resolve marks read in Slack too; it never unfollows.
    await expect.poll(() => slack.fake.calls.some((call) => MARKS.includes(call.method)), { timeout: 10_000 }).toBe(true)
    expect(slack.fake.calls.some((call) => call.method === 'subscriptions.thread.remove')).toBe(false)

    await juno.undoFromToast()
    await roadmap.expectVisible()
    await roadmap.expectUnread(3)

    // Resolved again from the row's menu right after Undo: it must offer Resolve, not Reopen, with no waiting.
    const menu = await roadmap.chooseInMenu('resolve')
    expect(menu.labels).toContain('Resolve')
    expect(menu.labels).not.toContain('Reopen')
    // A reply from someone else then brings it back, tagged.
    await roadmap.expectAbsent()
    slack.as('Maya').replyIn(ROADMAP, 'One more thing on the proposal.')
    await roadmap.expectVisible()
    await roadmap.expectTag('Reopened')
  })

  await step('a pinned topic stays in Pinned when resolved, and the header reopens it', async () => {
    const postgres = sidebar.row(POSTGRES)

    await postgres.chooseInMenu('pin')
    await juno.expectToast(`Pinned · ${POSTGRES}`)
    await expect(sidebar.section('Pinned').locator('[data-topic-row]')).toHaveCount(1)
    await postgres.open()

    const header = juno.topic.header
    await header.getByRole('button', { name: 'Resolve' }).click()
    await juno.expectToast(`Resolved · ${POSTGRES}`)
    await postgres.expectResolvedCheck()
    expect(await sidebar.titles('Pinned')).toEqual([expect.stringMatching(/^Draft plan/)])

    // Reopen is the same button now; ⌘Z undoes it.
    await header.getByRole('button', { name: 'Reopen' }).click()
    await juno.expectToast(`Reopened · ${POSTGRES}`)
    await postgres.expectResolvedCheck(false)
    await juno.undo()
    await postgres.expectResolvedCheck()
    await expect(header.getByRole('button', { name: 'Reopen' })).toBeVisible()

    // Unpin, then undo it.
    await postgres.chooseInMenu('unpin')
    await juno.expectToast(`Unpinned · ${POSTGRES}`)
    await sidebar.expectNoSection('Pinned')
    await juno.undo()
    await expect(sidebar.section('Pinned').locator('[data-topic-row]')).toHaveCount(1)
    // And the pin itself: undoing it empties Pinned. The resolve undo goes first.
    await juno.undo()
    await juno.undo()
    await sidebar.expectNoSection('Pinned')
  })
})
