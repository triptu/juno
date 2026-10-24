import { expect, test, type Fixtures } from './fixtures'

// Starts signed in and synced (README, "Synced start").
test.use({ synced: true })

test.describe.configure({ timeout: 120_000 })

const POSTGRES = 'Draft plan is in the doc'
const ROADMAP = 'Proposal: cut offline mode and public'
const WAL = 'We keep the old primary warm for 48h. Flip DNS back and replay from the WAL position we logged.'

test('opens and dismisses the palette, switches search modes and opens conversations', async ({ juno }) => {
  const context = { juno }
  await test.step('opens on All with frequent ones, Tab and ⌘1 to ⌘4 switch tabs, and it closes with Esc, ⌘K or a press outside', () => openPalette(context))
  await test.step('a channel typed in Conversations opens its Main with Enter, a person their DM, and ⌘Enter a new tab', () => openConversations(context))
})

async function openPalette({ juno }: Pick<Fixtures, 'juno'>): Promise<void> {
  const { palette, sidebar, tabs } = juno

  await palette.open()
  await palette.expectTab('All')
  await palette.expectResults()
  // With no text, All shows the most used conversations and the latest topics, four and five.
  await expect(palette.section('Frequent').getByRole('option')).toHaveCount(4)
  await expect(palette.section('Recent').getByRole('option')).toHaveCount(5)
  // Tab and Shift Tab go round the tabs; focus stays in the field, never reaching the window under the dim.
  await palette.press('Tab')
  await palette.expectTab('Conversations')
  await expect(palette.input).toHaveAttribute('placeholder', 'Find a conversation')
  await palette.press('Tab')
  await palette.expectTab('Messages')
  await palette.expectResults()
  await expect(palette.section('Recent').getByRole('option')).toHaveCount(6)
  await palette.press('Tab')
  await palette.expectTab('Commands')
  await expect(palette.section('Pages').getByRole('option', { name: /All topics/ })).toBeVisible()
  await palette.press('Tab')
  await palette.expectTab('All')
  await palette.press('Shift+Tab')
  await palette.expectTab('Commands')
  await palette.press('Meta+2')
  await palette.expectTab('Conversations')
  await palette.press('Meta+1')
  await palette.expectTab('All')
  // A tab switches on press too, and the field keeps focus.
  await palette.tab('Messages').click()
  await palette.expectTab('Messages')
  await palette.press('Escape')
  await palette.expectClosed()

  // Each open starts on All.
  await sidebar.searchButton.click()
  await palette.expectOpen()
  await palette.expectTab('All')
  await palette.shortcut()
  await palette.expectClosed()

  await palette.open()
  await palette.expectResults()
  await juno.win.mouse.click(10, 300)
  await palette.expectClosed()

  // The first frequent conversation is active, and Enter opens it in the current tab.
  await palette.open()
  await palette.expectResults()
  expect(await palette.activeText()).not.toBe('')
  await palette.press('Enter')
  await palette.expectClosed()
  await tabs.expectCount(1)
}

async function openConversations({ juno }: Pick<Fixtures, 'juno'>): Promise<void> {
  const { palette, topic, tabs } = juno

  await palette.open()
  await palette.type('platfo')
  await palette.expectResults()
  await palette.expectActive(/platform$/)
  await palette.press('Enter')
  await palette.expectClosed()
  await topic.expectTitle('Main')
  await expect(topic.header).toContainText('platform')
  // Opened from ⌘K, the topic is ready to type in.
  await expect(topic.composer).toBeFocused()
  await tabs.expectCount(1)

  await palette.open()
  await palette.type('maya')
  await palette.expectResults()
  // Maya's DM, or a group DM she is in, whichever is used most.
  await palette.expectActive(/Maya/)
  await palette.press('Meta+Enter')
  await palette.expectClosed()
  await tabs.expectCount(2)
  await topic.expectTitle('Main')
}

test('commands: ">theme" switches the theme, and an open topic\'s commands resolve it', async ({ juno }) => {
  const { palette, sidebar } = juno

  await test.step('">" switches to Commands, and ">theme" then Dark switches the theme', async () => {
    const scheme = () => juno.win.evaluate(() => getComputedStyle(document.documentElement).colorScheme)

    await palette.open()
    await palette.type('>')
    await palette.expectTab('Commands')
    await expect(palette.input).toHaveValue('')
    await expect(palette.section('Commands').getByRole('option', { name: /New tab/ })).toBeVisible()
    await expect(palette.section('Settings').getByRole('option', { name: /Settings: Appearance/ })).toBeVisible()
    await palette.type('theme')
    await expect(palette.section('Commands').getByRole('option')).toHaveCount(3)
    await palette.choose('Theme: Dark')
    await palette.expectClosed()
    await expect.poll(scheme).toBe('dark')

    // Typed without ">", a command shows on All in its group.
    await palette.open()
    await palette.type('theme light')
    await palette.expectActive(/Theme: Light/)
    await palette.press('Enter')
    await expect.poll(scheme).toBe('light')
  })

  await test.step('with a topic open, its commands come first under its name, and "resolve" resolves it', async () => {
    // The theme command closed ⌘K.
    await palette.expectClosed()
    const roadmap = sidebar.row(ROADMAP)

    await roadmap.open()
    await palette.open()
    await palette.type('>')
    const group = palette.section(ROADMAP)
    await expect(group.getByRole('option', { name: /Pin/ })).toBeVisible()
    await expect(group.getByRole('option', { name: /Copy Slack link/ })).toBeVisible()
    await expect(group.getByRole('option', { name: /Rename thread/ })).toBeVisible()
    await palette.clear()
    await palette.type('resolve')
    await palette.expectActive(/Resolve$/)
    await palette.press('Enter')
    await palette.expectClosed()
    await juno.expectToast(`Resolved · ${ROADMAP}`)
    await expect(juno.topic.header.getByRole('button', { name: 'Reopen' })).toBeVisible()
    // The command gave focus back to where it was.
    await expect(palette.input).toHaveCount(0)
    await palette.open()
    await palette.type('>')
    await expect(group.getByRole('option', { name: /Reopen/ })).toBeVisible()
  })
})

