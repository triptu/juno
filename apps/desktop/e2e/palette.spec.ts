// ⌘K (spec section 10): open it with the shortcut and the Search button,
// recent topics on an empty query, a topic by its title, a message by its
// text (landing on it), a channel's Main and "show its topics" (also from
// its menu), a person's DM and a New chat to someone never messaged, a
// command, Slack's search for what the cache lacks, and all of it from the
// keyboard.
import { expect, test } from './fixtures'

test.describe.configure({ timeout: 120_000 })

const POSTGRES = 'Draft plan is in the doc'
const WAL = 'We keep the old primary warm for 48h. Flip DNS back and replay from the WAL position we logged.'

test('opens with ⌘K and the Search button, shows recent topics, and closes with Esc, ⌘K or a press outside', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { palette, sidebar, tabs } = juno

  await palette.open()
  await palette.expectResults()
  await expect(palette.section('Recent')).toBeVisible()
  await expect(palette.section('Recent').getByRole('option')).toHaveCount(6)
  await expect(palette.input).toHaveAttribute('placeholder', 'Search, or tell Juno: message maya the slot works')
  // The first recent topic is active, and Enter opens it.
  const first = await palette.activeText()
  expect(first).not.toBe('')
  // The field is the only stop: Tab never reaches the window under the dim.
  await palette.press('Tab')
  await expect(palette.input).toBeFocused()
  await palette.press('Shift+Tab')
  await expect(palette.input).toBeFocused()
  await palette.press('Escape')
  await palette.expectClosed()

  await sidebar.searchButton.click()
  await palette.expectOpen()
  await palette.shortcut()
  await palette.expectClosed()

  await palette.open()
  await palette.expectResults()
  await juno.win.mouse.click(10, 300)
  await palette.expectClosed()

  await palette.open()
  await palette.expectResults()
  await palette.press('Enter')
  await palette.expectClosed()
  await tabs.expectCount(1)
})

test('finds a topic by its title and opens it; ⌘Enter opens one in a new tab', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { palette, topic, tabs } = juno

  await palette.open()
  await palette.expectResults()
  await palette.type('draft pla')
  await palette.expectResults()
  await palette.expectActive(POSTGRES)
  await palette.choose(POSTGRES)
  await palette.expectClosed()
  await topic.expectMessage('4 minutes is fine for us')
  await tabs.expectCount(1)

  await palette.open()
  await palette.expectResults()
  await palette.type('on-call handoff')
  await palette.expectResults()
  await expect(palette.row('Reminder: on-call handoff')).toBeVisible()
  await palette.expectActive(/Reminder: on-call handoff/)
  await palette.press('Meta+Enter')
  await palette.expectClosed()
  await tabs.expectCount(2)
})

test('finds a message by its text and lands on it in its thread, flashing it; the snippet hides in privacy mode', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { palette, topic, privacy } = juno

  await palette.open()
  await palette.expectResults()
  await palette.type('WAL position')
  await palette.expectResults()
  const row = palette.row('replay from the WAL position')
  await expect(row).toBeVisible({ timeout: 15_000 })
  await expect(row.locator('[data-sensitive]')).toContainText('Leo: We keep the old primary warm for 48h.')
  await privacy.toggleWithMenu()
  await privacy.expectBlurred(row.locator('[data-sensitive]'))
  await privacy.toggleWithMenu()

  // Mentions read as names, never as Slack's markup.
  await palette.clear()
  await palette.type('replica sizing')
  await palette.expectResults()
  await expect(palette.row('replica sizing').locator('[data-sensitive]')).toContainText("Leo: Thursday works. I'll pair. @Dev can you grab the replica sizing from #platform?", { timeout: 15_000 })
  await palette.clear()
  await palette.type('WAL position')
  await palette.expectResults()
  // The flash is a short animation on the message's row: record which rows animate.
  await juno.win.evaluate(() => {
    const w = window as unknown as { __flashed: string[] }
    w.__flashed = []
    const animate = Element.prototype.animate
    Element.prototype.animate = function (this: Element, ...args: Parameters<Element['animate']>) {
      const row = (this as HTMLElement).dataset['messageRow']
      if (row !== undefined) w.__flashed.push(this.textContent ?? '')
      return animate.apply(this, args)
    }
  })
  await palette.choose('replay from the WAL position')
  await palette.expectClosed()
  await expect(topic.message(WAL)).toBeInViewport({ timeout: 15_000 })
  await expect.poll(() => juno.win.evaluate(() => (window as unknown as { __flashed: string[] }).__flashed.some((text) => text.includes('replay from the WAL position'))), { timeout: 5_000 }).toBe(true)
})

