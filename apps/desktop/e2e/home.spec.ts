// Home (SPEC section 12, docs/design/home/): what wants the user, shown with
// no tab open and from the sidebar's Home item; each kind of row opens its
// topic; Mark done and Resolve all with Undo; Home with AI assist off; and
// the caught-up state, which has no link of its own (All topics is in the sidebar).
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { SELF_ID, startFakeSlack, TEAM } from '@juno/fake-slack'
import { expect, launchApp, test } from './fixtures'
import { Juno } from './driver/juno'

test.describe.configure({ timeout: 150_000 })

/** Home reads its items when it appears: show a topic, then Home again. */
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

test('During the first sync Home greets and says it is syncing, and the sidebar shows how far it got', async ({ juno, slack, win }) => {
  // The first conversation's history waits, as a real workspace's backfill takes minutes.
  slack.fake.holdNext({ method: 'conversations.history' })
  await juno.signIn()
  // A launch opens a New chat tab; Home is one click away.
  await juno.home.navItem.click()
  const syncing = win.locator('[data-home][data-home-loading]')
  await expect(syncing.getByRole('heading', { level: 2 })).toHaveText(/Tushar\.$/, { timeout: 30_000 })
  await expect(syncing.getByText('Syncing with Slack.')).toBeVisible()
  await expect(syncing.getByText('All caught up.')).toHaveCount(0)
  const progress = juno.sidebar.syncStatus
  await expect(progress).toHaveText('Syncing with Slack')
  await expect(juno.sidebar.syncProgress).toHaveAttribute('aria-valuetext', /^0 of \d+ conversations$/)

  // Once the history lands the first sync finishes: Home shows what waits and the line goes.
  slack.fake.release()
  await juno.waitForSync()
  await juno.home.expectShown()
  await expect(juno.home.greeting).toHaveText(/Tushar\.$/)
  await expect(progress).toHaveCount(0)
})

test('Home shows rows before the first sync ends', async ({ juno, slack, win }) => {
  const method = 'conversations.history'
  slack.fake.holdNext({ method })
  await juno.signIn()
  // A launch opens a New chat tab; Home is one click away.
  await juno.home.navItem.click()
  const syncing = win.locator('[data-home][data-home-loading]')
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
  await expect(syncing.getByText('Syncing with Slack.')).toBeVisible()
  await expect(juno.sidebar.syncProgress).toHaveAttribute('aria-valuetext', /^\d+ of \d+ conversations$/)
  const early = await juno.home.kinds()

  // The sync ends: the rows shown stay first, in their order, and the count line replaces the syncing one.
  slack.fake.release({ method })
  await expect(syncing).toHaveCount(0, { timeout: 30_000 })
  expect((await juno.home.kinds()).slice(0, early.length)).toEqual(early)
  await expect(win.locator('[data-home]').getByText(/wants? you\.$/)).toBeVisible()
  await expect(rows.first().getByRole('link')).toBeVisible()
})

test('Home shows what waits from the sidebar, and each row opens its topic', async ({ juno, slack, win }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { home, sidebar, topic, tabs } = juno

  // Home from the sidebar, with the question Elena asked.
  await home.open()
  await expect(home.greeting).toHaveText(/Tushar\.$/)
  await expect(home.meta('waiting')).toHaveText(/^Rina finished the onsite\. Panel notes… · hiring · \d+m$/)
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
  await home.open()
  await expect(home.meta('moved')).toHaveText(/^Unrelated: has anyone looked at the… · eng · \d+ new$/)
  await home.openItem('moved')
  await topic.expectTitle(STAGING)

  // Follow-up (AI assist on): the job finds the promise the user made to Sam; it opens the DM.
  await expect.poll(() => freshHome(juno, OFFSITE), { timeout: 30_000 }).toContain('followUp')
  await expect(home.title('followUp')).toHaveText("You said you'd review Dev's packet this week")
  await home.openItem('followUp')
  await topic.expectTitle('Sam')

  // Pick up where you left off: a topic open for a minute, then new messages.
  // The visit's minute runs on the page's clock, so install the fake one before the topic opens.
  await win.clock.install()
  await sidebar.row(POSTGRES).open()
  await topic.expectTitle(POSTGRES)
  await win.clock.fastForward('01:05')
  await sidebar.row(OFFSITE).open()
  await topic.expectTitle(OFFSITE)
  slack.as('Dev').replyIn(POSTGRES, 'Dry run is green. Ready for the window.')
  await expect.poll(() => freshHome(juno, OFFSITE), { timeout: 20_000 }).toContain('resume')
  await expect(home.meta('resume')).toHaveText(/^Draft plan is in the doc.* · eng · (now|\dm)$/)
  await home.openItem('resume')
  await topic.expectTitle(POSTGRES)
  await tabs.expectCount(1)
})

