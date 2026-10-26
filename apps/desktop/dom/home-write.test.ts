// Writing from Home (spec section 12, "Writing"): Juno by default, a first @ or # that suggests a
// destination without taking over, the destination list, sends that leave Home in place and open
// their topic in a tab behind it once, a first DM opened with conversations.open, a reply in a
// thread chosen in the topic chip, a send Slack refuses, a new thread whose root Slack refuses with
// a reply queued behind it, and text typed while a send waits. Then Home from the keyboard: ⌘N,
// "+", keys typed fast or on its chips, a paste right after ⌘T, Home from the sidebar and its tabs,
// and a draft kept when a topic opens over Home or the tab closes.
import type { Juno } from './driver/juno'
import { expect } from './expect'
import { domTest, type DomContext } from './test'

type Context = Pick<DomContext, 'juno' | 'fake' | 'slack' | 'app'>

const POSTGRES = 'Draft plan is in the doc'
const OFFSITE = 'Can eng take the Wednesday afternoon'
/** Shares no two words with any #eng thread, so the wrong-place check never stops the send, however soon it answers. */
const DRAFT = 'Lunch order goes out at noon'
const REPLY = 'Dry run notes are in the staging channel'

const startsWith = (text: string) => expect.stringMatching(new RegExp(`^${text}`))

/** Closes every tab, which leaves one empty Home, as a fresh launch shows it. */
async function freshHome(juno: Juno): Promise<void> {
  const [first] = await juno.tabs.titles()
  await juno.tabs.contextMenu(first!, 'close-all')
  await juno.expectNothingOpen()
  await expect(juno.write.composer).toHaveValue('')
}

// One launch: each step starts from one empty Home tab.
domTest('writes from Home to people, channels and threads, keeps text and read state, opens a first DM, and opens each topic once behind Home', async ({ juno, fake, slack, app, step }) => {
  const context = { juno, fake, slack, app }
  await step('a first @ suggests a person, Tab makes them the destination, and the send stays on Home with the field in place', () => sendToPerson(context))
  await step('a first # or @ stays text for Juno on Space or Esc, and Backspace in an empty field goes back to Juno', () => keepPrefixText(context))
  await step('choosing a destination never marks anything read', () => keepDestinationUnread(context))
  await step('a send Slack refuses says why in a toast, and the draft and destination stay', () => refusedSend(context))
  await step('a person never messaged: chosen from the list, then conversations.open on send, and text typed while it waits stays in the field', () => openFirstDm(context))
  await step('a send to a channel starts a thread there, shows it in the sidebar, and Home stays', () => startChannelThread(context))
  await step('a new thread whose root fails stays with Not sent and Retry, and a queued reply follows it', () => failedRoot(context))
  await step('a thread chosen in the topic chip takes the send as a reply there, once in its tab behind Home', () => sendToThread(context))
  await step('a send opens its topic behind Home, right after it, once; and goes when another tab is chosen before its checks answer', () => sendTabs(context))
}, { timeout: 120_000 })

async function sendToPerson({ juno, fake }: Context): Promise<void> {
  fake.resetCalls()
  const { write, tabs } = juno

  // A launch opens Home, ready to ask Juno. People and channels come from a first @ or #, the chip's list and search.
  await juno.expectNothingOpen()
  await write.expectDestination('Juno')

  await write.composer.pressSequentially('@ma')
  await expect(write.sendToOption('Maya')).toBeVisible()
  await write.composer.press('Tab')
  await write.expectDestination('Maya')
  // The typed @ma left the text and went into the chip.
  await expect(write.composer).toHaveValue('')
  await expect(write.composer).toBeFocused()
  await expect(write.sendTo).toHaveCount(0)

  await write.write(DRAFT)
  await write.send()
  await expect.poll(() => fake.calls.filter((call) => call.method === 'chat.postMessage').map((call) => call.args['channel'])).toEqual(['D0MAYA'])
  await expect.poll(() => fake.messages('D0MAYA').some((message) => message.text === DRAFT)).toBe(true)
  await juno.expectToast('Sent to Maya')
  // Home stays: the field is empty and back on Juno, where it was.
  await tabs.expectActive('Home')
  await expect(write.composer).toHaveValue('')
  await write.expectDestination('Juno')
  await freshHome(juno)
}

