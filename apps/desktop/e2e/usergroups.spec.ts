// User group mentions: Slack sends a bare `<!subteam^S…>`, and Juno names it
// "@handle" from `usergroups.list` in Main, in a thread and in the sidebar
// preview. The raw id never shows; a deleted group keeps its old handle; a
// rename arrives as `subteam_updated`.
import { expect, test } from './fixtures'

test.describe.configure({ timeout: 90_000 })

const POSTGRES = 'Draft plan is in the doc'
const ENG_MAIN = '#eng'

test('a user group mention shows its handle, never its id, in Main, a thread and the sidebar preview', async ({ juno, fake, slack }) => {
  fake.setSelfUsergroups({ ids: ['S0PLATFORM'] })
  slack.as('Maya').replyIn(POSTGRES, '<!subteam^S0PLATFORM> can someone review the cutover runbook?')
  fake.injectMessage({ channel: 'C0ENG', user: 'U0LEO', text: 'Old pager notes from <!subteam^S0OLDOPS> are archived.' })
  fake.injectMessage({ channel: 'C0ENG', user: 'U0LEO', text: '<!subteam^S0DESIGN> the new icons are ready for review.' })
  await juno.signIn()
  await juno.waitForSync()
  const { sidebar, topic } = juno

  await expect(sidebar.row(ENG_MAIN).preview).toContainText('@design-crew the new icons', { timeout: 15_000 })
  await expect(sidebar.row(POSTGRES).preview).toContainText('@platform can someone review', { timeout: 15_000 })
  await expect(sidebar.root).not.toContainText(/S0PLATFORM|S0DESIGN/)

  await sidebar.row(ENG_MAIN).open()
  await topic.expectTitle('Main')
  const design = topic.message('the new icons are ready').locator('[data-usergroup="S0DESIGN"]')
  await expect(design).toHaveText('@design-crew')
  await expect(design).toHaveAttribute('title', 'Design crew')
  // Deleted, and still named.
  await expect(topic.message('Old pager notes').locator('[data-usergroup="S0OLDOPS"]')).toHaveText('@old-ops')

  await sidebar.row(POSTGRES).open()
  await topic.expectTitle(POSTGRES)
  const platform = topic.message('can someone review the cutover runbook').locator('[data-usergroup="S0PLATFORM"]')
  await expect(platform).toHaveText('@platform')
  await expect(platform).toHaveAttribute('title', 'Platform team')
  await expect(topic.root).not.toContainText('S0PLATFORM')

  // A rename from another client reaches the open thread.
  fake.putUsergroup({ id: 'S0PLATFORM', handle: 'platform-core', name: 'Platform core' })
  await expect(platform).toHaveText('@platform-core')
})
