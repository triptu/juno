// Home (SPEC section 12, docs/design/home/): what wants the user, shown with
// no tab open and from the sidebar's Home button; each kind of row opens its
// topic; Mark done and Resolve all with Undo; Home with AI assist off; and
// the caught-up state is in home-pictures.spec.ts;
// and a DM's row drawn as the sidebar draws its Main: the photo, named once.
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { SELF_ID } from '@juno/fake-slack'
import { expect, test } from './fixtures'

import type { Juno } from './driver/juno'
import { readUserDb, threadId } from './driver/userDb'

test.describe.configure({ timeout: 150_000 })
// Home's AI items and title rewrites come from the background AI jobs.
test.use({ aiJobs: true, freshContext: true })

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
const KEYS = 'The staging deploy keys need rotating'
const OFFSITE = 'Can eng take the Wednesday afternoon'

// One first sync with conversations.history held: the start ("0 of N"), then a page at a time
// until Home has rows, then the end.
test('during the first sync Home greets, counts as the sidebar does and shows rows before it ends', async ({ juno, slack, win }) => {
  const greets = 'During the first sync Home greets and says how far the sync got, as the sidebar does'
  const rowsEarly = 'Home shows rows before the first sync ends'
  const method = 'conversations.history'
  // The first conversation's history waits, as a real workspace's backfill takes minutes.
  slack.fake.holdNext({ method })
  await juno.signIn()
  // A launch opens Home.
  await juno.home.navItem.click()
  const syncing = win.locator('[data-home][data-home-loading]')
  const progress = juno.sidebar.syncStatus
  await test.step(greets, async () => {
    await expect(syncing.getByRole('heading', { level: 2 })).toHaveText(/Tushar\.$/, { timeout: 30_000 })
    await expect(syncing.getByText('All caught up.')).toHaveCount(0)
    await expect(progress).toHaveText('Syncing with Slack')
    await expect(juno.sidebar.syncProgress).toHaveAttribute('aria-valuetext', /^0 of \d+ conversations$/)
    // Home's line counts the conversations as the sidebar's card does.
    const line = syncing.locator('h2 + p')
    await expect(line).toHaveText(/^Syncing 0 of \d+ conversations\.$/)
    await expect.poll(async () => `Syncing ${await juno.sidebar.syncProgress.getAttribute('aria-valuetext')}.`).toBe(await line.textContent())
  })

  await test.step(rowsEarly, async () => {
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
    await expect(syncing.locator('h2 + p')).toHaveText(/^Syncing \d+ of \d+ conversations\.$/)
    await expect(juno.sidebar.syncProgress).toHaveAttribute('aria-valuetext', /^\d+ of \d+ conversations$/)
    const early = await juno.home.kinds()

    // The sync ends: the rows shown stay first, in their order, and the syncing line goes.
    slack.fake.release({ method })
    await expect(syncing).toHaveCount(0, { timeout: 30_000 })
    expect((await juno.home.kinds()).slice(0, early.length)).toEqual(early)
    await expect(rows.first().getByRole('link')).toBeVisible()
  })

  await test.step(greets, async () => {
    // Once the history lands the first sync finishes: Home shows what waits and the line goes.
    slack.fake.release()
    await juno.waitForSync()
    await juno.home.expectShown()
    await expect(juno.home.greeting).toHaveText(/Tushar\.$/)
    await expect(progress).toHaveCount(0)
  })
})