test('a channel has its Main and "show its topics", also from its menu', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { palette, sidebar, tabs } = juno

  await palette.open()
  await palette.expectResults()
  await palette.type('platfo')
  await palette.expectResults()
  await expect(palette.row('Public channel · Main')).toBeVisible({ timeout: 15_000 })
  await expect(palette.row('Public channel · show its topics')).toBeVisible()
  await palette.choose('Public channel · show its topics')
  await palette.expectClosed()
  await sidebar.expectScope('platform')

  await palette.open()
  await palette.expectResults()
  await palette.type('eng')
  await palette.expectResults()
  await expect(palette.row('Public channel · Main')).toBeVisible({ timeout: 15_000 })
  await palette.chooseFromMenu('Public channel · Main', 'show-topics')
  await palette.expectClosed()
  await sidebar.expectScope('eng')

  await palette.open()
  await palette.expectResults()
  await palette.type('eng')
  await palette.expectResults()
  await palette.choose('Public channel · Main')
  await tabs.expectActive('eng')
})

test("a person's result opens your DM, or a New chat to them when you have never messaged", async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { palette, topic, newChat } = juno

  await palette.open()
  await palette.expectResults()
  await palette.type('maya')
  await palette.expectResults()
  await expect(palette.row('Message Maya Chen')).toBeVisible({ timeout: 15_000 })
  await expect(palette.row('Message Maya Chen')).toContainText('Direct message · Main')
  await palette.choose('Message Maya Chen')
  await topic.expectMessage('Running 5 late to the planning sync')

  await palette.open()
  await palette.expectResults()
  await palette.type('jonas')
  await palette.expectResults()
  await expect(palette.row('Message Jonas Weber')).toContainText('Starts a conversation', { timeout: 15_000 })
  await palette.choose('Message Jonas Weber')
  await newChat.expectConversation('Jonas Weber')
})

test('a command shows above the results with its confidence, and Enter runs it', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { palette } = juno

  await palette.open()
  await palette.expectResults()
  await palette.type('tell maya the wednesday slot works')
  await palette.expectResults()
  const command = palette.section('Juno').getByRole('option')
  await expect(command).toContainText('Send to Maya Chen', { timeout: 15_000 })
  await expect(command).toContainText('95%')
  await palette.expectActive(/Send to Maya Chen/)
  await palette.press('Enter')
  await palette.expectClosed()
  await juno.expectToast('Posted in Maya Chen · Main')
  await expect.poll(() => fake.calls.filter((call) => call.method === 'chat.postMessage').map((call) => [call.args['channel'], call.args['text']])).toEqual([['D0MAYA', 'the wednesday slot works']])
})

