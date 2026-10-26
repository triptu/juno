// Sending from a topic (spec section 8): a message settles in place in Main when Slack's echo comes
// before the answer, a refused send stays with Retry and Delete draft, fast Enter presses send once,
// an edit made while the message is still sending is kept and reaches Slack once it has the message,
// and a message deleted or quoted while its menu is open leaves the composer usable. Then sends across
// tabs: the last tab closed while it sends, a draft two tabs share, a send from Home that leaves the
// tabs where they were, and a send while offline. A draft kept across a restart is in tabs.test.ts.
import { expect } from './expect'
import { domTest } from './test'

const POSTGRES = 'Draft plan is in the doc'

// One launch on #eng's Main: each step sends its own messages.
domTest('in Main, sends settle, a refused send has Retry and Delete draft, fast Enter sends once, and edits and menus survive a send in flight', async ({ juno, fake, step }) => {
  const { topic } = juno
  await juno.sidebar.row('#eng').open()
  await topic.expectTitle('Main')

  await step('a message settles when the echo comes before the answer', async () => {
    fake.holdNext({ method: 'chat.postMessage' })
    await topic.send('Lunch order goes in at noon')
    await topic.expectSent('Lunch order goes in at noon')
    fake.release()
    // The same channel's next send waits for the first HTTP answer to finish.
    await topic.send('Then book a table for six')
    await topic.expectSent('Then book a table for six')
    await topic.expectSent('Lunch order goes in at noon')
    expect(fake.calls.filter((call) => call.method === 'chat.postMessage').map((call) => call.args['channel'])).toEqual(['C0ENG', 'C0ENG'])
  })

  await step('a refused send stays in the row with Retry and Delete draft', async () => {
    fake.forceError({ method: 'chat.postMessage', error: 'restricted_action', times: 2 })
    await topic.send('Please try this one again')
    await expect(topic.failed('Please try this one again').row).toContainText('Not sent.')
    await topic.send('Please drop this one')
    await expect(topic.failed('Please drop this one').row).toContainText('Not sent.')

    await topic.failed('Please try this one again').retry()
    await topic.expectSent('Please try this one again')
    await topic.failed('Please drop this one').discard()
    await expect(topic.message('Please drop this one')).toHaveCount(0)
    expect(fake.messages('C0ENG').filter((m) => m.text === 'Please drop this one')).toHaveLength(0)
  })

  await step('fast Enter presses send the draft once while the post waits', async () => {
    fake.holdNext({ method: 'chat.postMessage', before: true })
    await juno.topic.composer.fill('Only one copy')
    await juno.topic.composer.press('Enter')
    await juno.topic.composer.press('Enter')
    await juno.topic.composer.press('Enter')
    await expect(juno.topic.composer).toHaveValue('')
    fake.release()
    await juno.topic.expectSent('Only one copy')
    await juno.topic.send('After the burst')
    await juno.topic.expectSent('After the burst')
    expect(fake.messages('C0ENG').filter((m) => m.text === 'Only one copy')).toHaveLength(1)
  })
  const field = topic.list.getByRole('textbox', { name: 'Edit message' })
  await step('an edit started while the message is sending stays open, with what was typed, when Slack takes the message', async () => {
    fake.holdNext({ method: 'chat.postMessage', before: true })
    await topic.send('Typo in thsi one')
    await expect(topic.message('Typo in thsi one')).toHaveAttribute('data-pending', 'sending')
    await topic.composer.press('ArrowUp')
    await topic.message('Typo in thsi one').press('e')
    await field.fill('Typo in this one, still typing')

    fake.release()
    await expect.poll(() => fake.messages('C0ENG').some((m) => m.text === 'Typo in thsi one')).toBe(true)
    await expect(topic.list.locator('[data-message-row][data-pending]')).toHaveCount(0)
    await expect(field).toHaveValue('Typo in this one, still typing')
    await expect(field).toBeFocused()
    await field.press('Enter')
    await expect.poll(() => fake.messages('C0ENG').some((m) => m.text === 'Typo in this one, still typing')).toBe(true)
  })

  await step('an edit saved while the message is still sending reaches Slack once it has the message', async () => {
    const updates = () => fake.calls.filter((call) => call.method === 'chat.update').length
    fake.holdNext({ method: 'chat.postMessage', before: true })
    await topic.send('Wrnog word here')
    await expect(topic.message('Wrnog word here')).toHaveAttribute('data-pending', 'sending')
    const before = updates()
    await topic.composer.press('ArrowUp')
    await juno.win.keyboard.press('e')
    await field.fill('Wrong word here')
    await field.press('Enter')
    await expect(topic.message('Wrong word here')).toBeVisible()
    expect(updates()).toBe(before)
    fake.release()
    await topic.expectSent('Wrong word here')
    await expect.poll(() => fake.messages('C0ENG').filter((m) => m.text === 'Wrong word here').length).toBe(1)
    expect(fake.messages('C0ENG').some((m) => m.text === 'Wrnog word here')).toBe(false)
  })

  await step('Edit from a menu opened while the message was sending follows it once it is sent', async () => {
    fake.holdNext({ method: 'chat.postMessage', before: true })
    await topic.send('Menu during send')
    await expect(topic.message('Menu during send')).toHaveAttribute('data-pending', 'sending')
    const menu = await topic.messageMenu('Menu during send')
    fake.release()
    await topic.expectSent('Menu during send')
    await menu.choose('edit')
    await expect(field).toHaveValue('Menu during send')
    await field.fill('Edited after send')
    await field.press('Enter')
    await expect.poll(() => fake.messages('C0ENG').filter((m) => m.text === 'Edited after send').length).toBe(1)
  })

  await step('a deleted message cannot be edited from its already open menu', async () => {
    await juno.topic.send('Delete under menu')
    await juno.topic.expectSent('Delete under menu')
    const message = fake.messages('C0ENG').find((m) => m.text === 'Delete under menu')!
    const menu = await juno.topic.messageMenu('Delete under menu')
    fake.deleteMessage({ channel: 'C0ENG', ts: message.ts })
    await expect(juno.topic.message('Delete under menu')).toHaveCount(0)
    await menu.choose('edit')
    await juno.topic.composer.fill('Still usable')
    await expect(juno.topic.list.getByRole('textbox', { name: 'Edit message' })).toHaveCount(0)
    await juno.topic.composer.press('Enter')
    await juno.topic.expectSent('Still usable')
  })
  await step('deleting the source of a Slack quote keeps the written reply', async () => {
    const message = fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: 'Keep this quote' })
    const row = juno.topic.message('Keep this quote')
    await expect(row).toBeVisible()
    await (await juno.topic.messageMenu('Keep this quote')).choose('quote')
    await expect(juno.topic.composer).toHaveValue('> Keep this quote\n')
    fake.deleteMessage({ channel: 'C0ENG', ts: message.ts })
    await expect(row).toHaveCount(0)
    await expect(juno.topic.composer).toHaveValue('> Keep this quote\n')
    await juno.topic.composer.press('Enter')
    await expect.poll(() => fake.messages('C0ENG').some((m) => m.text?.includes('Keep this quote'))).toBe(true)
  })}, { timeout: 120_000 })