test('Home shows what waits from the sidebar, and each row opens its topic', async ({ juno, slack, win, userData }) => {
  await win.clock.install()
  await juno.signIn()
  await juno.waitForSync()
  const { home, sidebar, topic, tabs } = juno

  // Home from the sidebar, with the question Elena asked.
  await home.open()
  await expect(home.greeting).toHaveText(/Tushar\.$/)
  // The thread's title, the root's words or its AI title once the job names it: Home shows it live.
  await expect(home.meta('waiting')).toHaveText(/^Rina finished the onsite.* · hiring · \d+m$/)
  await expect(home.navItem).toHaveAttribute('aria-current', 'page')
  // The assistant rewrites the title line after paint; the row keeps its height.
  await expect(home.title('waiting')).toHaveText('Elena asks: She has a competing offer with a Friday')
  expect((await home.item('waiting').boundingBox())?.height).toBeCloseTo(52, 1)

  // Waiting on you opens its thread.
  await home.openItem('waiting')
  await topic.expectTitle(RINA)

  // Moved a lot: nine replies since the user last read the thread.
  for (let n = 1; n <= 9; n++) slack.as('Leo').replyIn(STAGING, `Cost update ${n}.`)
  await sidebar.row(STAGING).expectPreview(/Cost update 9\./)
  // The title job can now finish before this flow reaches Home. Assert its settled title.
  await expect(sidebar.row(STAGING).root).toHaveAttribute('data-title-source', 'ai')
  await home.open()
  await expect(home.meta('moved')).toHaveText(/^Unrelated: has anyone looked at the · eng · \d+ new$/)
  await home.openItem('moved')
  await topic.expectTitle(STAGING)

  // Follow-up (AI assist on): the job finds the promise the user made to Sam; it opens the DM.
  await expect.poll(() => freshHome(juno, OFFSITE), { timeout: 30_000 }).toContain('followUp')
  await expect(home.title('followUp')).toHaveText("You said you'd review Dev's packet this week")
  await home.openItem('followUp')
  await topic.expectTitle('Sam')

  // Pick up where you left off: a topic open for a minute, then new messages.
  // The visit's minute runs on the page's clock; wait for its write before leaving.
  await sidebar.row(POSTGRES).open()
  await topic.expectTitle(POSTGRES)
  await win.clock.fastForward('01:05')
  await expect.poll(() => readUserDb(userData, slack.fake.teamId, (db) => db.prepare('SELECT topic_id FROM topic_visits ORDER BY seen_at DESC LIMIT 1').get()?.['topic_id'])).toBe(threadId(slack, POSTGRES))
  await sidebar.row(OFFSITE).open()
  await topic.expectTitle(OFFSITE)
  slack.as('Dev').replyIn(POSTGRES, 'Dry run is green. Ready for the window.')
  await expect.poll(() => freshHome(juno, OFFSITE), { timeout: 20_000 }).toContain('resume')
  await expect(home.meta('resume')).toHaveText(/^Draft plan is in the doc.* · eng · (now|\dm)$/)
  await home.openItem('resume')
  await topic.expectTitle(POSTGRES)
  await tabs.expectCount(1)
})

test('a DM set to Never leaves Home and returns when set to Auto', async ({ juno, slack }) => {
  await juno.signIn()
  await juno.waitForSync()
  slack.as('Maya').dm('Can you look at the hiring plan today?')

  const maya = juno.sidebar.row('Maya', { exact: true })
  await expect(maya.root).toBeVisible({ timeout: 30_000 })
  await maya.chooseInMenu('notify-never')
  await juno.home.open()
  await expect(juno.home.root.locator('a[href*="m%3AD0MAYA"]')).toHaveCount(0)

  await maya.chooseInMenu('notify-auto')
  await expect.poll(() => freshHome(juno, OFFSITE), { timeout: 30_000 }).toContain('waiting')
  await expect(juno.home.root.locator('a[href*="m%3AD0MAYA"]')).toBeVisible()
})

test("A Home row from a DM shows the person's photo and names them once; a channel's keeps its art", async ({ juno, slack }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { home } = juno

  // Elena's question in a #hiring thread: the tile is the thread's art, and the meta line has the thread and the channel.
  await home.open()
  await expect(home.meta('waiting')).toHaveText(/^Rina finished the onsite.* · hiring · \d+m$/)
  await expect(home.item('waiting').locator('[data-topic-art]')).toHaveCount(1)
  await expect(home.item('waiting').locator('img')).toHaveCount(0)

  // Maya asks in the DM: now the newest question. The tile is Maya's photo, as her DM's row in the sidebar, and she is named once.
  slack.as('Maya').dm('Can you look at the hiring plan today?')
  await expect
    .poll(async () => {
      await freshHome(juno, OFFSITE)
      return home.meta('waiting').textContent()
    }, { timeout: 30_000 })
    .toMatch(/^Maya /)
  await expect(home.meta('waiting')).toHaveText(/^Maya · (now|\d+m)$/)
  await expect(home.item('waiting').locator('[data-topic-art]')).toHaveCount(0)
  await expect(home.item('waiting').locator('img')).toHaveAttribute('src', /U0MAYA/)
})

