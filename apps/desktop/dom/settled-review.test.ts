// Tidy up's review (SPEC 12, docs/design/settled-suggestions/): Home's card
// opens a sheet with every topic that looks settled and why; one Resolve
// with Undo on the row; Keep open with R and K from the keyboard; Enter
// opens a proposal; Resolve all; What Resolve does, which leads to
// Settings › Tidy up; and a topic kept open is not suggested again. Settled
// scores come from the background AI jobs, so it signs in.
import { SELF_ID } from '@juno/fake-slack'
import type { Juno } from './driver/juno'
import { expect } from './expect'
import { domTest } from './test'

const INCIDENT = 'P95 on /v2/search jumped'
const KEYS = 'The staging deploy keys need rotating'
const POSTGRES = 'Draft plan is in the doc'

/** Home reads its items when it appears: show a topic, then Home again. */
async function freshHome(juno: Juno): Promise<string[]> {
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.expectTitle(POSTGRES)
  await juno.home.open()
  return juno.home.kinds()
}

domTest('the review opens a proposal and Settings, shows why each topic looks settled, and Resolve, Undo, Keep open and Resolve all work per row', async ({ juno, fake, step }) => {
  const { win } = juno
  // Dev's thread: the user answered, and Dev thanked them two hours ago.
  const root = fake.workspace.post({ channel: 'C0INCIDENTS', user: 'U0DEV', text: 'The staging deploy keys need rotating before Friday', at: fake.now() - 3 * 3_600_000 })
  fake.workspace.post({ channel: 'C0INCIDENTS', threadTs: root.ts as never, user: SELF_ID, text: 'Rotated them this morning.', at: fake.now() - 150 * 60_000 })
  fake.workspace.post({ channel: 'C0INCIDENTS', threadTs: root.ts as never, user: 'U0DEV', text: 'Great, thanks', at: fake.now() - 2 * 3_600_000 })
  await juno.signIn()
  await juno.waitForSync()
  // The title job capitalizes p95. Use its settled title throughout the review flow.
  await expect(juno.sidebar.row(INCIDENT).root).toHaveAttribute('data-title-source', 'ai')

  // The default waits four hours of quiet; the incident thread went quiet 70 minutes ago.
  await juno.openSettings('Tidy up')
  await win.getByRole('radio', { name: '1 hour' }).click()

  await expect.poll(() => freshHome(juno), { timeout: 60_000 }).toContain('tidyUp')
  await expect(juno.home.meta('tidyUp')).toHaveText('incidents')

  // These steps only open and close the sheet: they act on no row, so both topics are still proposed below.
  await step('Enter opens a proposal in the tab and closes the review', async () => {
    const sheet = await juno.home.review()
    await sheet.row(KEYS).getByRole('link').focus()
    await win.keyboard.press('Enter')
    await expect(sheet.root).toHaveCount(0)
    await juno.topic.expectTitle(KEYS)
  })
  await step('Tidy up settings in What Resolve does opens Settings', async () => {
    await juno.home.open()
    const sheet = await juno.home.review()
    await sheet.about.click()
    await sheet.explainer.getByRole('button', { name: 'Tidy up settings' }).click()
    await expect(sheet.root).toHaveCount(0)
    await expect(juno.settings.section('Tidy up')).toHaveAttribute('aria-current', 'page')
  })

  await juno.home.open()
  const sheet = await juno.home.review()
  // Each reason comes from the last messages, not from the model.
  await expect(sheet.reason(INCIDENT)).toHaveText('Ended with your thank-you')
  await expect(sheet.reason(KEYS)).toHaveText('Ended with a thank-you from Dev')

  // What Resolve does opens and closes from its button.
  await sheet.about.click()
  await expect(sheet.explainer).toBeVisible()
  await sheet.about.click()

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
  await juno.expectToast('Keeping open')
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
}, { synced: false, engine: { aiJobs: true }, timeout: 120_000 })