test('finds a topic by its title and opens it; ⌘Enter opens one in a new tab', async ({ juno }) => {
  const { palette, topic, tabs } = juno

  await palette.openMessages()
  await palette.expectResults()
  await palette.type('draft pla')
  await palette.expectResults()
  await palette.expectActive(POSTGRES)
  await palette.choose(POSTGRES)
  await palette.expectClosed()
  await topic.expectMessage('4 minutes is fine for us')
  await tabs.expectCount(1)

  await palette.openMessages()
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
  const { palette, topic, privacy } = juno

  await palette.openMessages()
  await palette.expectResults()
  await palette.type('WAL position')
  await palette.expectResults()
  const row = palette.row('replay from the WAL position')
  await expect(row).toBeVisible({ timeout: 15_000 })
  // A long message starts a few words before the match, so the matched words show.
  await expect(row.locator('[data-sensitive]')).toHaveText('Leo: …for 48h. Flip DNS back and replay from the WAL position we logged.')
  await privacy.toggleWithMenu()
  await privacy.expectBlurred(row.locator('[data-sensitive]'))
  await privacy.toggleWithMenu()

  // Mentions read as names, never as Slack's markup.
  await palette.clear()
  await palette.type('replica sizing')
  await palette.expectResults()
  await expect(palette.row('replica sizing').locator('[data-sensitive]')).toContainText("Leo: …works. I'll pair. @Dev can you grab the replica sizing from #platform?", { timeout: 15_000 })
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

test('a person never messaged opens Home addressed to them', async ({ juno }) => {
  const { palette, write, tabs } = juno

  await palette.open()
  await palette.type('jonas')
  await palette.expectResults()
  const jonas = palette.section('Conversations').getByRole('option', { name: /Jonas/ })
  await expect(jonas).toContainText('Starts a conversation', { timeout: 15_000 })
  await jonas.click()
  await tabs.expectActive('Home')
  await write.expectDestination('Jonas')
  await expect(write.composer).toBeFocused()
})

test('a command shows above the results with its confidence, and Enter runs it', async ({ juno, fake }) => {
  const { palette } = juno

  await palette.openMessages()
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

test('channels from the keyboard and from their menu', async ({ juno, fake }) => {
  const { palette, sidebar, tabs } = juno

  await test.step('keyboard only: ⌘K, type, arrows, Enter and Esc', async () => {
    await palette.open()
    await palette.type('platfo')
    await palette.expectResults()
    await palette.expectActive(/platform$/)
    // Up from the first row wraps to the last, and down from there back to the first.
    await palette.press('ArrowUp')
    const last = (await palette.rows().last().innerText()).replace(/\s+/g, ' ').trim()
    await palette.expectActive(last)
    await palette.press('ArrowDown')
    await palette.expectActive(/platform$/)
    await palette.press('Enter')
    await palette.expectClosed()
    await tabs.expectActive('platform')

    await palette.open()
    await palette.type('nothing like this anywhere')
    await palette.expectResults()
    await palette.expectNoMatches()
    await palette.press('Escape')
    await palette.expectClosed()
  })

  await test.step("a channel's menu shows its topics", async () => {
    await palette.open()
    await palette.type('platfo')
    await palette.expectResults()
    await palette.chooseFromMenu(/platform$/, 'show-topics')
    await palette.expectClosed()
    await sidebar.expectScope('platform')
  })

  // ⌘K never waits on the network (performance 5.3). Sync's own discovery searches Slack too, never with typed text.
  expect(fake.calls.filter((call) => call.method.startsWith('search.') && /platfo|nothing like/.test(String(call.args['query'])))).toEqual([])
})

test('Messages finds what this Mac stores, with apps hidden, and never asks Slack', async ({ juno, fake }) => {
  const { palette, topic } = juno

  await palette.open()
  await palette.type('replica')
  await palette.press('Meta+3')
  await palette.expectTab('Messages')
  await palette.expectResults()
  // Every match in the Postgres thread is one row, under its title.
  await expect(palette.row(POSTGRES)).toHaveCount(1)
  // Grafana's alerts on db-replica-2 are from an app.
  await expect(palette.row('db-replica-2')).toHaveCount(0)
  // Slack's search used to be asked 400 ms after the last key: wait past that.
  await juno.win.waitForTimeout(1_000)
  // Sync's own discovery searches Slack too, never with typed text.
  expect(fake.calls.filter((call) => call.method.startsWith('search.') && String(call.args['query']).includes('replica'))).toEqual([])
  await palette.choose(POSTGRES)
  await palette.expectClosed()
  await topic.expectMessage('4 minutes is fine for us')
})

test('a better local match arriving later does not change what Enter opens', async ({ juno, slack }) => {
  const { palette, topic } = juno
  await palette.openMessages()
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