async function keepPrefixText({ juno }: Context): Promise<void> {
  const { write } = juno
  // Space keeps a first # as text for Juno.
  await write.composer.pressSequentially('#eng')
  await expect(write.sendToOption('eng')).toBeVisible()
  await write.composer.pressSequentially(' what happened today?')
  await expect(write.sendTo).toHaveCount(0)
  await write.expectDestination('Juno')
  await expect(write.composer).toHaveValue('#eng what happened today?')

  // Esc keeps a first @ for Juno, and Backspace in an empty field goes back to Juno.
  await write.composer.fill('')
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
}

async function keepDestinationUnread({ juno, slack }: Context): Promise<void> {
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
  await write.composer.press('Backspace')
  await write.expectDestination('Juno')
}

async function refusedSend({ juno, fake }: Context): Promise<void> {
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
  fake.clearError({ method: 'conversations.open' })
  await write.composer.fill('')
  await write.composer.press('Backspace')
  await write.expectDestination('Juno')
}

async function openFirstDm({ juno, fake }: Context): Promise<void> {
  fake.resetCalls()
  const { write, win } = juno

  await write.chip.click()
  await write.search.fill('jon')
  await expect(write.option('Jonas')).toContainText('No messages yet')
  await write.option('Jonas').click()
  await write.expectDestination('Jonas')
  expect(fake.calls.some((call) => call.method === 'conversations.open')).toBe(false)

  fake.holdNext({ method: 'conversations.open', before: true })
  await write.write('Welcome aboard. Your laptop arrives Monday.')
  await write.send()
  await expect.poll(() => fake.heldCount({ method: 'conversations.open' })).toBe(1)
  await win.keyboard.type('Next one')
  fake.release({ method: 'conversations.open' })
  await juno.expectToast('Sent to Jonas')
  await expect.poll(() => fake.calls.filter((call) => call.method === 'conversations.open').map((call) => call.args['users'])).toEqual(['U0JONAS'])
  await expect.poll(() => fake.calls.filter((call) => call.method === 'chat.postMessage').map((call) => call.args['text'])).toEqual(['Welcome aboard. Your laptop arrives Monday.'])
  const posted = fake.calls.find((call) => call.method === 'chat.postMessage')
  expect(fake.workspace.conversation(String(posted?.args['channel']))?.kind).toBe('im')
  await expect(write.composer).toHaveValue('Next one')
  await write.expectDestination('Juno')
  await write.composer.fill('')
  await freshHome(juno)
}

async function startChannelThread({ juno, fake }: Context): Promise<void> {
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
  await freshHome(juno)
}

async function failedRoot({ juno, fake }: Context): Promise<void> {
  const { write, topic, sidebar } = juno
  await write.pickConversation('eng', 'eng')
  fake.forceError({ method: 'chat.postMessage', error: 'restricted_action', times: 1 })
  await write.write('first')
  await write.send()
  await expect(sidebar.row('first').root).toBeVisible()
  await sidebar.row('first').open()
  await topic.expectTitle('first')
  await expect(topic.failed('first').row).toContainText('Not sent.')
  await topic.send('second reply')
  await expect(topic.message('second reply')).toHaveAttribute('data-pending', 'sending')
  expect(fake.messages('C0ENG').some((message) => message.text === 'second reply')).toBe(false)
  await topic.failed('first').retry()
  await topic.expectSent('first')
  await topic.expectSent('second reply')
  await topic.expectTitle('first')
  const root = fake.messages('C0ENG').find((message) => message.text === 'first')!
  expect(fake.messages('C0ENG').find((message) => message.text === 'second reply')?.thread_ts).toBe(root.ts)
  await freshHome(juno)
}

