// New chat (spec section 9) and Home (section 12): write first and pick
// where it goes, pick a thread first, change the destination, a preview that
// never marks read, a first DM opened with conversations.open, and Home from
// the sidebar.
import { SELF_ID } from '@juno/fake-slack'
import { expect, test } from './fixtures'

test.describe.configure({ timeout: 120_000 })

const POSTGRES = 'Draft plan is in the doc'
const OFFSITE = 'Can eng take the Wednesday afternoon'

test('write first, then pick a destination and send: the tab becomes the topic, and the composer does not move', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { tabs, newChat, topic, nav } = juno

  // "+" opens a New chat beside the launch tab's.
  await tabs.newTabButton.click()
  await tabs.expectActiveAt('New chat', 1)
  await newChat.expectEmpty()
  await expect(newChat.composer).toBeFocused()
  await newChat.expectConversation('Pick a conversation')
  await newChat.expectThread('Any thread')

  // "+" again opens another New chat, beside the launch tab's and this one.
  await tabs.newTabButton.click()
  await tabs.expectCount(3)
  await tabs.expectActiveAt('New chat', 2)

  await newChat.write('Cutover moves to Thursday night')
  // Enter with no destination opens the conversation picker and keeps the draft.
  await newChat.send()
  await expect(newChat.search).toBeFocused()
  await expect(newChat.composer).toHaveValue('Cutover moves to Thursday night')

  await newChat.pickConversation('eng', 'eng')
  await newChat.expectConversation('eng')
  await newChat.expectThread('Main')
  await tabs.expectActive('eng')
  await expect(newChat.composer).toBeFocused()

  const before = await newChat.field.boundingBox()
  await newChat.send()
  await topic.expectMessage('Cutover moves to Thursday night')
  await tabs.expectActive('eng')
  await expect(newChat.root).toHaveCount(0)
  const after = await newChat.field.boundingBox()
  expect(after).toEqual(before)

  const posted = fake.calls.filter((call) => call.method === 'chat.postMessage')
  expect(posted.map((call) => call.args['channel'])).toEqual(['C0ENG'])
  // The New chat's entry became the topic: nothing to go back to in this new tab.
  await nav.expectCanGo(false, false)
})

test('a thread picked first fills in the conversation, and the reply lands in the thread', async ({ juno, slack, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { tabs, newChat, topic } = juno

  await tabs.menu('new-chat')
  await newChat.write('Thursday works for the freeze')
  await newChat.pickThread('draft', POSTGRES)
  await newChat.expectConversation('eng')
  await newChat.expectThread(POSTGRES)
  await tabs.expectActive(POSTGRES)
  await expect(newChat.root.getByRole('list', { name: 'Frequent conversations' })).toBeVisible()

  await newChat.send()
  await topic.expectTitle(POSTGRES)
  await topic.expectMessage('Thursday works for the freeze')
  const root = slack.root(POSTGRES)
  const posted = fake.calls.find((call) => call.method === 'chat.postMessage')
  expect(posted?.args['channel']).toBe(root.channel)
  expect(posted?.args['thread_ts']).toBe(root.ts)
})

test('changing the destination before sending keeps Frequent and sets the thread back to Main', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { tabs, newChat, topic } = juno

  await tabs.menu('new-tab')
  await newChat.write('Sending this to Maya instead')
  await newChat.pickThread('draft', POSTGRES)
  await newChat.expectConversation('eng')

  await newChat.pickConversation('maya', 'Maya')
  await newChat.expectConversation('Maya')
  await newChat.expectThread('Main')
  await expect(newChat.root.getByRole('list', { name: 'Frequent conversations' })).toBeVisible()
  await expect(newChat.composer).toHaveValue('Sending this to Maya instead')

  await newChat.send()
  await topic.expectMessage('Sending this to Maya instead')
  await tabs.expectActive('Maya')
  const posted = fake.calls.filter((call) => call.method === 'chat.postMessage')
  expect(posted.map((call) => [call.args['channel'], call.args['thread_ts']])).toEqual([['D0MAYA', undefined]])
})

test('choosing a destination never marks anything read', async ({ juno, slack }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { tabs, newChat, sidebar } = juno

  slack.as('Leo').postIn('eng', 'Replica lag is under a second now')
  const engMain = sidebar.row('#eng')
  await engMain.expectPreview(/Replica lag is under a second now/)
  const unread = Number(await engMain.root.locator('[title$=" unread"]').textContent())
  expect(unread).toBeGreaterThan(0)
  slack.resetCalls()

  await tabs.newTabButton.click()
  await newChat.pickConversation('eng', 'eng')
  await expect(newChat.root.getByRole('list', { name: 'Frequent conversations' })).toBeVisible()
  await slack.expectNoMarks()
  await engMain.expectUnread(unread)
})

