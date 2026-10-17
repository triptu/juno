// Writing from Home (spec section 12, "Writing"): Juno by default, a first
// @ or # that suggests a destination without taking over, Recent and the
// destination list, sends that leave Home in place, a first DM opened with
// conversations.open, ⌘N and "+", and Home from the sidebar.
import { SELF_ID } from '@juno/fake-slack'
import { recordBoxes } from './shiftProbe'
import { expect, test } from './fixtures'

test.describe.configure({ timeout: 120_000 })

const POSTGRES = 'Draft plan is in the doc'
const OFFSITE = 'Can eng take the Wednesday afternoon'
/** Shares no two words with any #eng thread, so the wrong-place check never stops the send, however soon it answers. */
const DRAFT = 'Lunch order goes out at noon'

test('a first @ suggests a person, Tab makes them the destination, and the send stays on Home with the field in place', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { write, tabs } = juno

  // A launch opens Home, ready to ask Juno.
  await juno.expectNothingOpen()
  await expect(write.composer).toBeFocused()
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
  const before = await write.field.boundingBox()
  // Every frame through the send shows one field, in the same place.
  const fields = await recordBoxes(juno.win, '[data-composer-field]')
  await write.send()
  await expect.poll(() => fake.calls.filter((call) => call.method === 'chat.postMessage').map((call) => call.args['channel'])).toEqual(['D0MAYA'])
  await juno.expectToast('Sent to Maya')
  // Home stays: the field is empty and back on Juno, where it was.
  await tabs.expectActive('Home')
  await expect(write.composer).toHaveValue('')
  await write.expectDestination('Juno')
  expect(await write.field.boundingBox()).toEqual(before)
  const frames = await fields()
  expect(frames.length, 'the field must be sampled in many frames').toBeGreaterThan(1)
  expect(frames.filter((boxes) => boxes.length !== 1 || JSON.stringify(boxes[0]) !== JSON.stringify(before)), `one field at ${JSON.stringify(before)} in every frame`).toEqual([])
})

test('Space keeps a first # as text for Juno', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { write } = juno

  await write.composer.pressSequentially('#eng')
  await expect(write.sendToOption('eng')).toBeVisible()
  await write.composer.pressSequentially(' what happened today?')
  await expect(write.sendTo).toHaveCount(0)
  await write.expectDestination('Juno')
  await expect(write.composer).toHaveValue('#eng what happened today?')
})

test('Esc keeps a first @ for Juno, Recent chooses a person, and Backspace in an empty field goes back to Juno', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { write } = juno

  await write.composer.pressSequentially('@ma')
  await expect(write.sendTo).toBeVisible()
  await write.composer.press('Escape')
  await expect(write.sendTo).toHaveCount(0)
  await write.expectDestination('Juno')
  await expect(write.composer).toHaveValue('@ma')

  await write.composer.fill('')
  await write.recentRow('Maya').click()
  await write.expectDestination('Maya')
  await expect(write.recentRow('Maya')).toHaveAttribute('aria-pressed', 'true')
  await expect(write.composer).toBeFocused()
  await write.composer.press('Backspace')
  await write.expectDestination('Juno')
  await expect(write.recentRow('Maya')).toHaveAttribute('aria-pressed', 'false')
})

test('a send to a channel starts a thread there, shows it in the sidebar, and Home stays', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
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

  await sidebar.row(DRAFT).open()
  await topic.expectMessage(DRAFT)
  await expect(topic.composer).toHaveAttribute('placeholder', 'Reply')
  await topic.send('second')
  await topic.expectSent('second')
  const root = fake.messages('C0ENG').find((message) => message.text === DRAFT)!
  expect(root.thread_ts).toBeUndefined()
  expect(fake.messages('C0ENG').find((message) => message.text === 'second')?.thread_ts).toBe(root.ts)
})

test('choosing a destination never marks anything read', async ({ juno, slack }) => {
  await juno.signIn()
  await juno.waitForSync()
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
})

test('a person never messaged: chosen from the list, then conversations.open on send', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
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
})

test('Home keeps its draft and destination when a topic opens over it, and Back brings them back', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { write, topic, sidebar, nav } = juno

  await write.recentRow('Maya').click()
  await write.write('A long thought I do not want to lose')
  await sidebar.row(POSTGRES).open()
  await topic.expectTitle(POSTGRES)
  await nav.back()
  await expect(write.composer).toHaveValue('A long thought I do not want to lose')
  await write.expectDestination('Maya')
})

test('New Message (⌘N) opens Home’s destination list, and a new Home when this one has a draft; "+" opens Home ready to write', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { write, tabs, sidebar, topic } = juno

  await sidebar.row(POSTGRES).open()
  await topic.expectTitle(POSTGRES)
  await tabs.menu('new-message')
  await tabs.expectActive('Home')
  await tabs.expectCount(1)
  await expect(write.search).toBeFocused()
  await write.search.press('Escape')
  await expect(write.composer).toBeFocused()

  await write.write('Half a thought')
  await tabs.menu('new-message')
  await tabs.expectCount(2)
  await tabs.expectActiveAt('Home', 1)
  await expect(write.search).toBeFocused()
  await write.search.press('Escape')
  await expect(write.composer).toHaveValue('')

  await tabs.newTabButton.click()
  await tabs.expectCount(3)
  await tabs.expectActiveAt('Home', 2)
  await expect(write.composer).toBeFocused()
  await write.expectDestination('Juno')
})

test('Home opens from the sidebar in the current tab; a plain open focuses its tab and ⌘-click opens another', async ({ juno, win }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { tabs, sidebar, topic, nav } = juno
  const home = win.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: 'Home' })

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

test('Recent lists people and channels by use, and choosing one sets where the message goes', async ({ juno, fake }) => {
  // Seed before sign-in so boot history, rather than socket timing, decides the order.
  for (let i = 0; i < 12; i++) fake.injectMessage({ channel: 'C0ENG', user: SELF_ID, text: `Frequent send ${i}` })
  fake.injectMessage({ channel: 'C0PRODUCT', user: SELF_ID, text: 'Less frequent send' })
  await juno.signIn()
  await juno.waitForSync()
  const { write } = juno
  const channels = write.recent.getByRole('list', { name: 'Channels' }).getByRole('button')
  await expect(channels.first()).toHaveText('eng')
  await channels.first().click()
  await write.expectDestination('#eng')
  await expect(write.composer).toBeFocused()
  await expect(channels.first()).toHaveAttribute('aria-pressed', 'true')

  // One Tab stop: the arrows move inside Recent, Space chooses.
  await channels.first().focus()
  await juno.win.keyboard.press('ArrowDown')
  const next = channels.nth(1)
  await expect(next).toBeFocused()
  const nextName = await next.innerText()
  await juno.win.keyboard.press('Space')
  await write.expectDestination(`#${nextName}`)
  await expect(write.composer).toBeFocused()

  await channels.first().click()
  await write.write('The release checklist is ready.')
  await write.send()
  await expect.poll(() => fake.messages('C0ENG').some((message) => message.text === 'The release checklist is ready.')).toBe(true)
  expect(fake.calls.filter((call) => call.method === 'chat.postMessage').map((call) => call.args['channel'])).toEqual(['C0ENG'])
})

test('a new thread whose root fails stays in the sidebar with Not sent and Retry, and a queued reply follows it', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { write, topic, sidebar } = juno
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