test("Slack's search adds what the cache lacks under the local rows, and opening it lands on the message", async ({ juno, slack, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { palette, topic } = juno
  slack.as('Sam').postedLongAgo('eng', 'The WAL position was approved sixty days ago', 60)

  fake.holdNext({ method: 'search.modules.messages', reason: 'palette' })
  await palette.open()
  await palette.expectResults()
  await palette.type('WAL position')
  await palette.expectResults()
  const local = palette.row('replay from the WAL position')
  await expect(local).toBeVisible()
  const active = await palette.input.getAttribute('aria-activedescendant')
  const before = await local.boundingBox()
  await expect.poll(() => fake.heldCount({ method: 'search.modules.messages' })).toBe(1)
  fake.release({ method: 'search.modules.messages' })
  const found = palette.row('The WAL position was approved sixty days ago')
  await expect(found).toBeVisible({ timeout: 15_000 })
  await expect(found).toContainText('#eng')
  expect(await local.boundingBox()).toEqual(before)
  await expect(palette.input).toHaveAttribute('aria-activedescendant', active!)
  await expect(palette.rows().first()).toContainText('replay from the WAL position')
  await palette.choose('The WAL position was approved sixty days ago')
  await palette.expectClosed()
  const message = topic.message('The WAL position was approved sixty days ago')
  await expect(message).toBeInViewport({ timeout: 15_000 })
})

test('keyboard only: ⌘K, type, arrows, Enter and Esc', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { palette, sidebar, tabs } = juno

  await palette.open()
  await palette.expectResults()
  await palette.type('platfo')
  await palette.expectResults()
  await palette.expectActive(/Public channel · Main/)
  await palette.press('ArrowDown')
  await palette.expectActive(/show its topics/)
  await palette.press('ArrowUp')
  await palette.expectActive(/Public channel · Main/)
  // Up from the first row wraps to the last, and down from there back to the first.
  await palette.press('ArrowUp')
  const last = (await palette.rows().last().innerText()).replace(/\s+/g, ' ').trim()
  await palette.expectActive(last)
  await palette.press('ArrowDown')
  await palette.expectActive(/Public channel · Main/)
  await palette.press('ArrowDown')
  await palette.press('Enter')
  await palette.expectClosed()
  await sidebar.expectScope('platform')

  await palette.open()
  await palette.expectResults()
  await palette.type('nothing like this anywhere')
  await palette.expectResults()
  await palette.expectNoMatches()
  await palette.press('Escape')
  await palette.expectClosed()
  await tabs.expectCount(0)
})


test('a better local match arriving later does not change what Enter opens', async ({ juno, slack }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { palette, topic } = juno
  await palette.open()
  await palette.expectResults()
  await palette.type('handoff')
  await palette.expectResults()
  await palette.expectActive(/Reminder: on-call handoff/)
  const active = await palette.input.getAttribute('aria-activedescendant')

  // The shorter message has a better FTS rank and becomes the first row.
  slack.as('Sam').postIn('platform', 'handoff')
  await expect(palette.rows().first()).toContainText('#platform')
  await expect(palette.input).toHaveAttribute('aria-activedescendant', active!)
  await palette.press('Enter')
  await palette.expectClosed()
  await expect(topic.message('Reminder: on-call handoff moves to Mondays starting next week.')).toBeInViewport()
})

test('an older Slack search cannot replace the results of a newer query', async ({ juno, slack, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { palette } = juno
  slack.as('Sam').postedLongAgo('eng', 'Amber archive evidence', 60)
  slack.as('Sam').postedLongAgo('platform', 'Violet archive evidence', 60)

  fake.holdNext({ method: 'search.modules.messages', reason: 'palette' })
  await palette.open()
  await palette.expectResults()
  await palette.type('Amber archive')
  await palette.expectResults()
  await expect.poll(() => fake.heldCount({ method: 'search.modules.messages' })).toBe(1)
  await palette.clear()
  await palette.type('Violet archive')
  await palette.expectResults()
  await expect(palette.row('Violet archive evidence')).toBeVisible()
  const active = await palette.input.getAttribute('aria-activedescendant')
  fake.release({ method: 'search.modules.messages' })

  // Wait for a subsequent live local update, not a sleep, while the older
  // HTTP response returns. Both local and Slack results must stay Violet.
  slack.as('Sam').postIn('platform', 'Violet archive current')
  await expect(palette.row('Violet archive current')).toBeVisible()
  await expect(palette.row('Violet archive evidence')).toBeVisible()
  await expect(palette.row('Amber archive evidence')).toHaveCount(0)
  await expect(palette.input).toHaveAttribute('aria-activedescendant', active!)
  await palette.press('Enter')
  await juno.topic.expectMessage('Violet archive evidence')
})
