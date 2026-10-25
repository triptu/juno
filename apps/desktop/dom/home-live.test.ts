// Home is live (SPEC 12, "Home is live"): what you do to a row shows at
// once, even under the pointer, and the next item takes the free place;
// the last row going shows the caught-up state without a new tab; changes
// from elsewhere show while Home is on screen, and wait while the pointer
// is over the rows.
import { SELF_ID, TEAM, type Workspace } from '@juno/fake-slack'
import type { Juno } from './driver/juno'
import { expect } from './expect'
import { domTest } from './test'

const DAY = 24 * 60 * 60 * 1000
const STAGING = 'Unrelated: has anyone looked at the'
const OFFSITE = 'Can eng take the Wednesday afternoon'
const KEYS = 'The staging deploy keys need rotating'

/** A resting place for the pointer on Home, off its rows. */
async function pointAway(juno: Juno): Promise<void> {
  await juno.home.root.hover()
}

// Follow-up and Tidy up come from the background AI jobs.
domTest('with AI assist on, Mark done and Resolve all take their row away at once, the next item fills in, and Undo puts it back', async ({ juno, slack, fake }) => {
  // Two settled threads for Tidy up: the user answered Dev, and Dev thanked them two hours ago.
  const root = fake.workspace.post({ channel: 'C0INCIDENTS', user: 'U0DEV', text: 'The staging deploy keys need rotating before Friday', at: fake.now() - 3 * 3_600_000 })
  fake.workspace.post({ channel: 'C0INCIDENTS', threadTs: root.ts as never, user: SELF_ID, text: 'Rotated them this morning.', at: fake.now() - 150 * 60_000 })
  fake.workspace.post({ channel: 'C0INCIDENTS', threadTs: root.ts as never, user: 'U0DEV', text: 'Great, thanks', at: fake.now() - 2 * 3_600_000 })
  await juno.signIn()
  await juno.waitForSync()
  const { home } = juno
  await juno.openSettings('Tidy up')
  await juno.win.getByRole('radio', { name: '1 hour' }).click()
  // Moved a lot: nine replies since the user last read the thread.
  for (let n = 1; n <= 9; n++) slack.as('Leo').replyIn(STAGING, `Cost update ${n}.`)
  await juno.sidebar.row(STAGING).expectPreview(/Cost update 9\./)

  // Home fills in as the jobs answer, with no new visit: four things want the user, three show.
  await juno.sidebar.row(OFFSITE).open()
  await home.open()
  await pointAway(juno)
  await expect.poll(() => home.kinds(), { timeout: 30_000 }).toEqual(['waiting', 'moved', 'followUp'])

  // Under the pointer, Mark done takes the row away at once and Tidy up takes the free place at the bottom.
  await home.button('followUp', 'Mark done').click()
  await juno.expectToast('Follow-up done')
  await expect.poll(() => home.kinds(), { timeout: 2_000 }).toEqual(['waiting', 'moved', 'tidyUp'])

  // Tidy up is live too: the follow-up just marked done can make its topic look settled, so read the count off the row.
  await expect(home.meta('tidyUp')).toContainText('incidents')
  const settled = (await home.title('tidyUp').textContent())!.match(/^(\d+) topics look settled$/)![1]
  await home.button('tidyUp', 'Resolve all').click()
  await expect.poll(() => home.kinds(), { timeout: 2_000 }).toEqual(['waiting', 'moved'])
  await juno.expectToast(`Resolved ${settled} topics`)
  await juno.sidebar.row(KEYS).expectAbsent()
  await juno.undoFromToast()
  await expect.poll(() => home.kinds(), { timeout: 5_000 }).toEqual(['waiting', 'moved', 'tidyUp'])
  await juno.sidebar.row(KEYS).expectVisible()
}, { synced: false, engine: { aiJobs: true }, timeout: 150_000 })

