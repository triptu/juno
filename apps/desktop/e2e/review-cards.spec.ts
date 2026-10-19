// Home's other review cards (SPEC 12, docs/design/settled-suggestions/,
// "More self-management"): follow-ups that look done, and old drafts. Each
// card opens a sheet with every proposal and why; the action and the "no"
// per row, with Undo; the info says nothing happens in Slack; and a "no"
// stops the suggestion.
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { SELF_ID } from '@juno/fake-slack'
import { expect, launchApp, syncedTest, test } from './fixtures'
import { Juno } from './driver/juno'

test.describe.configure({ timeout: 150_000 })

const POSTGRES = 'Draft plan is in the doc'
const ENG_MAIN = '#eng'
const PROMISE = "You said you'd review Dev's packet this week"

/** Home reads its items when it appears: show a topic, then Home again. */
async function freshHome(juno: Juno, via = POSTGRES): Promise<string[]> {
  await juno.sidebar.row(via).open()
  await juno.topic.expectTitle(via)
  await juno.home.open()
  return juno.home.kinds()
}

test.describe('follow-ups that look done', () => {
  // Promises come from the background AI jobs.
  test.use({ aiJobs: true })

  syncedTest('a later link of yours proposes Mark done, with the message quoted; Undo and Not done put it back in Follow-up', async ({ juno, fake, win }) => {
    // The job finds the promise the user made to Sam.
    await expect.poll(() => freshHome(juno), { timeout: 60_000 }).toContain('followUp')

    // The user shares their review in the same thread.
    const root = fake.workspace.main('D0SAM')[0]!
    fake.workspace.post({ channel: 'D0SAM', threadTs: root.ts, user: SELF_ID, text: 'Left my notes on the packet: https://docs.example.com/packet-review' })
    await expect.poll(() => freshHome(juno), { timeout: 30_000 }).toContain('doneFollowUps')
    // The promise leaves Follow-up for the card.
    expect(await juno.home.kinds()).not.toContain('followUp')
    await expect(juno.home.title('doneFollowUps')).toHaveText('1 follow-up looks done')

    const sheet = await juno.home.reviewOf('doneFollowUps', 'doneFollowUps')
    await expect(sheet.title).toHaveText('1 follow-up looks done')
    await expect(sheet.row(PROMISE)).toBeVisible()
    // The reason is what the message shows, and the message itself is quoted.
    await expect(sheet.reason(PROMISE)).toHaveText(/^You posted a link \d+ (minute|hour|day)s? later$/)
    await expect(sheet.quote(PROMISE)).toContainText('docs.example.com/packet-review')

    await sheet.about.click()
    await expect(sheet.explainer).toContainText('Nothing is posted to Slack.')
    // The info covers the top of the list; the button closes it again.
    await sheet.about.click()

    // Mark done: the row stays and says so; its Undo brings it back.
    await sheet.act(PROMISE).click()
    await expect(sheet.row(PROMISE)).toHaveAttribute('data-review-status', 'done')
    await juno.expectToast('Follow-up done')
    await sheet.undo(PROMISE).click()
    await expect(sheet.row(PROMISE)).toHaveAttribute('data-review-status', 'open')

    // Not done, from the keyboard: the promise stays in Follow-up.
    await sheet.row(PROMISE).getByRole('link').focus()
    await win.keyboard.press('n')
    await expect(sheet.row(PROMISE)).toHaveAttribute('data-review-status', 'declined')
    await juno.expectToast('Kept in Follow-up')
    await win.keyboard.press('Escape')
    await expect(sheet.root).toHaveCount(0)

    // This match is not proposed again, and the promise is back in Follow-up.
    const kinds = await freshHome(juno)
    expect(kinds).not.toContain('doneFollowUps')
    expect(kinds).toContain('followUp')

    // A newer message with a file proposes it again; Mark done takes it off Follow-up for good.
    fake.workspace.post({ channel: 'D0SAM', threadTs: root.ts, user: SELF_ID, text: "Here's the full review", files: [{ id: 'F0PACKETREVIEW', name: 'packet-review.pdf', title: 'packet-review.pdf', mimetype: 'application/pdf' }] })
    await expect.poll(() => freshHome(juno), { timeout: 30_000 }).toContain('doneFollowUps')
    const again = await juno.home.reviewOf('doneFollowUps', 'doneFollowUps')
    await expect(again.reason(PROMISE)).toHaveText(/^You shared a file /)
    await again.act(PROMISE).click()
    await juno.expectToast('Follow-up done')
    await again.close.click()
    const after = await freshHome(juno)
    expect(after).not.toContain('doneFollowUps')
    expect(after).not.toContain('followUp')
  })
})

