// Home's topic chip (spec section 12, "Writing"): right of the destination
// chip while a person or channel is chosen, Main by default, a thread to
// reply in it. It hides for Juno and goes back to Main when the destination
// changes. A reply from Home opens its thread in a tab behind Home, once.
import type { DomContext } from './test'
import { expect } from './expect'
import { domTest } from './test'

type Context = Pick<DomContext, 'juno' | 'fake'>

const startsWith = (text: string) => expect.stringMatching(new RegExp(`^${text}`))

/** #eng's Postgres thread, titled by its root's first words with AI off. */
const POSTGRES = 'Draft plan is in the doc'
const REPLY = 'Dry run notes are in the staging channel'

domTest('sends to a chosen thread, once in its tab behind Home, and resets the topic chip when the destination changes', async ({ juno, fake, step }) => {
  const context = { juno, fake }
  await step('a thread chosen in the topic chip takes the send as a reply there, and the topic shows it', () => sendToThread(context))
  await step('a second reply in the thread opens no second tab, and the tab shows both', () => replyAgain(context))
  await step('the topic chip hides for Juno and goes back to Main when the destination changes', () => changeDestination(context))
}, { timeout: 120_000 })

async function sendToThread({ juno, fake }: Context): Promise<void> {
  const { write, tabs } = juno

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

  // ↓ opens the list on the chip: Main first, then the channel's threads. Esc back to the chip and a key typed on it are
  // in the browser lane (`e2e/break-pass-1017b.spec.ts`).
  await write.composer.press('Shift+Tab')
  await write.topicChip.press('ArrowDown')
  await expect(write.topicSearch).toBeFocused()
  await expect(write.topicList.getByRole('option').first()).toHaveAccessibleName(/^Main/)
  await expect(write.topicOption(POSTGRES)).toBeVisible()
  await write.topicSearch.press('Escape')

  await write.pickTopic('draft', POSTGRES)
  await write.expectTopic(POSTGRES)
  await write.expectDestination('#eng')
  await expect(write.composer).toBeFocused()
  await expect(write.composer).toHaveAttribute('placeholder', `Reply in ${POSTGRES}`)

  await write.write(REPLY)
  await write.send()
  await juno.expectToast(`Replied in ${POSTGRES}`)
  // The thread opens in a tab behind Home.
  await expect.poll(() => tabs.titles()).toEqual(['Home', startsWith(POSTGRES)])
  await tabs.expectActive('Home')
  await write.expectDestination('Juno')
  await expect(write.topicChip).toHaveCount(0)

  // The reply is in the thread, not a new root in Main.
  const root = fake.messages('C0ENG').find((message) => message.text?.startsWith(POSTGRES) === true)!
  await expect.poll(() => fake.messages('C0ENG').find((message) => message.text === REPLY)?.thread_ts).toBe(root.ts)
}

async function replyAgain({ juno, fake }: Context): Promise<void> {
  const { write, tabs, topic } = juno
  await write.pickConversation('eng', 'eng')
  await write.pickTopic('draft', POSTGRES)
  await write.write('Rollback steps are in the doc too')
  await write.send()
  await expect.poll(() => fake.messages('C0ENG').find((message) => message.text === 'Rollback steps are in the doc too')?.thread_ts).toBeDefined()
  await write.pickConversation('maya', 'Maya')
  await write.write('Plan is updated')
  await write.send()
  await juno.expectToast('Sent to Maya')
  await expect.poll(() => tabs.titles()).toEqual(['Home', startsWith('Maya'), startsWith(POSTGRES)])
  await tabs.expectActive('Home')

  // The background tab shows the thread with both replies once chosen.
  await tabs.select(POSTGRES)
  await topic.expectTitle(POSTGRES)
  await topic.expectMessage(REPLY)
  await topic.expectMessage('Rollback steps are in the doc too')
  await tabs.select('Home')
}

async function changeDestination({ juno }: Pick<Context, 'juno'>): Promise<void> {
  await juno.tabs.menu('new-message')
  const { write } = juno

  await write.pickConversation('eng', 'eng')
  await write.pickTopic('draft', POSTGRES)
  await write.expectTopic(POSTGRES)

  // Another destination: back to its Main.
  await write.pickConversation('maya', 'Maya')
  await write.expectDestination('Maya')
  await write.expectTopic('Main')
  await expect(write.composer).toHaveAttribute('placeholder', 'Message Maya')

  // Juno: the chip leaves.
  await write.composer.press('Backspace')
  await write.expectDestination('Juno')
  await expect(write.topicChip).toHaveCount(0)

  // Back to #eng: Main again, not the thread chosen before.
  await write.pickConversation('eng', 'eng')
  await write.expectTopic('Main')
}
