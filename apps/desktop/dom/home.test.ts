// Home (SPEC section 12, docs/design/home/): Home during the first sync, what
// wants the user, shown from the sidebar's Home button, and each kind of row
// opening its topic. The caught-up state is in home-pictures.spec.ts; a row's
// look is the gallery's.
import { readUserDb, threadId } from '../e2e/driver/userDb'
import type { Juno } from './driver/juno'
import { expect } from './expect'
import { domTest } from './test'

// Home's AI items and title rewrites come from the background AI jobs.
const AI = { synced: false, engine: { aiJobs: true }, timeout: 150_000 } as const

/** Show a topic, then Home again, so the next step starts from a fresh Home. */
async function freshHome(juno: Juno, via: string): Promise<string[]> {
  await juno.sidebar.row(via).open()
  await juno.topic.expectTitle(via)
  await juno.home.open()
  return juno.home.kinds()
}

const RINA = 'Rina finished the onsite'
const POSTGRES = 'Draft plan is in the doc'
const STAGING = 'Unrelated: has anyone looked at the'
const OFFSITE = 'Can eng take the Wednesday afternoon'

// One first sync with conversations.history held: Home shows while it runs, then a page at a time until Home has
// rows, then the end. The words and counts of the syncing line are the gallery's.
domTest('during the first sync Home shows, and shows rows before the sync ends', async ({ juno, slack, step }) => {
  const { win } = juno
  const method = 'conversations.history'
  // The first conversation's history waits, as a real workspace's backfill takes minutes.
  slack.fake.holdNext({ method })
  await juno.signIn()
  // A launch opens Home.
  await juno.home.navItem.click()
  const syncing = win.locator('[data-home][data-home-loading]')
  await expect(syncing).toBeVisible({ timeout: 30_000 })
  await expect(juno.sidebar.syncStatus).toBeVisible()

  await step('Home shows rows before the first sync ends, and keeps them first when it ends', async () => {
    const rows = win.locator('[data-home] [data-home-item]')
    // History lands a page at a time; Home shows what waits before the sync is done.
    await expect
      .poll(
        async () => {
          if ((await syncing.locator('[data-home-item]').count()) > 0) return true
          if (slack.fake.heldCount({ method }) > 0) {
            slack.fake.release({ method })
            slack.fake.holdNext({ method })
          }
          return false
        },
        { timeout: 30_000 },
      )
      .toBe(true)
    const early = await juno.home.kinds()

    // The sync ends: the rows shown stay first, in their order, and the syncing line goes.
    slack.fake.release({ method })
    await expect(syncing).toHaveCount(0, { timeout: 30_000 })
    expect((await juno.home.kinds()).slice(0, early.length)).toEqual(early)
    await expect(rows.first().getByRole('link')).toBeVisible()
  })

  await step('once the history lands the first sync finishes and its status goes', async () => {
    slack.fake.release()
    await juno.waitForSync()
    await juno.home.expectShown()
    await expect(juno.sidebar.syncStatus).toHaveCount(0)
  })
}, AI)

domTest('Home shows what waits from the sidebar, each row opens its topic, and a newer question comes first', async ({ juno, slack, clock, userData }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { home, sidebar, topic, tabs } = juno

  // Home from the sidebar, with the question Elena asked.
  await home.open()
  await expect(home.meta('waiting')).toHaveText(/^Rina finished the onsite/)

  // Waiting on you opens its thread.
  await home.openItem('waiting')
  await topic.expectTitle(RINA)

  // Moved a lot: nine replies since the user last read the thread.
  for (let n = 1; n <= 9; n++) slack.as('Leo').replyIn(STAGING, `Cost update ${n}.`)
  await sidebar.row(STAGING).expectPreview(/Cost update 9\./)
  // The title job can now finish before this flow reaches Home. Assert its settled title.
  await expect(sidebar.row(STAGING).root).toHaveAttribute('data-title-source', 'ai')
  await home.open()
  await expect(home.meta('moved')).toHaveText(/^Unrelated: has anyone looked at the/)
  await home.openItem('moved')
  await topic.expectTitle(STAGING)

  // Follow-up (AI assist on): the job finds the promise the user made to Sam; it opens the DM.
  await expect.poll(() => freshHome(juno, OFFSITE), { timeout: 30_000 }).toContain('followUp')
  await home.openItem('followUp')
  await topic.expectTitle('Sam')

  // Pick up where you left off: a topic open for a minute, then new messages.
  // The visit's minute starts as the tab shows the topic. Most of it runs on the page's clock, the last seconds in
  // real time. In the browser lane the engine socket's pings run on that clock too: a long step leaves no time for
  // their answers, so the socket drops and redials, and the visit, if written while it is down, is lost. The engine
  // is live again before the minute ends.
  await sidebar.row(POSTGRES).open()
  await topic.expectTitle(POSTGRES)
  await clock.runFor('00:55')
  await juno.expectEngineLive()
  await expect.poll(() => readUserDb(userData, slack.fake.teamId, (db) => db.prepare('SELECT topic_id FROM topic_visits ORDER BY seen_at DESC LIMIT 1').get()?.['topic_id']), { timeout: 15_000 }).toBe(threadId(slack, POSTGRES))
  await sidebar.row(OFFSITE).open()
  await topic.expectTitle(OFFSITE)
  slack.as('Dev').replyIn(POSTGRES, 'Dry run is green. Ready for the window.')
  await expect.poll(() => freshHome(juno, OFFSITE), { timeout: 20_000 }).toContain('resume')
  await expect(home.meta('resume')).toHaveText(/^Draft plan is in the doc/)
  await home.openItem('resume')
  await topic.expectTitle(POSTGRES)
  await tabs.expectCount(1)

  // Maya asks in the DM: now the newest question.
  slack.as('Maya').dm('Can you look at the hiring plan today?')
  await expect
    .poll(async () => {
      await freshHome(juno, OFFSITE)
      return home.meta('waiting').textContent()
    })
    .toMatch(/^Maya /)
}, { ...AI, clock: true })

// A DM set to Never leaves Home and comes back on Auto, and Home with AI assist off: the engine's home-view and
// ai-jobs flow tests. Mark done, Resolve all and Tidy up's review: home-live.test.ts.
