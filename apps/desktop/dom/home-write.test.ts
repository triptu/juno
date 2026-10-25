// Writing from Home (spec section 12, "Writing"): Home from the sidebar and its tabs, a draft
// kept when a topic opens over Home, "Draft closed" with Undo, and a new thread whose root
// Slack refuses, with a reply queued behind it.
import { expect } from './expect'
import { domTest } from './test'

const POSTGRES = 'Draft plan is in the doc'
const OFFSITE = 'Can eng take the Wednesday afternoon'
/** Shares no two words with any #eng thread, so the wrong-place check never stops the send, however soon it answers. */
const DRAFT = 'Lunch order goes out at noon'

domTest('Home opens from the sidebar in the current tab, a plain open focuses its tab and ⌘-click opens another, and Home keeps its draft when a topic opens over it', async ({ juno, step }) => {
  const { write, tabs, sidebar, topic, nav } = juno
  const home = juno.home.navItem

  await step('Home opens from the sidebar in the current tab; a plain open focuses its tab and ⌘-click opens another', async () => {
    // A fresh launch shows one Home tab, selected.
    await juno.expectNothingOpen()
    await expect(home).toHaveAttribute('aria-current', 'page')

    await sidebar.row(POSTGRES).open()
    await topic.expectTitle(POSTGRES)
    await expect(home).not.toHaveAttribute('aria-current', 'page')

    await home.click()
    await tabs.expectActive('Home')
    await tabs.expectCount(1)
    await expect(home).toHaveAttribute('aria-current', 'page')
    await juno.home.expectShown()
    await nav.back()
    await topic.expectTitle(POSTGRES)

    // A plain open focuses the tab that shows Home.
    await sidebar.row(OFFSITE).openInNewTab()
    await tabs.select(POSTGRES)
    await home.click()
    await tabs.expectActive('Home')
    await tabs.select(OFFSITE)
    await home.click()
    await tabs.expectCount(2)
    await tabs.expectActive('Home')

    // ⌘-click opens a second Home.
    await home.click({ modifiers: ['Meta'] })
    await tabs.expectCount(3)
    await expect(tabs.tab('Home')).toHaveCount(2)
    await tabs.expectActiveAt('Home', 1)
    await juno.home.expectShown()
  })

  await step('Home keeps its draft and destination when a topic opens over it, and Back brings them back', async () => {
    await write.pickConversation('ma', 'Maya')
    await write.write('A long thought I do not want to lose')
    await sidebar.row(POSTGRES).open()
    await topic.expectTitle(POSTGRES)
    await nav.back()
    await expect(write.composer).toHaveValue('A long thought I do not want to lose')
    await write.expectDestination('Maya')
  })
})

domTest('closing Home with a draft shows "Draft closed" and Undo brings it back; a new thread whose root fails stays with Not sent and Retry, and a queued reply follows it', async ({ juno, fake, step }) => {
  const { write, tabs, topic, sidebar } = juno

  await step('closing Home with a draft shows "Draft closed", and Undo brings the tab back with its draft', async () => {
    await write.pickConversation('ma', 'Maya')
    await write.write(DRAFT)
    await tabs.closeAt('Home', 0)
    await juno.expectToast('Draft closed')
    // The last tab closed, so a fresh Home took its place.
    await expect(write.composer).toHaveValue('')
    await write.expectDestination('Juno')

    await juno.undoFromToast()
    await expect(tabs.tab('Home')).toHaveCount(2)
    await expect(write.composer).toHaveValue(DRAFT)
    await write.expectDestination('Maya')
    await expect(write.composer).toBeFocused()
  })

  await step('a new thread whose root fails stays in the sidebar with Not sent and Retry, and a queued reply follows it', async () => {
    await write.pickConversation('eng', 'eng')
    fake.forceError({ method: 'chat.postMessage', error: 'restricted_action', times: 1 })
    await write.write('first')
    await write.send()
    await expect(sidebar.row('first').root).toBeVisible()
    await sidebar.row('first').open()
    await topic.expectTitle('first')
    await expect(topic.failed('first').row).toContainText('Not sent.')
    await topic.send('second')
    await expect(topic.message('second')).toHaveAttribute('data-pending', 'sending')
    expect(fake.messages('C0ENG').some((message) => message.text === 'second')).toBe(false)
    await topic.failed('first').retry()
    await topic.expectSent('first')
    await topic.expectSent('second')
    await topic.expectTitle('first')
    const root = fake.messages('C0ENG').find((message) => message.text === 'first')!
    expect(fake.messages('C0ENG').find((message) => message.text === 'second')?.thread_ts).toBe(root.ts)
  })
})
