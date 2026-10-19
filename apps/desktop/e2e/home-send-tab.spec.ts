// A send from Home opens its topic in a background tab (spec section 12,
// "Writing"): right after the Home tab it was sent from, which stays active,
// and only when no tab shows that topic yet.
import { expect, test } from './fixtures'

// Starts signed in and synced (README, "Synced start").
test.use({ synced: true })

test.describe.configure({ timeout: 120_000 })
// A failing test attaches the send's path through the app and the fake's post calls (README, "Send trace").
test.use({ sendTrace: true })

/** #eng's Postgres thread, titled by its root's first words with AI off. */
const POSTGRES = 'Draft plan is in the doc'

const startsWith = (text: string) => expect.stringMatching(new RegExp(`^${text}`))

test('a send to a Main opens it behind Home, right after it, once', async ({ juno }) => {
  const { write, tabs, sidebar } = juno

  // Home, then a topic in a second tab; back on Home.
  await sidebar.row(POSTGRES).openInNewTab()
  await tabs.expectCount(2)
  await tabs.select('Home')
  await tabs.expectActive('Home')

  await write.pickConversation('maya', 'Maya')
  await write.write('Lunch order goes out at noon')
  await write.send()
  await juno.expectToast('Sent to Maya')
  await expect.poll(() => tabs.titles()).toEqual(['Home', startsWith('Maya'), startsWith(POSTGRES)])
  await tabs.expectActive('Home')
  await write.expectDestination('Juno')

  // Again to Maya: her tab is there, so nothing new opens.
  await write.pickConversation('maya', 'Maya')
  await write.write('And dessert at two')
  await write.send()
  await juno.expectToast('Sent to Maya')

  // A send to someone else opens theirs right after Home. Tabs open in order, so a second Maya tab would be here by now.
  await write.pickConversation('jon', 'Jonas')
  await write.write('Welcome aboard')
  await write.send()
  await juno.expectToast('Sent to Jonas')
  await expect.poll(() => tabs.titles()).toEqual(['Home', startsWith('Jonas'), startsWith('Maya'), startsWith(POSTGRES)])
  await tabs.expectActive('Home')
})

test('a reply in a thread from Home opens the thread behind Home, once', async ({ juno }) => {
  const { write, tabs, topic } = juno

  await write.pickConversation('eng', 'eng')
  await write.pickTopic('draft', POSTGRES)
  await write.write('Dry run notes are in the staging channel')
  await write.send()
  await juno.expectToast(`Replied in ${POSTGRES}`)
  await expect.poll(() => tabs.titles()).toEqual(['Home', startsWith(POSTGRES)])
  await tabs.expectActive('Home')

  // Again in the same thread: its tab is there, so nothing new opens.
  await write.pickConversation('eng', 'eng')
  await write.pickTopic('draft', POSTGRES)
  await write.write('Rollback steps are in the doc too')
  await write.send()
  await juno.expectToast(`Replied in ${POSTGRES}`)
  await write.pickConversation('maya', 'Maya')
  await write.write('Plan is updated')
  await write.send()
  await juno.expectToast('Sent to Maya')
  await expect.poll(() => tabs.titles()).toEqual(['Home', startsWith('Maya'), startsWith(POSTGRES)])
  await tabs.expectActive('Home')

  // The background tab shows the thread with both replies once chosen.
  await tabs.select(POSTGRES)
  await topic.expectMessage('Dry run notes are in the staging channel')
  await topic.expectMessage('Rollback steps are in the doc too')
})

test('a send from Home goes when another tab is chosen before its checks answer', async ({ juno, fake }) => {
  const { write, tabs } = juno
  await tabs.menu('new-tab')
  await tabs.expectActiveAt('Home', 1)
  await write.pickConversation('maya', 'Maya')
  await write.write('Sent as the tab was left')

  // The first Home tab is chosen in the same task as Enter, before the wrong-place check can answer.
  const first = await tabs.nth('Home', 0).elementHandle()
  await first!.evaluate((tab: HTMLElement) => {
    addEventListener('keydown', (event) => {
      if (event.key === 'Enter') tab.click()
    }, { once: true })
  })
  await write.send()
  await tabs.expectActiveAt('Home', 0)
  await expect.poll(() => fake.messages('D0MAYA').filter((m) => m.text === 'Sent as the tab was left').length).toBe(1)
})
