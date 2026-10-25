// User group mentions: Slack sends a bare `<!subteam^S…>`, and Juno shows it as a chip with the group's
// "@handle" and its name as the title. Which handle, in Main, a thread, the sidebar, for a deleted group and
// after a rename, is engine data (message-content.flow.test.ts); this checks the chip draws it.
import { expect, test } from './fixtures'

test.use({ synced: true })

test('a user group mention shows as a chip with its handle and name, never its id', async ({ juno, fake }) => {
  fake.injectMessage({ channel: 'C0ENG', user: 'U0LEO', text: '<!subteam^S0DESIGN> the new icons are ready for review.' })
  await juno.sidebar.row('#eng').open()
  await juno.topic.expectTitle('Main')
  const design = juno.topic.message('the new icons are ready').locator('[data-usergroup="S0DESIGN"]')
  await expect(design).toHaveText('@design-crew')
  await expect(design).toHaveAttribute('title', 'Design crew')
  await expect(juno.topic.root).not.toContainText('S0DESIGN')
})