async function sendToThread({ juno, fake }: Context): Promise<void> {
  const { write, tabs, topic } = juno

  // Juno has no topics.
  await write.expectDestination('Juno')
  await expect(write.topicChip).toHaveCount(0)
  await write.pickConversation('eng', 'eng')
  await write.expectTopic('Main')

  // ↓ opens the list on the chip: Main first, then the channel's threads. Esc back to the chip is the browser lane's.
  await write.composer.press('Shift+Tab')
  await write.topicChip.press('ArrowDown')
  await expect(write.topicSearch).toBeFocused()
  await expect(write.topicList.getByRole('option').first()).toHaveAccessibleName(/^Main/)
  await write.topicSearch.press('Escape')

  await write.pickTopic('draft', POSTGRES)
  await write.expectTopic(POSTGRES)
  await write.expectDestination('#eng')
  await expect(write.composer).toBeFocused()
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

  // A second reply opens no second tab, and the tab shows both.
  await write.pickConversation('eng', 'eng')
  await write.pickTopic('draft', POSTGRES)
  await write.write('Rollback steps are in the doc too')
  await write.send()
  await expect.poll(() => fake.messages('C0ENG').find((message) => message.text === 'Rollback steps are in the doc too')?.thread_ts).toBeDefined()
  await expect.poll(() => tabs.titles()).toEqual(['Home', startsWith(POSTGRES)])
  await tabs.select(POSTGRES)
  await topic.expectTitle(POSTGRES)
  await topic.expectMessage(REPLY)
  await topic.expectMessage('Rollback steps are in the doc too')
  await tabs.select('Home')

  // Another destination goes back to its Main, and Juno hides the chip.
  await write.pickConversation('eng', 'eng')
  await write.pickTopic('draft', POSTGRES)
  await write.pickConversation('maya', 'Maya')
  await write.expectTopic('Main')
  await write.composer.press('Backspace')
  await write.expectDestination('Juno')
  await expect(write.topicChip).toHaveCount(0)
  await freshHome(juno)
}

async function sendTabs({ juno, fake, app }: Context): Promise<void> {
  const { write, tabs, sidebar } = juno

  // Home, then a topic in a second tab; back on Home.
  await sidebar.row(POSTGRES).openInNewTab()
  await tabs.expectCount(2)
  await tabs.select('Home')
  await tabs.expectActive('Home')

  await write.pickConversation('maya', 'Maya')
  await write.write('Lunch order goes out at one')
  await write.send()
  await juno.expectToast('Sent to Maya')
  await expect.poll(() => tabs.titles()).toEqual(['Home', startsWith('Maya'), startsWith(POSTGRES)])
  await tabs.expectActive('Home')

  // Again to Maya: her tab is there, so nothing new opens.
  await write.pickConversation('maya', 'Maya')
  await write.write('And dessert at two')
  await write.send()
  await expect.poll(() => fake.messages('D0MAYA').some((message) => message.text === 'And dessert at two')).toBe(true)

  // A send to someone else opens theirs right after Home. Tabs open in order, so a second Maya tab would be here by now.
  await write.pickConversation('jon', 'Jonas')
  await write.write('Welcome to the team')
  await write.send()
  await juno.expectToast('Sent to Jonas')
  await expect.poll(() => tabs.titles()).toEqual(['Home', startsWith('Jonas'), startsWith('Maya'), startsWith(POSTGRES)])
  await tabs.expectActive('Home')

  // A send from Home goes when another tab is chosen before its checks answer.
  await tabs.menu('new-tab')
  await tabs.expectActiveAt('Home', 1)
  await write.pickConversation('maya', 'Maya')
  await write.write('Sent as the tab was left')
  // The first Home tab is chosen in the same task as Enter, before the wrong-place check can answer.
  const first = await tabs.nth('Home', 0).element()
  app.window.addEventListener('keydown', (event) => {
    if ((event as unknown as KeyboardEvent).key === 'Enter') first.click()
  }, { once: true })
  await write.send()
  await tabs.expectActiveAt('Home', 0)
  await expect.poll(() => fake.messages('D0MAYA').filter((m) => m.text === 'Sent as the tab was left').length).toBe(1)
}