test('Mark done clears a follow-up, and Resolve all resolves the settled topics with Undo', async ({ juno, fake, slack }) => {
  // A second settled thread: a closing reply five minutes ago, idle long enough to score.
  const staging = slack.root(STAGING)
  fake.workspace.post({ channel: staging.channel, threadTs: staging.ts as never, user: 'U0JONAS', text: 'Reaper is live. Done, thanks all.', at: fake.now() - 5 * 60_000 })
  await juno.signIn()
  await juno.waitForSync()
  const { home, sidebar } = juno

  await expect.poll(() => freshHome(juno, OFFSITE), { timeout: 30_000 }).toEqual(['waiting', 'followUp', 'tidyUp'])
  await expect(home.title('tidyUp')).toHaveText('2 topics look settled')
  await expect(home.meta('tidyUp')).toContainText('Unrelated: has anyone looked at the…')

  await home.button('followUp', 'Mark done').click()
  await juno.expectToast('Follow-up done')
  await expect(home.button('followUp', 'Mark done')).toHaveCount(0)
  // The row stays while Home is on screen, so nothing moves under the pointer.
  expect(await home.kinds()).toEqual(['waiting', 'followUp', 'tidyUp'])

  await home.button('tidyUp', 'Resolve all').click()
  await juno.expectToast('Resolved 2 topics')
  await sidebar.row(STAGING).expectAbsent()
  await juno.undoFromToast()
  await sidebar.row(STAGING).expectVisible()

  // Home again: the follow-up is gone.
  expect(await freshHome(juno, POSTGRES)).not.toContain('followUp')
})

test('with AI assist off, Home shows the rules alone, with their plain titles and no Ask Juno, and the Juno tab says Juno is off', async ({ juno, fake, slackApp, userData, running }) => {
  await juno.signIn()
  await juno.waitForSync()
  await running.close()
  const db = new DatabaseSync(join(userData, 'workspaces', fake.teamId, 'user.db'))
  db.prepare(`INSERT INTO prefs (key, value_json) VALUES ('aiAssist', 'false') ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`).run()
  db.close()

  const again = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword })
  try {
    const { home } = new Juno(again.app, again.win)
    // The relaunch restores the session first.
    await expect(home.navItem).toBeVisible({ timeout: 30_000 })
    await home.open()
    await expect(home.title('waiting')).toHaveText('Elena asked you something')
    expect(await home.kinds()).toEqual(['waiting'])
    // Nothing arrives later either.
    await again.win.waitForTimeout(3_000)
    await expect(home.title('waiting')).toHaveText('Elena asked you something')
    // Ask Juno is an AI surface: it is left out, and the Juno tab says Juno is off rather than asking for a model.
    await expect(home.ask).toHaveCount(0)
    await again.win.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: /^Juno/ }).click()
    await expect(again.win.locator('main').getByText('Juno is off. Turn on AI assist in Settings.')).toBeVisible()
    await expect(again.win.locator('main [data-juno-no-provider]')).toHaveCount(0)
    await expect(again.win.locator('main').getByText('What do you need?')).toHaveCount(0)
    await expect(again.win.locator('main').getByRole('textbox', { name: /^Ask Juno/ })).toBeDisabled()
  } finally {
    await again.close()
  }
})

/** A workspace where everything is read and nobody waits: Home is caught up. */
const quiet = test.extend({
  // oxlint-disable-next-line no-empty-pattern
  fake: async ({}, use) => {
    const fake = await startFakeSlack({
      seed: (workspace, avatarBase) => {
        const now = workspace.clock.now()
        for (const [id, name] of [[SELF_ID, 'Tushar'], ['U0LEO', 'Leo Park']] as const) {
          workspace.addUser({ id, team_id: TEAM.id, name, real_name: name, profile: { display_name: name, image_72: `${avatarBase}/${id}.svg` } })
        }
        workspace.addConversation({ id: 'C0QUIET', name: 'general', kind: 'public', members: new Set([SELF_ID, 'U0LEO']), created: now, topic: '', purpose: '', isOpen: true, archived: false })
        const last = workspace.post({ channel: 'C0QUIET', user: 'U0LEO', text: 'Release notes are out.', at: now - 60 * 60_000, silent: true })
        workspace.reads.set('C0QUIET', last.ts)
      },
    })
    await use(fake)
    await fake.close()
  },
})

quiet('caught up, Home says so and leaves All topics to the sidebar', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { home } = juno
  await home.open()
  await expect(home.greeting).toHaveText('All caught up.')
  await expect(home.root.getByText('Nothing is waiting on you.')).toBeVisible()
  expect(await home.kinds()).toEqual([])
  await expect(home.root.getByRole('button', { name: 'Browse all topics' })).toHaveCount(0)
})
