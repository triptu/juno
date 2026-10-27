// Making and editing a channel (SPEC 5, "Channel sheet"): New channel… in ⌘K makes it in Slack with a
// member and opens its Main; Edit channel… on its Main renames it and removes the member; a name Slack
// refuses keeps the sheet open with the reason. How the sheet looks is the gallery's.
import { expect } from './expect'
import { domTest } from './test'

const SELF = 'U0TUSHAR'
const MAYA = 'U0MAYA'

// One launch: the channel the first step makes is the one the second edits.
domTest('channels: New channel in ⌘K makes it with a member and opens it; Edit channel renames it and removes the member; a refused name keeps the sheet open', async ({ juno, fake, step }) => {
  const { palette, topic, sidebar } = juno
  const created = () => [...fake.workspace.conversations.values()].find((c) => c.name.startsWith('launch-plan'))

  await step('New channel… takes the name as Slack will, invites the member picked, and opens the new Main ready to type', async () => {
    await palette.open()
    await palette.type('new channel')
    await palette.choose('New channel…')
    await palette.expectClosed()
    const sheet = juno.win.getByRole('dialog', { name: 'New channel' })
    await expect(sheet).toBeVisible()
    const name = sheet.getByRole('textbox', { name: 'Name' })
    await expect(name).toBeFocused()
    await name.pressSequentially('Launch Plan')
    await expect(name).toHaveValue('launch-plan')
    await sheet.getByRole('combobox', { name: 'Add people' }).fill('maya')
    await sheet.getByRole('option', { name: 'Maya Chen' }).click()
    await expect(sheet.getByRole('button', { name: 'Remove Maya Chen' })).toBeVisible()
    await sheet.getByRole('button', { name: 'Create' }).click()

    await expect(sheet).toHaveCount(0)
    await topic.expectTitle('launch-plan')
    await expect(topic.composer).toBeFocused()
    await juno.expectToast('Created #launch-plan')
    const writes = fake.calls.filter((call) => call.method === 'conversations.create' || call.method === 'conversations.invite')
    expect(writes.map((call) => [call.method, call.args['name'] ?? call.args['users']])).toEqual([
      ['conversations.create', 'launch-plan'],
      ['conversations.invite', MAYA],
    ])
    expect([...(created()?.members ?? [])].toSorted()).toEqual([MAYA, SELF].toSorted())
  })

  await step('Edit channel… on its Main renames it everywhere and removes the member in Slack', async () => {
    const channel = created()!.id
    // Maya's message gives the channel a sidebar row.
    fake.injectMessage({ channel, user: MAYA, text: 'Kickoff notes are in the doc' })
    await sidebar.row('#launch-plan').expectVisible()

    await topic.chooseInMenu('edit-channel')
    const sheet = juno.win.getByRole('dialog', { name: 'Edit channel' })
    await expect(sheet).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'Remove Maya Chen' })).toBeVisible()
    await sheet.getByRole('textbox', { name: 'Name' }).fill('launch-plan-q3')
    await sheet.getByRole('button', { name: 'Remove Maya Chen' }).click()
    await expect(sheet.getByRole('button', { name: 'Remove Maya Chen' })).toHaveCount(0)
    await sheet.getByRole('button', { name: 'Save' }).click()

    await expect(sheet).toHaveCount(0)
    await sidebar.row('#launch-plan-q3').expectVisible()
    await topic.expectTitle('launch-plan-q3')
    await juno.expectToast('Saved #launch-plan-q3')
    await expect.poll(() => created()?.name).toBe('launch-plan-q3')
    await expect.poll(() => [...(created()?.members ?? [])]).toEqual([SELF])
  })

  await step('a name Slack refuses keeps the sheet open with the reason, and nothing is made', async () => {
    const before = fake.workspace.conversations.size
    // A name no channel has: the last Conversations row offers it.
    await palette.open()
    await palette.press('Meta+2')
    await palette.expectTab('Conversations')
    await palette.type('Design Crit')
    await palette.choose('New channel “#design-crit”…')
    const sheet = juno.win.getByRole('dialog', { name: 'New channel' })
    await expect(sheet.getByRole('textbox', { name: 'Name' })).toHaveValue('design-crit')
    // Slack also counts people's and user groups' names as taken.
    fake.forceError({ method: 'conversations.create', error: 'name_taken' })
    await sheet.getByRole('button', { name: 'Create' }).click()
    await expect(sheet.getByRole('alert')).toHaveText('That name is taken.')
    await expect(sheet).toBeVisible()
    expect(fake.workspace.conversations.size).toBe(before)
  })
})
