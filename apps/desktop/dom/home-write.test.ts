// Writing from Home (spec section 12, "Writing"): Juno by default, a first @ or # that suggests
// a destination without taking over, the destination list, sends that leave Home in place, a
// first DM opened with conversations.open, Home from the sidebar and its tabs, a draft kept when
// a topic opens over Home, "Draft closed" with Undo, and a new thread whose root Slack refuses,
// with a reply queued behind it. ⌘N and "+" are in `break-pass-1017b.test.ts`.
import { expect } from './expect'
import { domTest, type DomContext } from './test'

type Context = Pick<DomContext, 'juno' | 'fake' | 'slack' | 'step'>

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

domTest('writes from Home to people and channels, keeps text and read state, and opens a first DM', async ({ juno, fake, slack, step }) => {
  const context = { juno, fake, slack, step }
  await step('Home has no Recent section; a first @ suggests a person, Tab makes them the destination, and the send stays on Home with the field in place', () => sendToPerson(context))
  await step('a first # or @ stays text for Juno on Space or Esc, and Backspace in an empty field goes back to Juno', () => keepPrefixText(context))
  await step('choosing a destination never marks anything read', () => keepDestinationUnread(context))
  await step('a send Slack refuses says why in a toast, and the draft and destination stay', () => refusedSend(context))
  await step('a person never messaged: chosen from the list, then conversations.open on send', () => openFirstDm(context))
  await step('a send to a channel starts a thread there, shows it in the sidebar, and Home stays', () => startChannelThread(context))
}, { timeout: 120_000 })

async function sendToPerson({ juno, fake }: Pick<Context, 'juno' | 'fake'>): Promise<void> {
  fake.resetCalls()

  const { write, tabs } = juno

  // A launch opens Home, ready to ask Juno. People and channels come from a first @ or #, the chip's list and search; Home lists none of its own.
  await juno.expectNothingOpen()
  await write.expectDestination('Juno')
  await expect(juno.home.root.getByText('Recent', { exact: true })).toHaveCount(0)
  await expect(juno.home.root.getByRole('list', { name: /^(People|Channels)$/ })).toHaveCount(0)

  await write.composer.pressSequentially('@ma')
  await expect(write.sendToOption('Maya')).toBeVisible()
  await write.composer.press('Tab')
  await write.expectDestination('Maya')
  // The typed @ma left the text and went into the chip.
  await expect(write.composer).toHaveValue('')
  await expect(write.composer).toBeFocused()
  await expect(write.sendTo).toHaveCount(0)

  await write.write(DRAFT)
  // That the field holds still through the send is the browser lane's (`e2e/break-pass-1017.spec.ts`, the narrow window).
  await write.send()
  await expect.poll(() => fake.calls.filter((call) => call.method === 'chat.postMessage').map((call) => call.args['channel'])).toEqual(['D0MAYA'])
  await expect.poll(() => fake.messages('D0MAYA').some((message) => message.text === DRAFT)).toBe(true)
  await juno.expectToast('Sent to Maya')
  // Home stays: the field is empty and back on Juno, where it was.
  await tabs.expectActive('Home')
  await expect(write.composer).toHaveValue('')
  await write.expectDestination('Juno')
}

async function keepPrefixText({ juno, step }: Pick<Context, 'juno' | 'step'>): Promise<void> {
  const { write } = juno
  await step('Space keeps a first # as text for Juno', async () => {
    await write.composer.pressSequentially('#eng')
    await expect(write.sendToOption('eng')).toBeVisible()
    await write.composer.pressSequentially(' what happened today?')
    await expect(write.sendTo).toHaveCount(0)
    await write.expectDestination('Juno')
    await expect(write.composer).toHaveValue('#eng what happened today?')
  })
  // An empty field again, so the next @ is a first @.
  await write.composer.fill('')
  await step('Esc keeps a first @ for Juno, and Backspace in an empty field goes back to Juno', async () => {
    await write.composer.pressSequentially('@ma')
    await expect(write.sendTo).toBeVisible()
    await write.composer.press('Escape')
    await expect(write.sendTo).toHaveCount(0)
    await write.expectDestination('Juno')
    await expect(write.composer).toHaveValue('@ma')

    await write.composer.fill('')
    await write.pickConversation('ma', 'Maya')
    await write.expectDestination('Maya')
    await expect(write.composer).toBeFocused()
    await write.composer.press('Backspace')
    await write.expectDestination('Juno')
  })
}