domTest('a new item shows while Home is on screen, and waits while the pointer is over the rows', async ({ juno, slack }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { home } = juno
  await home.open()
  await expect(home.meta('waiting')).toHaveText(/^Rina finished the onsite/)

  // The pointer is off the rows: Maya's question shows at once, with no new visit.
  await pointAway(juno)
  slack.as('Maya').dm('Can you look at the hiring plan today?')
  await expect(home.meta('waiting')).toHaveText(/^Maya · /, { timeout: 30_000 })

  // Moved a lot: nine replies since the user last read the thread.
  for (let n = 1; n <= 9; n++) slack.as('Leo').replyIn(STAGING, `Cost update ${n}.`)
  await expect(home.meta('moved')).toContainText('9 new', { timeout: 30_000 })

  // The pointer over the rows holds them: Sam's newer question waits. A row the hold keeps still changes in place,
  // and Leo's reply after Sam's question changes it, so the view that moves it to 10 new already has Sam's question.
  await home.item('waiting').hover()
  slack.as('Sam').dm('Can you send me the offsite agenda?')
  slack.as('Leo').replyIn(STAGING, 'Cost update 10.')
  await expect(home.meta('moved')).toContainText('10 new')
  await expect(home.meta('waiting')).toHaveText(/^Maya · /)

  // The pointer leaves: it shows in one step.
  await pointAway(juno)
  await expect(home.meta('waiting')).toHaveText(/^Sam · /)
}, { synced: false })

/** Leo asked a question in a DM; everything else is read. */
function oneQuestion(workspace: Workspace): void {
  const now = workspace.clock.now()
  for (const [id, name] of [[SELF_ID, 'Sam Ortiz'], ['U0LEO', 'Leo Park']] as const) {
    workspace.addUser({ id, team_id: TEAM.id, name, real_name: name, profile: { display_name: name } })
  }
  workspace.addConversation({ id: 'C0QUIET', name: 'general', kind: 'public', members: new Set([SELF_ID, 'U0LEO']), created: now - 90 * DAY, topic: '', purpose: '', isOpen: true, archived: false })
  const last = workspace.post({ channel: 'C0QUIET', user: 'U0LEO', text: 'Release notes are out.', at: now - 60 * 60_000, silent: true })
  workspace.reads.set('C0QUIET', last.ts)
  workspace.addConversation({ id: 'D0LEO', name: '', kind: 'im', members: new Set([SELF_ID, 'U0LEO']), created: now - 90 * DAY, topic: '', purpose: '', isOpen: true, archived: false })
  workspace.post({ channel: 'D0LEO', user: 'U0LEO', text: 'Can you check the release notes today?', at: now - 30 * 60_000 })
}

domTest('answering the last row shows the caught-up picture at once, with the DM still unread', async ({ juno, app }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { home, write } = juno
  await home.open()
  expect(await home.kinds()).toEqual(['waiting'])
  // When idle after Home paints, the next picture is downloaded and saved, so it is on disk before the row goes.
  await expect.poll(() => (JSON.parse(app.window.localStorage.getItem('juno.homePictures') ?? '{}') as { next?: { id?: string } }).next?.id ?? null, { timeout: 30_000 }).toBeTruthy()

  await write.composer.pressSequentially('@le')
  await expect(write.sendToOption('Leo')).toBeVisible()
  await write.composer.press('Tab')
  await write.expectDestination('Leo')
  await write.write('Yes, looking now.')
  await write.send()
  await juno.expectToast('Sent to Leo')
  await juno.tabs.expectActive('Home')
  // The answer takes the last row away, and the same Home is caught up: an unread message that asks nothing makes no row.
  await expect(home.root.locator('[data-home-item]')).toHaveCount(0)
  await expect(home.picture.locator('img')).toBeVisible()
}, { synced: false, fake: { seed: oneQuestion } })

// With no rows, the first Home is caught up even while a DM is unread: the engine's home-view flow test.