test('Mark done clears a follow-up, and Resolve all resolves the settled topics with Undo', async ({ juno, fake, win }) => {
  // A second settled thread: the user answered Dev, and Dev thanked them two hours ago.
  const root = fake.workspace.post({ channel: 'C0INCIDENTS', user: 'U0DEV', text: 'The staging deploy keys need rotating before Friday', at: fake.now() - 3 * 3_600_000 })
  fake.workspace.post({ channel: 'C0INCIDENTS', threadTs: root.ts as never, user: SELF_ID, text: 'Rotated them this morning.', at: fake.now() - 150 * 60_000 })
  fake.workspace.post({ channel: 'C0INCIDENTS', threadTs: root.ts as never, user: 'U0DEV', text: 'Great, thanks', at: fake.now() - 2 * 3_600_000 })
  await juno.signIn()
  await juno.waitForSync()
  const { home, sidebar } = juno
  // Tidy up waits four hours of quiet by default; the incident thread went quiet 70 minutes ago.
  await juno.openSettings('Tidy up')
  await win.getByRole('radio', { name: '1 hour' }).click()

  await expect.poll(() => freshHome(juno, OFFSITE), { timeout: 30_000 }).toEqual(['waiting', 'followUp', 'tidyUp'])
  await expect(home.title('tidyUp')).toHaveText('2 topics look settled')
  await expect(home.meta('tidyUp')).toHaveText('incidents')

  await home.button('followUp', 'Mark done').click()
  await juno.expectToast('Follow-up done')
  // The row goes at once, even under the pointer: the user did it (home-live.spec.ts).
  await expect.poll(() => home.kinds()).toEqual(['waiting', 'tidyUp'])

  // Tidy up is live too: the follow-up just marked done can make its topic look settled, so read the count off the row.
  const settled = (await home.title('tidyUp').textContent())!.match(/^(\d+) topics look settled$/)![1]
  await home.button('tidyUp', 'Resolve all').click()
  await juno.expectToast(`Resolved ${settled} topics`)
  await sidebar.row(KEYS).expectAbsent()
  await juno.undoFromToast()
  await sidebar.row(KEYS).expectVisible()

  // Home again: the follow-up is still gone.
  expect(await freshHome(juno, POSTGRES)).not.toContain('followUp')
})

test('with AI assist off, Home shows the rules alone, with their plain titles and no Juno to write to, and the Juno tab says Juno is off', async ({ juno, fake, userData, relaunch }) => {
  await juno.signIn()
  await juno.waitForSync()
  const relaunched = await relaunch({
    whileClosed: () => {
      const db = new DatabaseSync(join(userData, 'workspaces', fake.teamId, 'user.db'))
      db.prepare(`INSERT INTO prefs (key, value_json) VALUES ('aiAssist', 'false') ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`).run()
      db.close()
    },
  })
  const { home, write } = relaunched
  // The relaunch restores the session first.
  await expect(home.navItem).toBeVisible({ timeout: 30_000 })
  await home.open()
  await expect(home.title('waiting')).toHaveText('Elena asked you something')
  expect(await home.kinds()).toEqual(['waiting'])
  // A completed background pass still contributes no AI items.
  await relaunched.workPass('home')
  await expect(home.title('waiting')).toHaveText('Elena asked you something')
  // Juno is an AI surface: Home's composer has no Juno to send to, and the Juno tab says Juno is off rather than asking for a model.
  await expect(write.chip).toHaveAccessibleName('Send to: Pick a conversation')
  await relaunched.win.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: /^Juno/ }).click()
  await expect(relaunched.win.locator('main').getByText('Juno is off. Turn on AI assist in Settings.')).toBeVisible()
  await expect(relaunched.win.locator('main [data-juno-no-provider]')).toHaveCount(0)
  await expect(relaunched.win.locator('main').getByText('What do you need?')).toHaveCount(0)
  await expect(relaunched.win.locator('main').getByRole('textbox', { name: /^Ask Juno/ })).toBeDisabled()

})
