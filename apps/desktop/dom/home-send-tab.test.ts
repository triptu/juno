// A send from Home opens its topic in a background tab (spec section 12,
// "Writing"): right after the Home tab it was sent from, which stays active,
// and only when no tab shows that topic yet. A reply in a thread is in
// `home-topic.test.ts`.
import { expect } from './expect'
import { domTest } from './test'

/** #eng's Postgres thread, titled by its root's first words with AI off. */
const POSTGRES = 'Draft plan is in the doc'

const startsWith = (text: string) => expect.stringMatching(new RegExp(`^${text}`))

domTest('a send to a Main opens it behind Home, right after it, once; and goes when another tab is chosen before its checks answer', async ({ juno, fake, app, step }) => {
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
  await expect.poll(() => fake.messages('D0MAYA').some((message) => message.text === 'And dessert at two')).toBe(true)

  // A send to someone else opens theirs right after Home. Tabs open in order, so a second Maya tab would be here by now.
  await write.pickConversation('jon', 'Jonas')
  await write.write('Welcome aboard')
  await write.send()
  await juno.expectToast('Sent to Jonas')
  await expect.poll(() => tabs.titles()).toEqual(['Home', startsWith('Jonas'), startsWith('Maya'), startsWith(POSTGRES)])
  await tabs.expectActive('Home')

  await step('a send from Home goes when another tab is chosen before its checks answer', async () => {
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
  })
}, { timeout: 120_000 })