test('a person never messaged: keep Frequent, then conversations.open on send', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { tabs, newChat, topic } = juno

  await tabs.newTabButton.click()
  await newChat.conversationButton.click()
  await newChat.search.fill('jon')
  await expect(newChat.option('Jonas')).toContainText('No messages yet')
  await newChat.option('Jonas').click()
  await newChat.expectConversation('Jonas')
  await expect(newChat.root.getByRole('list', { name: 'Frequent conversations' })).toBeVisible()
  expect(fake.calls.some((call) => call.method === 'conversations.open')).toBe(false)

  await newChat.write('Welcome aboard. Your laptop arrives Monday.')
  await newChat.send()
  await topic.expectMessage('Welcome aboard. Your laptop arrives Monday.')
  await tabs.expectActive('Jonas')
  const opens = fake.calls.filter((call) => call.method === 'conversations.open')
  expect(opens.map((call) => call.args['users'])).toEqual(['U0JONAS'])
  const posted = fake.calls.find((call) => call.method === 'chat.postMessage')
  expect(fake.workspace.conversation(String(posted?.args['channel']))?.kind).toBe('im')
})

test('a New chat with a draft stays in the tab history when a topic opens over it', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { tabs, newChat, topic, sidebar, nav } = juno

  await tabs.newTabButton.click()
  await newChat.write('A long thought I do not want to lose')
  await sidebar.row('Draft plan is in the doc').open()
  await topic.expectTitle('Draft plan is in the doc')
  // The launch tab's New chat and this one, which now shows the topic.
  await tabs.expectCount(2)
  await nav.back()
  await expect(newChat.composer).toHaveValue('A long thought I do not want to lose')
})

test('a New chat closed while it sends comes back as the conversation, so Enter cannot send it again', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { tabs, newChat, topic } = juno

  await tabs.newTabButton.click()
  await newChat.pickConversation('jon', 'Jonas')
  await newChat.write('Welcome once')
  fake.holdNext({ method: 'conversations.open' })
  await newChat.send()
  await tabs.menu('close-tab')
  // The last tab gives way to a fresh New chat.
  await juno.expectNothingOpen()
  fake.release()
  await expect.poll(() => fake.calls.filter((call) => call.method === 'chat.postMessage').length).toBe(1)

  await tabs.menu('reopen-tab')
  await tabs.expectActive('Jonas')
  await topic.expectSent('Welcome once')
  await expect(newChat.composer).toHaveCount(0)
  await topic.composer.press('Enter')
  await juno.win.waitForTimeout(500)
  expect(fake.calls.filter((call) => call.method === 'chat.postMessage')).toHaveLength(1)
})

test('Home opens from the sidebar in the current tab; a plain open focuses its tab and ⌘-click opens another', async ({ juno, win }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { tabs, sidebar, topic, nav } = juno
  const home = win.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: 'Home' })

  // A fresh launch shows one New chat tab; Home is not selected.
  await juno.expectNothingOpen()
  await expect(home).not.toHaveAttribute('aria-current', 'page')

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


test('frequent destinations choose where a new message is sent', async ({ juno, fake }) => {
  // Seed before sign-in so boot history, rather than socket timing, decides the order.
  for (let i = 0; i < 12; i++) fake.injectMessage({ channel: 'C0ENG', user: SELF_ID, text: `Frequent send ${i}` })
  fake.injectMessage({ channel: 'C0PRODUCT', user: SELF_ID, text: 'Less frequent send' })
  await juno.signIn()
  await juno.waitForSync()
  await juno.tabs.newTabButton.click()
  const list = juno.newChat.root.getByRole('list', { name: 'Frequent conversations' })
  const rows = list.getByRole('button')
  await expect(rows).toHaveCount(6)
  await expect(rows.first()).toHaveText('eng')
  await rows.first().dispatchEvent('pointerdown', { button: 0, pointerType: 'mouse' })
  await juno.newChat.expectConversation('eng')
  await expect(juno.newChat.composer).toBeFocused()
  await expect(rows.first()).toHaveAttribute('aria-pressed', 'true')
  // The list remains, and choosing another row with the keyboard changes the chip.
  const next = rows.nth(1)
  const nextName = await next.innerText()
  await rows.first().focus()
  await juno.win.keyboard.press('Tab')
  await expect(next).toBeFocused()
  await next.press('Space')
  await juno.newChat.expectConversation(nextName)
  await expect(juno.newChat.composer).toBeFocused()
  await rows.first().focus()
  await rows.first().press('Enter')
  await juno.newChat.write('The release checklist is ready.')
  await juno.newChat.send()
  await juno.topic.expectMessage('The release checklist is ready.')
  await expect.poll(() => fake.messages('C0ENG').some(message => message.text === 'The release checklist is ready.')).toBe(true)
  expect(fake.calls.filter(call => call.method === 'chat.postMessage').map(call => call.args['channel'])).toEqual(['C0ENG'])
})