test.describe('old drafts', () => {
  syncedTest('a draft untouched for two weeks is proposed with its age and first line; Delete, Undo and Keep work per row', async ({ juno, fake, slackApp, userData, running }) => {
    await running.close()

    // Two drafts written 15 days ago, in topics that moved on since.
    const root = fake.workspace.main('C0ENG').find((message) => message.text?.startsWith(POSTGRES) === true)!
    const old = String(Date.now() - 15 * 24 * 3_600_000)
    const db = new DatabaseSync(join(userData, 'workspaces', fake.teamId, 'user.db'))
    const insert = db.prepare('INSERT INTO drafts (topic_id, text, updated_at) VALUES (?, ?, ?)')
    insert.run('m:C0ENG', 'Before the window we should\nsecond line', old)
    insert.run(`t:C0ENG:${root.ts}`, 'Can we move the cutover to', old)
    db.close()

    const relaunched = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword })
    try {
      const app = new Juno(relaunched.app, relaunched.win)
      const { home } = app
      await expect(home.navItem).toBeVisible({ timeout: 30_000 })
      await expect.poll(() => freshHome(app), { timeout: 30_000 }).toContain('oldDrafts')
      await expect(home.title('oldDrafts')).toHaveText('2 old drafts')
      await expect(home.meta('oldDrafts')).toHaveText('eng')

      const sheet = await home.reviewOf('oldDrafts', 'oldDrafts')
      await expect(sheet.title).toHaveText('2 old drafts')
      await expect(sheet.reason(ENG_MAIN)).toHaveText(/^Untouched for 2 weeks · \d+\+? messages? since$/)
      await expect(sheet.quote(ENG_MAIN)).toHaveText('Before the window we should')
      await expect(sheet.quote(POSTGRES)).toHaveText('Can we move the cutover to')
      await sheet.about.click()
      await expect(sheet.explainer).toContainText('nothing changes in Slack')
      // The info covers the top of the list; the button closes it again.
      await sheet.about.click()

      // Delete, then the row's Undo puts the draft back.
      await sheet.act(ENG_MAIN).click()
      await expect(sheet.row(ENG_MAIN)).toHaveAttribute('data-review-status', 'done')
      await app.expectToast('Draft deleted · #eng')
      await sheet.undo(ENG_MAIN).click()
      await expect(sheet.row(ENG_MAIN)).toHaveAttribute('data-review-status', 'open')

      // Keep the thread's draft; delete the Main's with D.
      await sheet.decline(POSTGRES).click()
      await expect(sheet.row(POSTGRES)).toHaveAttribute('data-review-status', 'declined')
      await app.expectToast('Keeping draft · ')
      await sheet.row(ENG_MAIN).getByRole('link').focus()
      await relaunched.win.keyboard.press('d')
      await expect(sheet.row(ENG_MAIN)).toHaveAttribute('data-review-status', 'done')
      await relaunched.win.keyboard.press('Escape')
      await expect(sheet.root).toHaveCount(0)

      // The kept draft is not proposed again, and the deleted one is gone.
      expect(await freshHome(app)).not.toContain('oldDrafts')
      await app.sidebar.row(POSTGRES).open()
      await expect(app.topic.composer).toHaveValue('Can we move the cutover to')
      await app.sidebar.row(ENG_MAIN).open()
      await app.topic.expectTitle('Main')
      await expect(app.topic.composer).toHaveValue('')
    } finally {
      await relaunched.close()
    }
  })
})