// The sends share a launch; each step opens the tabs it needs. The offline send goes last.
domTest('sends across tabs: the last tab closed while it sends, a draft two tabs share, a send from Home that leaves the tabs where they were, and a send while offline', async ({ juno, fake, step }) => {
  await step('closing the last tab while its message sends posts it once and opens a new tab', async () => {
    await juno.sidebar.row('#eng').open()
    await juno.tabs.expectCount(1)
    fake.holdNext({ method: 'chat.postMessage', before: true })
    await juno.topic.composer.fill('Sent as the tab closed')
    await juno.topic.composer.press('Enter')
    await expect.poll(() => fake.heldCount({ method: 'chat.postMessage' })).toBe(1)
    await juno.tabs.menu('close-tab')
    await juno.tabs.expectCount(1)
    await juno.tabs.expectActive('Home')
    await expect(juno.write.composer).toBeFocused()
    fake.release()
    await expect.poll(() => fake.messages('C0ENG').filter((m) => m.text === 'Sent as the tab closed').length).toBe(1)
    await juno.tabs.menu('reopen-tab')
    await juno.topic.expectSent('Sent as the tab closed')
    await expect(juno.topic.composer).toHaveValue('')
    expect(fake.messages('C0ENG').filter((m) => m.text === 'Sent as the tab closed')).toHaveLength(1)
    // The reopened tab joins the new Home; the next steps start from one tab.
    await juno.tabs.expectCount(2)
    await juno.tabs.close('Home')
    await juno.tabs.expectCount(1)
  })

  await step('two tabs on one topic share its draft, and a send from one clears it in both', async () => {
    await juno.sidebar.row(POSTGRES).open()
    await juno.sidebar.row(POSTGRES).openInNewTab()
    await expect(juno.tabs.tab(POSTGRES)).toHaveCount(2)
    await juno.topic.composer.fill('Shared draft')
    await juno.tabs.selectAt(POSTGRES, 0)
    await juno.tabs.expectActiveAt(POSTGRES, 0)
    await expect(juno.topic.composer).toHaveValue('Shared draft')
    await juno.topic.composer.press('Enter')
    await juno.topic.expectSent('Shared draft')
    await juno.tabs.selectAt(POSTGRES, 1)
    await juno.tabs.expectActiveAt(POSTGRES, 1)
    await juno.topic.expectMessage('Shared draft')
    await expect(juno.topic.composer).toHaveValue('')
    expect(fake.messages('C0ENG').filter((m) => m.text === 'Shared draft')).toHaveLength(1)
  })

  await step('a send from Home to a channel, a thread’s channel or a DM another tab shows leaves every tab where it was', async () => {
    await juno.sidebar.row('#eng').open()
    await juno.sidebar.row('Maya', { exact: true }).openInNewTab()
    await juno.tabs.menu('new-tab')
    await juno.write.pickConversation('eng', 'eng')
    await juno.write.write('Sent from Home')
    await juno.write.send()
    await juno.tabs.expectActive('Home')
    await expect(juno.tabs.tab('eng')).toHaveCount(1)
    await expect.poll(() => fake.messages('C0ENG').filter((m) => m.text === 'Sent from Home').length).toBe(1)

    await juno.write.pickConversation('maya', 'Maya')
    await juno.write.write('DM from Home')
    await juno.write.send()
    await juno.tabs.expectActive('Home')
    await expect(juno.tabs.tab('Maya')).toHaveCount(1)
    await juno.tabs.select('Maya')
    await juno.topic.expectMessage('DM from Home')
  })

  await step('a send while the socket and network drop goes once when they are back', async () => {
    await juno.sidebar.row('#eng').open()
    fake.goOffline()
    fake.dropSocket()
    await juno.topic.composer.fill('Sent offline')
    await juno.topic.composer.press('Enter')
    await juno.topic.expectMessage('Sent offline')
    // Juno has seen the drop before the network comes back.
    await juno.sidebar.expectSyncStatus("You're offline")
    fake.goOnline()
    await juno.topic.expectSent('Sent offline')
    await juno.waitForSync()
    expect(fake.messages('C0ENG').filter((m) => m.text === 'Sent offline')).toHaveLength(1)
    await expect(juno.topic.message('Sent offline')).toHaveCount(1)
  })
}, { timeout: 120_000 })
