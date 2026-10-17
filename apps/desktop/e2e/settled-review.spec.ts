// Tidy up's review (SPEC 12, docs/design/settled-suggestions/): Home's card
// opens a sheet with every topic that looks settled and why; one Resolve
// with Undo on the row; Keep open with R and K from the keyboard; Resolve
// all; What Resolve does, which leads to Settings › Tidy up; and a topic
// kept open is not suggested again.
import { SELF_ID } from '@juno/fake-slack'
import { expect, test } from './fixtures'
import type { Juno } from './driver/juno'

test.describe.configure({ timeout: 150_000 })
// Settled scores come from the background AI jobs.
test.use({ aiJobs: true })

const INCIDENT = 'p95 on /v2/search jumped'
const KEYS = 'The staging deploy keys need rotating'
const POSTGRES = 'Draft plan is in the doc'

/** Home reads its items when it appears: show a topic, then Home again. */
async function freshHome(juno: Juno): Promise<string[]> {
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.expectTitle(POSTGRES)
  await juno.home.open()
  return juno.home.kinds()
}

test('the review shows why each topic looks settled; Resolve, Undo, Keep open and Resolve all work per row', async ({ juno, fake, win }) => {
  // Dev's thread: the user answered, and Dev thanked them two hours ago.
  const root = fake.workspace.post({ channel: 'C0INCIDENTS', user: 'U0DEV', text: 'The staging deploy keys need rotating before Friday', at: fake.now() - 3 * 3_600_000 })
  fake.workspace.post({ channel: 'C0INCIDENTS', threadTs: root.ts as never, user: SELF_ID, text: 'Rotated them this morning.', at: fake.now() - 150 * 60_000 })
  fake.workspace.post({ channel: 'C0INCIDENTS', threadTs: root.ts as never, user: 'U0DEV', text: 'Great, thanks', at: fake.now() - 2 * 3_600_000 })
  await juno.signIn()
  await juno.waitForSync()

  // The default waits four hours of quiet; the incident thread went quiet 70 minutes ago.
  await juno.openSettings('Tidy up')
  await expect(win.getByText('Nothing is posted to Slack.', { exact: false })).toBeVisible()
  await win.getByRole('radio', { name: '1 hour' }).click()

  await expect.poll(() => freshHome(juno), { timeout: 60_000 }).toContain('tidyUp')
  await expect(juno.home.title('tidyUp')).toHaveText('2 topics look settled')
  await expect(juno.home.meta('tidyUp')).toHaveText('incidents')

  const sheet = await juno.home.review()
  await expect(sheet.title).toHaveText('2 topics look settled')
  // Each reason comes from the last messages, not from the model.
  await expect(sheet.reason(INCIDENT)).toHaveText('Ended with your thank-you')
  await expect(sheet.reason(KEYS)).toHaveText('Ended with a thank-you from Dev')

  // What Resolve does says what happens in Slack, and leads to Settings.
  await sheet.about.click()
  await expect(sheet.explainer).toContainText('Nothing is posted to Slack.')
  // The info covers the top of the list; the button closes it again.
  await sheet.about.click()

  // One Resolve: the row stays and says so, and the row's Undo brings it back. The sidebar holds behind the sheet (SPEC 5).
  await sheet.act(KEYS).click()
  await expect(sheet.row(KEYS)).toHaveAttribute('data-review-status', 'done')
  await juno.expectToast('Resolved · The staging deploy keys need rotating')
  await juno.sidebar.row(KEYS).expectVisible()
  await sheet.undo(KEYS).click()
  await expect(sheet.row(KEYS)).toHaveAttribute('data-review-status', 'open')
  await juno.sidebar.row(KEYS).expectVisible()

  // The keyboard: the first row has focus; K keeps it open and moves on.
  await sheet.row(INCIDENT).getByRole('link').focus()
  await win.keyboard.press('k')
  await expect(sheet.row(INCIDENT)).toHaveAttribute('data-review-status', 'declined')
  await juno.expectToast('Keeping open · ')
  await expect(sheet.row(KEYS).getByRole('link')).toBeFocused()

  // Resolve all takes only what is still open.
  await sheet.all.click()
  await juno.expectToast('Resolved 1 topic')
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

test('Enter opens a proposal in the tab and closes the review; Tidy up settings opens Settings', async ({ juno, fake, win }) => {
  const root = fake.workspace.post({ channel: 'C0INCIDENTS', user: 'U0DEV', text: 'The staging deploy keys need rotating before Friday', at: fake.now() - 3 * 3_600_000 })
  fake.workspace.post({ channel: 'C0INCIDENTS', threadTs: root.ts as never, user: SELF_ID, text: 'Rotated them this morning.', at: fake.now() - 150 * 60_000 })
  fake.workspace.post({ channel: 'C0INCIDENTS', threadTs: root.ts as never, user: 'U0DEV', text: 'Great, thanks', at: fake.now() - 2 * 3_600_000 })
  await juno.signIn()
  await juno.waitForSync()
  await juno.openSettings('Tidy up')
  await win.getByRole('radio', { name: '1 hour' }).click()
  await expect.poll(() => freshHome(juno), { timeout: 60_000 }).toContain('tidyUp')

  let sheet = await juno.home.review()
  await sheet.row(KEYS).getByRole('link').focus()
  await win.keyboard.press('Enter')
  await expect(sheet.root).toHaveCount(0)
  await juno.topic.expectTitle(KEYS)

  await juno.home.open()
  sheet = await juno.home.review()
  await sheet.about.click()
  await sheet.explainer.getByRole('button', { name: 'Tidy up settings' }).click()
  await expect(sheet.root).toHaveCount(0)
  await expect(juno.settings.section('Tidy up')).toHaveAttribute('aria-current', 'page')
})
