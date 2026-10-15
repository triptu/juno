// Home (SPEC section 12, docs/design/home/): what wants the user, shown with
// no tab open and from the sidebar's Home item; each kind of row opens its
// topic; Mark done and Resolve all with Undo; and Home with AI assist off.
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
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

test('Home shows what waits with no tab open and from the sidebar, and each row opens its topic', async ({ juno, slack, win }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { home, sidebar, topic, tabs } = juno

  // No tab open: Home, with the question Elena asked.
  await home.expectShown()
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

test('with AI assist off, Home shows the rules alone, with their plain titles', async ({ juno, fake, slackApp, userData, running }) => {
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
    await expect(home.greeting).toBeVisible({ timeout: 30_000 })
    await expect(home.title('waiting')).toHaveText('Elena asked you something')
    expect(await home.kinds()).toEqual(['waiting'])
    // Nothing arrives later either.
    await again.win.waitForTimeout(3_000)
    await expect(home.title('waiting')).toHaveText('Elena asked you something')
    await expect(home.ask).toBeVisible()
  } finally {
    await again.close()
  }
})