async function keepDestinationUnread({ juno, slack }: Pick<Context, 'juno' | 'slack'>): Promise<void> {
  const { write, sidebar } = juno

  slack.as('Leo').postIn('eng', 'Replica lag is under a second now')
  const engMain = sidebar.row('#eng')
  await engMain.expectPreview(/Replica lag is under a second now/)
  const unread = Number(await engMain.root.locator('[title$=" unread"]').textContent())
  expect(unread).toBeGreaterThan(0)
  slack.resetCalls()

  await write.pickConversation('eng', 'eng')
  await write.expectDestination('#eng')
  await slack.expectNoMarks()
  await engMain.expectUnread(unread)
}

async function refusedSend({ juno, fake }: Pick<Context, 'juno' | 'fake'>): Promise<void> {
  fake.resetCalls()

  const { write } = juno

  await write.pickConversation('jon', 'Jonas')
  fake.forceError({ method: 'conversations.open', error: 'user_disabled' })
  await write.write('Welcome aboard')
  await write.send()
  await juno.expectToast('Not sent · Their account is deactivated')
  await expect(write.composer).toHaveValue('Welcome aboard')
  await write.expectDestination('Jonas')
  expect(fake.calls.some((call) => call.method === 'chat.postMessage')).toBe(false)
}

async function openFirstDm({ juno, fake }: Pick<Context, 'juno' | 'fake'>): Promise<void> {
  fake.resetCalls()

  const { write } = juno

  await write.chip.click()
  await write.search.fill('jon')
  await expect(write.option('Jonas')).toContainText('No messages yet')
  await write.option('Jonas').click()
  await write.expectDestination('Jonas')
  expect(fake.calls.some((call) => call.method === 'conversations.open')).toBe(false)

  await write.write('Welcome aboard. Your laptop arrives Monday.')
  await write.send()
  await juno.expectToast('Sent to Jonas')
  await expect.poll(() => fake.calls.filter((call) => call.method === 'conversations.open').map((call) => call.args['users'])).toEqual(['U0JONAS'])
  await expect.poll(() => fake.calls.find((call) => call.method === 'chat.postMessage')?.args['channel']).toBeDefined()
  const posted = fake.calls.find((call) => call.method === 'chat.postMessage')
  expect(fake.workspace.conversation(String(posted?.args['channel']))?.kind).toBe('im')
}

async function startChannelThread({ juno, fake }: Pick<Context, 'juno' | 'fake'>): Promise<void> {
  fake.resetCalls()

  const { write, tabs, topic, sidebar } = juno

  await write.pickConversation('eng', 'eng')
  await write.expectDestination('#eng')
  await expect(write.composer).toBeFocused()
  await write.write(DRAFT)
  await write.send()
  await juno.expectToast('Sent to #eng')
  await tabs.expectActive('Home')
  await write.expectDestination('Juno')
  await expect(sidebar.row(DRAFT).root).toBeVisible()
  await expect.poll(() => fake.messages('C0ENG').some((message) => message.text === DRAFT)).toBe(true)

  // The row takes Slack's id once the send is confirmed and mounts again, so the open retries until it lands on the settled row.
  await expect.poll(async () => {
    await sidebar.row(DRAFT).open()
    return topic.message(DRAFT).count()
  }, { timeout: 30_000 }).toBeGreaterThan(0)
  await expect(topic.composer).toHaveAttribute('placeholder', 'Reply')
  await topic.send('second')
  await topic.expectSent('second')
  const root = fake.messages('C0ENG').find((message) => message.text === DRAFT)!
  // The first message is the thread's root: Slack gives a root with replies its own ts as thread_ts.
  expect(root.thread_ts ?? root.ts).toBe(root.ts)
  expect(fake.messages('C0ENG').find((message) => message.text === 'second')?.thread_ts).toBe(root.ts)
}
