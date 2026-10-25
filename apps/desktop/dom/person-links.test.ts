// A deactivated person (spec section 7, "People"): their name in a message
// opens your DM with them read-only, and with no DM it offers no link. The
// press, drag and keyboard rules are the browser lane's (person-links.spec.ts).
import { expect } from './expect'
import { domTest } from './test'

const POSTGRES = 'Draft plan is in the doc'

domTest("a deactivated person's DM opens read-only; with no DM they offer no link", async ({ juno, fake }) => {
  const root = fake.messages('C0ENG').find((message) => message.text?.includes(POSTGRES))!
  const reply = (user: string, text: string) => fake.workspace.post({ channel: 'C0ENG', user, threadTs: root.ts, text, silent: true })
  for (const id of ['U0SAM', 'U0PRIYA']) (fake.workspace.users.get(id) as unknown as { deleted: boolean }).deleted = true
  reply('U0SAM', 'Sam signing off: handing the dry run to Dev.')
  reply('U0PRIYA', 'Priya here: runbook links are pinned.')
  await juno.signIn()
  await juno.waitForSync()
  const { tabs, topic } = juno
  await juno.sidebar.row(POSTGRES).open()
  await topic.expectTitle(POSTGRES)

  const link = (text: string) => topic.message(text).locator('[data-message-header] [data-opens-person]')
  await expect(topic.message('Priya here')).toBeVisible()
  await expect(link('Priya here')).toHaveCount(0)
  await link('Sam signing off').click()
  await tabs.expectActive('Sam')
  await expect(topic.message('Notes from today')).toBeVisible()
  await expect(topic.composer).toHaveCount(0)
  await expect(topic.root.getByText(/^Sam.*'s account is deactivated\. You can read this conversation but not reply\.$/)).toBeVisible()
}, { synced: false })