// One launch: each step starts from one empty Home tab, and leaves Home as it found it.
domTest('Home from the keyboard: ⌘N, "+", fast keys, keys on its chips, a paste after ⌘T, its tabs from the sidebar, and drafts it keeps', async ({ juno, fake, step }) => {
  await step('⌘N, Enter right after typing picks, Shift Tab to the chips, and the send leaves the new thread in a tab behind Home', async () => {
    // ⌘N opens Home's destination list with its search focused.
    await juno.tabs.menu('new-message')
    await expect(juno.write.search).toBeFocused()
    // As a person types once the list shows its search: Enter at once picks the match.
    await juno.win.keyboard.type('eng')
    await juno.win.keyboard.press('Enter')
    await juno.write.expectDestination('#eng')
    await expect(juno.write.composer).toBeFocused()
    await juno.win.keyboard.type('Keyboard only')
    // Shift Tab reaches the topic chip, then the destination chip (Attach files is out of the Tab order); Enter opens its list.
    await juno.win.keyboard.press('Shift+Tab')
    await expect(juno.write.topicChip).toBeFocused()
    await juno.win.keyboard.press('Shift+Tab')
    await expect(juno.write.chip).toBeFocused()
    await juno.win.keyboard.press('Enter')
    await expect(juno.write.search).toBeFocused()
    // Esc puts focus back on the chip in the browser lane.
    await juno.win.keyboard.press('Escape')
    await juno.write.expectDestination('#eng')
    await expect(juno.write.composer).toHaveValue('Keyboard only')
    await juno.write.composer.focus()
    await juno.win.keyboard.press('Enter')
    await expect.poll(() => fake.messages('C0ENG').filter((m) => m.text === 'Keyboard only').length).toBe(1)
    // ⌘N used the launch tab's Home: it stays active and empty, with the new thread in a tab behind it.
    await expect.poll(() => juno.tabs.titles()).toEqual(['Home', expect.stringMatching(/^Keyboard only/)])
    await juno.tabs.expectActive('Home')
    await expect(juno.write.composer).toHaveValue('')
    await freshHome(juno)
  })

  await step('holding Backspace keeps the destination, and a first @ and a name typed fast with Enter picks the person typed', async () => {
    const { write, win } = juno
    await write.pickConversation('ma', 'Maya')
    await write.composer.pressSequentially('ok')
    // A held key: the first press, then repeats past the last character.
    for (let i = 0; i < 4; i++) await win.keyboard.down('Backspace')
    await win.keyboard.up('Backspace')
    await expect(write.composer).toHaveValue('')
    await write.expectDestination('Maya')
    await write.composer.press('Backspace')
    await write.expectDestination('Juno')

    await write.composer.pressSequentially('@')
    await expect(write.sendTo).toBeVisible()
    // No wait: the rows for "@j" are still on their way when Enter lands.
    await win.keyboard.type('j')
    await win.keyboard.press('Enter')
    await win.keyboard.type('Hi')
    await write.expectDestination('Jonas')
    await expect(write.composer).toHaveValue('Hi')
    await expect(write.composer).toBeFocused()
    await write.composer.fill('')
    await freshHome(juno)
  })

  await step('⌘N opens a new Home when this one has a draft, and "+" opens Home ready to write', async () => {
    const { write, tabs, sidebar, topic } = juno
    await sidebar.row(POSTGRES).open()
    await topic.expectTitle(POSTGRES)
    // No Home tab is open, so ⌘N opens one and leaves the topic in its tab.
    await tabs.menu('new-message')
    await tabs.expectCount(2)
    await tabs.expectActiveAt('Home', 0)
    await expect(write.search).toBeFocused()
    await write.search.press('Escape')

    await write.write('Half a thought')
    await tabs.menu('new-message')
    await tabs.expectCount(3)
    await tabs.expectActiveAt('Home', 1)
    await expect(write.search).toBeFocused()
    await write.search.press('Escape')
    await expect(write.composer).toHaveValue('')

    await tabs.newTabButton.click()
    await tabs.expectCount(4)
    await tabs.expectActiveAt('Home', 2)
    await expect(write.composer).toBeFocused()
    await write.expectDestination('Juno')
    await tabs.selectAt('Home', 0)
    await write.composer.fill('')
    await freshHome(juno)
  })

  await step('keys typed on the destination and topic chips go into the field; arrows and Space still drive the chips', async () => {
    const { write, win } = juno
    // Esc from the list gives focus back to the chip in Chromium, and to the field here (README).
    await juno.tabs.menu('new-message')
    await expect(write.search).toBeFocused()
    await write.search.press('Escape')
    await write.chip.focus()
    await win.keyboard.type('What changed today?')
    await expect(write.composer).toBeFocused()
    await expect(write.composer).toHaveValue('What changed today?')
    await write.expectDestination('Juno')

    await win.keyboard.press('Shift+Tab')
    await expect(write.chip).toBeFocused()
    await win.keyboard.press('ArrowDown')
    await expect(write.search).toBeFocused()
    await write.search.press('Escape')
    await write.chip.focus()
    await win.keyboard.press('Space')
    await expect(write.search).toBeFocused()
    await write.search.press('Escape')
    await expect(write.composer).toHaveValue('What changed today?')

    await write.composer.fill('')
    await write.pickConversation('eng', 'eng')
    await write.expectTopic('Main')
    await write.composer.press('Shift+Tab')
    await write.topicChip.focus()
    await write.topicChip.press('D')
    await expect(write.composer).toBeFocused()
    await expect(write.composer).toHaveValue('D')
    await write.composer.fill('')
    await freshHome(juno)
  })

  await step('text pasted right after ⌘T goes into the new Home, in order with the keys typed around it', async () => {
    const { write, topic, sidebar, tabs, win } = juno
    await sidebar.row(POSTGRES).open()
    await topic.expectTitle(POSTGRES)
    await topic.composer.focus()
    // ⌘T reaches the page before the menu runs it; keys and a ⌘V in that time are held for the new tab.
    const page = win.window as unknown as typeof globalThis
    page.document.activeElement?.dispatchEvent(new page.KeyboardEvent('keydown', { key: 't', code: 'KeyT', metaKey: true, bubbles: true, cancelable: true }))
    await win.keyboard.type('Re: ')
    const data = new page.DataTransfer()
    data.setData('text/plain', 'the launch brief')
    ;(page.document.activeElement ?? page.document.body).dispatchEvent(new page.ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    await win.keyboard.type('?')
    await tabs.menu('new-tab')
    await tabs.expectActiveAt('Home', 0)
    await expect(write.composer).toHaveValue('Re: the launch brief?')
    await tabs.select(POSTGRES)
    await expect(topic.composer).toHaveValue('')
    await tabs.selectAt('Home', 0)
    await write.composer.fill('')
    await freshHome(juno)
  })

  await step('Home opens from the sidebar in the current tab; a plain open focuses its tab and ⌘-click opens another', async () => {
    const { tabs, sidebar, topic, nav } = juno
    const home = juno.home.navItem
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
    await freshHome(juno)
  })

  await step('Home keeps its draft and destination when a topic opens over it, and its typing goes on at the end', async () => {
    const { write, topic, sidebar, nav, win } = juno
    await write.pickConversation('ma', 'Maya')
    await write.write('A long thought I do not want to lose')
    await sidebar.row(POSTGRES).open()
    await topic.expectTitle(POSTGRES)
    await nav.back()
    await expect(write.composer).toHaveValue('A long thought I do not want to lose')
    await write.expectDestination('Maya')
    await expect(write.composer).toBeFocused()
    await win.keyboard.type(' and more')
    await expect(write.composer).toHaveValue('A long thought I do not want to lose and more')
  })

  await step('closing Home with a draft shows "Draft closed", and Undo brings the tab back with its draft', async () => {
    const { write, tabs } = juno
    await tabs.closeAt('Home', 0)
    await juno.expectToast('Draft closed')
    // The last tab closed, so a fresh Home took its place.
    await expect(write.composer).toHaveValue('')
    await write.expectDestination('Juno')

    await juno.undoFromToast()
    await expect(tabs.tab('Home')).toHaveCount(2)
    await expect(write.composer).toHaveValue('A long thought I do not want to lose and more')
    await write.expectDestination('Maya')
    await expect(write.composer).toBeFocused()
  })
}, { timeout: 120_000 })
