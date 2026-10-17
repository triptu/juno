// The preview line's name and text (spec section 5, "Row anatomy"): a
// message with only an image reads "Image"; the other side of a one-to-one
// DM has no name, yours read "You:"; a channel shows a first name, with a
// last initial when two people there share it.
import { SELF_ID, TEAM } from '@juno/fake-slack'
import { test } from './fixtures'

// A failing test attaches the sidebar's order hold and topic list values (README, "Sidebar trace").
test.use({ sidebarTrace: true })

test.describe.configure({ timeout: 120_000 })

test('previews name people by first name, drop the other side of a DM, and label an image', async ({ juno, fake }) => {
  for (const [id, name, real] of [
    ['U0ALEXK', 'alexk', 'Alex Kim'],
    ['U0ALEXR', 'alexr', 'Alex Rivera'],
    ['U0ROBIN', 'robin', 'Robin Okafor'],
  ] as const) {
    fake.workspace.addUser({ id, team_id: TEAM.id, name, real_name: real, profile: { display_name: real, real_name: real } })
  }
  fake.workspace.post({ channel: 'D0MAYA', user: 'U0MAYA', text: '', files: [{ id: 'F0SIDEPIC', name: 'whiteboard.png', title: 'whiteboard.png', mimetype: 'image/png' }], silent: true })
  fake.workspace.post({ channel: 'D0SAM', user: SELF_ID, text: 'Sent the notes', silent: true })
  fake.workspace.post({ channel: 'C0ENG', user: 'U0ALEXR', text: 'Deploy window moved', silent: true })
  fake.workspace.post({ channel: 'C0ENG', user: 'U0ALEXK', text: 'Works for me', silent: true })
  fake.workspace.post({ channel: 'C0PRODUCT', user: 'U0ROBIN', text: 'Pricing copy is final', silent: true })

  await juno.signIn()
  await juno.waitForSync()
  const { sidebar } = juno
  await sidebar.row('Maya', { exact: true }).expectPreview('Image')
  await sidebar.row('Sam', { exact: true }).expectPreview('You: Sent the notes')
  await sidebar.row('#product').expectPreview('Robin: Pricing copy is final')
  await sidebar.row('#eng').expectPreview('Alex K: Works for me')
})
