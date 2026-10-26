// Home is live (SPEC 12, "Home is live"): what you do to a row shows at once, even under the pointer,
// and the next item takes the free place; changes from elsewhere show while Home is on screen, and
// wait while the pointer is over the rows. ⌘T during the first sync opens a usable Home. Tidy up's
// review (docs/design/settled-suggestions/): Home's card opens a sheet with every topic that looks
// settled; one Resolve with Undo on the row, Keep open with K, Enter opens a proposal, Resolve all,
// and a topic kept open is not suggested again. Why each looks settled is the engine's.
import { SELF_ID } from '@juno/fake-slack'
import type { FakeSlack } from '@juno/fake-slack'
import type { Juno } from './driver/juno'
import { expect } from './expect'
import { domTest } from './test'

const STAGING = 'Unrelated: has anyone looked at the'
const OFFSITE = 'Can eng take the Wednesday afternoon'
const KEYS = 'The staging deploy keys need rotating'
const INCIDENT = 'P95 on /v2/search jumped'
const POSTGRES = 'Draft plan is in the doc'

/** A resting place for the pointer on Home, off its rows. */
async function pointAway(juno: Juno): Promise<void> {
  await juno.home.root.hover()
}

/** Home reads its items when it appears: show a topic, then Home again. */
async function freshHome(juno: Juno): Promise<string[]> {
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.expectTitle(POSTGRES)
  await juno.home.open()
  return juno.home.kinds()
}

/** Dev's thread: the user answered, and Dev thanked them two hours ago, so it looks settled. */
function settledThread(fake: FakeSlack): void {
  const root = fake.workspace.post({ channel: 'C0INCIDENTS', user: 'U0DEV', text: 'The staging deploy keys need rotating before Friday', at: fake.now() - 3 * 3_600_000 })
  fake.workspace.post({ channel: 'C0INCIDENTS', threadTs: root.ts as never, user: SELF_ID, text: 'Rotated them this morning.', at: fake.now() - 150 * 60_000 })
  fake.workspace.post({ channel: 'C0INCIDENTS', threadTs: root.ts as never, user: 'U0DEV', text: 'Great, thanks', at: fake.now() - 2 * 3_600_000 })
}

// Follow-up and Tidy up come from the background AI jobs.
domTest('with AI assist on, Mark done and Resolve all take their row away at once and Undo puts it back, and Tidy up\'s review resolves, keeps and undoes per row', async ({ juno, slack, fake, step }) => {
  settledThread(fake)
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

  await step('Tidy up\'s review opens a proposal, and Resolve, Undo, Keep open and Resolve all work per row', async () => {
    const { win } = juno
    // The title job capitalizes p95. Use its settled title throughout the review flow.
    await expect(juno.sidebar.row(INCIDENT).root).toHaveAttribute('data-title-source', 'ai')

    await expect.poll(() => freshHome(juno), { timeout: 60_000 }).toContain('tidyUp')

    // These steps only open and close the sheet: they act on no row, so both topics are still proposed below.
    await step('Enter opens a proposal in the tab and closes the review', async () => {
      const sheet = await juno.home.review()
      await sheet.row(KEYS).getByRole('link').focus()
      await win.keyboard.press('Enter')
      await expect(sheet.root).toHaveCount(0)
      await juno.topic.expectTitle(KEYS)
    })

    await juno.home.open()
    const sheet = await juno.home.review()
    // One Resolve: the row stays and says so, and the row's Undo brings it back. The sidebar holds behind the sheet (SPEC 5).
    await sheet.act(KEYS).click()
    await expect(sheet.row(KEYS)).toHaveAttribute('data-review-status', 'done')
    await juno.expectToast('Resolved')
    await juno.sidebar.row(KEYS).expectVisible()
    await sheet.undo(KEYS).click()
    await expect(sheet.row(KEYS)).toHaveAttribute('data-review-status', 'open')
    await juno.sidebar.row(KEYS).expectVisible()

    // The keyboard: the first row has focus; K keeps it open and moves on.
    await sheet.row(INCIDENT).getByRole('link').focus()
    await win.keyboard.press('k')
    await expect(sheet.row(INCIDENT)).toHaveAttribute('data-review-status', 'declined')
    await expect(sheet.row(KEYS).getByRole('link')).toBeFocused()

    // Resolve all takes only what is still open.
    await sheet.all.click()
    await expect(sheet.row(KEYS)).toHaveAttribute('data-review-status', 'done')
    await juno.sidebar.row(KEYS).expectVisible()

    // Esc closes and the resolved topic leaves the sidebar; nothing is left open, so the card's Resolve all is gone.
    await win.keyboard.press('Escape')
    await expect(sheet.root).toHaveCount(0)
    await juno.sidebar.row(KEYS).expectAbsent()
    await juno.sidebar.row(INCIDENT).expectVisible()
    await expect(juno.home.button('tidyUp', 'Resolve all')).toHaveCount(0)

    // The kept topic is not suggested again until someone writes in it, and the resolved one is gone.
    expect(await freshHome(juno)).not.toContain('tidyUp')
  })
}, { synced: false, engine: { aiJobs: true }, timeout: 150_000 })

domTest('⌘T during the first sync opens a usable Home, and a new item shows while Home is on screen but waits while the pointer is over the rows', async ({ juno, fake, slack, step }) => {
  await step('⌘T during the first sync opens a usable Home, each with its own draft', async () => {
    fake.holdNext({ method: 'conversations.history' })
    await juno.signIn()
    await expect(juno.write.composer).toBeVisible()
    await juno.tabs.expectCount(1)
    await expect(juno.sidebar.root.getByRole('status', { name: 'Sync status' })).toHaveText(/^Syncing/, { timeout: 30_000 })
    // ⌘T opens a Home beside the launch tab's, every time, each with its own draft.
    await juno.tabs.menu('new-tab')
    await juno.tabs.expectCount(2)
    await expect(juno.write.composer).toBeFocused()
    await juno.write.write('Written during sync')
    await juno.tabs.menu('new-tab')
    await juno.tabs.expectCount(3)
    await expect(juno.write.composer).toBeFocused()
    await expect(juno.write.composer).toHaveValue('')
    fake.release()
    await juno.waitForSync()
    await juno.tabs.selectAt('Home', 1)
    await expect(juno.write.composer).toHaveValue('Written during sync')
    await juno.write.pickConversation('eng', 'eng')
    await juno.write.send()
    await expect.poll(() => fake.messages('C0ENG').filter((m) => m.text === 'Written during sync').length).toBe(1)
    await juno.tabs.contextMenu('Home', 'close-all')
    await juno.expectNothingOpen()
  })

  await step('a new item shows while Home is on screen, and waits while the pointer is over the rows', async () => {
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
  })
}, { synced: false })
