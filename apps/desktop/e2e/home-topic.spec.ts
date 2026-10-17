// Home's topic chip (spec section 12, "Writing"): right of the destination
// chip while a person or channel is chosen, Main by default, a thread to
// reply in it. It hides for Juno and goes back to Main when the destination
// changes.
import { expect, test } from './fixtures'

test.describe.configure({ timeout: 120_000 })

/** #eng's Postgres thread, titled by its root's first words with AI off. */
const POSTGRES = 'Draft plan is in the doc'
const REPLY = 'Dry run notes are in the staging channel'

test('a thread chosen in the topic chip takes the send as a reply there, and the topic shows it', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { write, tabs, topic, sidebar } = juno

  // Juno has no topics.
  await write.expectDestination('Juno')
  await expect(write.topicChip).toHaveCount(0)

  await write.pickConversation('eng', 'eng')
  await write.expectTopic('Main')
  await expect(write.composer).toHaveAttribute('placeholder', 'Message #eng')

  // Tab order: the destination chip, the topic chip, then the field.
  await write.chip.focus()
  await write.chip.press('Tab')
  await expect(write.topicChip).toBeFocused()
  await write.topicChip.press('Tab')
  await expect(write.composer).toBeFocused()

  // ↓ opens the list on the chip: Main first, then the channel's threads. Esc gives focus back to the chip.
  await write.composer.press('Shift+Tab')
  await write.topicChip.press('ArrowDown')
  await expect(write.topicSearch).toBeFocused()
  await expect(write.topicList.getByRole('option').first()).toHaveAccessibleName(/^Main/)
  await expect(write.topicOption(POSTGRES)).toBeVisible()
  await write.topicSearch.press('Escape')
  await expect(write.topicChip).toBeFocused()

  // A key typed on the closed chip goes into the field.
  await write.topicChip.press('D')
  await expect(write.composer).toBeFocused()
  await expect(write.composer).toHaveValue('D')
  await write.composer.fill('')

  await write.pickTopic('draft', POSTGRES)
  await write.expectTopic(POSTGRES)
  await write.expectDestination('#eng')
  await expect(write.composer).toBeFocused()
  await expect(write.composer).toHaveAttribute('placeholder', `Reply in ${POSTGRES}`)

  await write.write(REPLY)
  await write.send()
  await juno.expectToast(`Replied in ${POSTGRES}`)
  await tabs.expectActive('Home')
  await write.expectDestination('Juno')
  await expect(write.topicChip).toHaveCount(0)

  // The reply is in the thread, not a new root in Main.
  const root = fake.messages('C0ENG').find((message) => message.text?.startsWith(POSTGRES) === true)!
  await expect.poll(() => fake.messages('C0ENG').find((message) => message.text === REPLY)?.thread_ts).toBe(root.ts)
  await sidebar.row(POSTGRES).open()
  await topic.expectTitle(POSTGRES)
  await topic.expectMessage(REPLY)
})

test('the topic chip hides for Juno and goes back to Main when the destination changes', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { write } = juno

  await write.pickConversation('eng', 'eng')
  await write.pickTopic('draft', POSTGRES)
  await write.expectTopic(POSTGRES)
  const chip = await write.chip.boundingBox()
  const field = await write.field.boundingBox()

  // Another destination: back to its Main.
  await write.pickConversation('maya', 'Maya')
  await write.expectDestination('Maya')
  await write.expectTopic('Main')
  await expect(write.composer).toHaveAttribute('placeholder', 'Message Maya')

  // Juno: the chip leaves, and the destination chip and the field stay where they were.
  await write.composer.press('Backspace')
  await write.expectDestination('Juno')
  await expect(write.topicChip).toHaveCount(0)
  expect((await write.chip.boundingBox())?.x).toBe(chip?.x)
  expect(await write.field.boundingBox()).toEqual(field)

  // Back to #eng: Main again, not the thread chosen before.
  await write.pickConversation('eng', 'eng')
  await write.expectTopic('Main')
})
