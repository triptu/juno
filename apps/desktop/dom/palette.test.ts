// ⌘K (spec section 10): opening and closing it, its tabs, conversations, topics and messages from what
// this Mac stores and never from Slack, each kind in its group on All, a person never messaged, a model's
// command that sends, commands (the theme, an open topic's own, Settings' sections, a page), an active
// row that keeps its place while results change, and a results list that never commits empty while
// typing. Landing on a message in view is the notification test's (the long thread journey in topic.spec.ts).
import type { Juno } from './driver/juno'
import { expect } from './expect'
import { innerText } from './query'
import { domTest, type DomContext } from './test'

const POSTGRES = 'Draft plan is in the doc'
const ROADMAP = 'Proposal: cut offline mode and public'
const WAL = 'We keep the old primary warm for 48h. Flip DNS back and replay from the WAL position we logged.'
const THREAD = 'Theme switcher plan for Settings'
const REPLY = 'Draft is ready for review'
const MESSAGE = 'The dark theme ships on Friday'

async function openOnTheme(juno: Juno): Promise<void> {
  const { palette } = juno
  await palette.open()
  await palette.expectTab('All')
  await palette.type('theme')
  await palette.expectResults()
}

// ⌘K never waits on the network (performance 5.3). Sync's own discovery searches Slack too, never with typed text.
const searchedSlack = (fake: DomContext['fake']) => fake.calls.filter((call) => call.method.startsWith('search.') && /replica|platfo|nothing like/.test(String(call.args['query'])))

// The model's command goes first, so its post is the only one.
domTest('⌘K opens, switches tabs, finds conversations, topics, messages and people from this Mac, and runs a model\'s command', async ({ juno, fake, slack, step }) => {
  const { palette, tabs, topic, write, privacy } = juno

  await step('a model\'s command shows above the results, and Enter runs it', async () => {

    await palette.openMessages()
    await palette.expectResults()
    await palette.type('tell maya the wednesday slot works')
    await palette.expectResults()
    const command = palette.section('Juno').getByRole('option')
    await expect(command).toContainText('Send to Maya Chen', { timeout: 15_000 })
    await palette.expectActive(/Send to Maya Chen/)
    await palette.press('Enter')
    await palette.expectClosed()
    await juno.expectToast('Posted in Maya Chen · Main')
    await expect.poll(() => fake.calls.filter((call) => call.method === 'chat.postMessage').map((call) => [call.args['channel'], call.args['text']])).toEqual([['D0MAYA', 'the wednesday slot works']])
  })

  await step('opens on All with frequent ones, Tab and ⌘1 to ⌘4 switch tabs, and it closes with Esc, ⌘K or a press outside', () => openPalette({ juno }))
  await step('a channel typed in Conversations opens its Main with Enter, a person their DM, and ⌘Enter a new tab', () => openConversations({ juno }))

  await step('Messages finds a topic by its title from what this Mac stores, never asking Slack, and ⌘Enter opens one in a new tab', async () => {
    const open = (await tabs.titles()).length

    await step('Messages finds what this Mac stores, with apps hidden, and never asks Slack', async () => {
      await palette.open()
      await palette.type('replica')
      await palette.press('Meta+3')
      await palette.expectTab('Messages')
      await palette.expectResults()
      // Every match in the Postgres thread is one row, under its title.
      await expect(palette.row(POSTGRES)).toHaveCount(1)
      // Grafana's alerts on db-replica-2 are from an app.
      await expect(palette.row('db-replica-2')).toHaveCount(0)
      // That Slack was never asked is checked at the end of the test, long past the 400 ms after the last key when it used to be.
      await palette.press('Escape')
      await palette.expectClosed()
    })

    await palette.openMessages()
    await palette.expectResults()
    await palette.type('draft pla')
    await palette.expectResults()
    await palette.expectActive(POSTGRES)
    await palette.choose(POSTGRES)
    await palette.expectClosed()
    await topic.expectMessage('4 minutes is fine for us')
    await tabs.expectCount(open)

    await palette.openMessages()
    await palette.expectResults()
    await palette.type('on-call handoff')
    await palette.expectResults()
    await expect(palette.row('Reminder: on-call handoff')).toBeVisible()
    await palette.expectActive(/Reminder: on-call handoff/)
    await palette.press('Meta+Enter')
    await palette.expectClosed()
    await tabs.expectCount(open + 1)
  })

  await step('a message found by its text lands in its thread, flashing it; its snippet hides in privacy mode', async () => {

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
    await privacy.expectBlurred(row.locator('[data-sensitive]'), false)

    // Mentions read as names, never as Slack's markup.
    await palette.clear()
    await palette.type('replica sizing')
    await palette.expectResults()
    await expect(palette.row('replica sizing').locator('[data-sensitive]')).toContainText("Leo: …works. I'll pair. @Dev can you grab the replica sizing from #platform?", { timeout: 15_000 })
    await palette.clear()
    await palette.type('WAL position')
    await palette.expectResults()
    // The flash is a short animation on the message's row: record which rows animate.
    const flashed: string[] = []
    const proto = (juno.win.window as unknown as { Element: typeof Element }).Element.prototype
    const animate = proto.animate
    proto.animate = function (this: Element, ...args: Parameters<Element['animate']>) {
      if ((this as HTMLElement).dataset['messageRow'] !== undefined) flashed.push(this.textContent ?? '')
      return animate.apply(this, args)
    }
    await palette.choose('replay from the WAL position')
    await palette.expectClosed()
    await topic.expectMessage(WAL)
    await expect.poll(() => flashed.some((text) => text.includes('replay from the WAL position'))).toBe(true)
  })

  await step('a person never messaged opens Home addressed to them', async () => {

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

  await step('a better local match arriving later does not change what Enter opens', async () => {
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
    await topic.expectMessage('Reminder: on-call handoff moves to Mondays starting next week.')
  })

  expect(searchedSlack(fake)).toEqual([])
})

// The channel's menu, which scopes the sidebar, goes last.
domTest('⌘K runs commands (the theme, an open topic\'s, Settings\' sections), shows each kind on All, and keeps its results while typing', async ({ juno, fake, slack, step }) => {
  const { palette, sidebar, tabs, topic, settings } = juno

  await step('commands: ">theme" switches the theme, and an open topic\'s commands resolve it', async () => {

    await step('">" switches to Commands, and ">theme" then Dark switches the theme', async () => {
      const theme = () => juno.win.document.documentElement.getAttribute('data-theme')

      await palette.open()
      await palette.type('>')
      await palette.expectTab('Commands')
      await expect(palette.input).toHaveValue('')
      await palette.type('theme')
      await expect(palette.section('Commands').getByRole('option', { name: /Theme: Dark/ })).toBeVisible()
      await palette.choose('Theme: Dark')
      await palette.expectClosed()
      await expect.poll(theme).toBe('dark')

      // Typed without ">", a command shows on All in its group.
      await palette.open()
      await palette.type('theme light')
      await palette.expectActive(/Theme: Light/)
      await palette.press('Enter')
      await expect.poll(theme).toBe('light')
    })

    await step('with a topic open, its commands come first under its name, and "resolve" resolves it', async () => {
      // The theme command closed ⌘K.
      await palette.expectClosed()
      const roadmap = sidebar.row(ROADMAP)

      await roadmap.open()
      await juno.topic.expectTitle(ROADMAP)
      await palette.open()
      await palette.type('>')
      const group = palette.section(ROADMAP)
      await expect(group.getByRole('option').first()).toBeVisible()
      await palette.clear()
      await palette.type('resolve')
      await palette.expectActive(/Resolve$/)
      await palette.press('Enter')
      await palette.expectClosed()
      await juno.expectToast(`Resolved · ${ROADMAP}`)
      await expect(juno.topic.header.getByRole('button', { name: 'Reopen' })).toBeVisible()
      await palette.open()
      await palette.type('>')
      await expect(group.getByRole('option', { name: /Reopen/ })).toBeVisible()
      await palette.press('Escape')
      await palette.expectClosed()
    })
  })

  await step('"settings" on Commands finds Settings: Notifications, and Enter opens Settings there', async () => {
    await palette.openCommands()
    await palette.type('settings')
    await palette.row('Settings: Notifications').hover()
    await palette.expectActive(/Settings: Notifications/)
    await palette.press('Enter')
    await palette.expectClosed()
    await tabs.expectActive('Settings')
    await expect(settings.section('Notifications')).toHaveAttribute('aria-current', 'page')
  })
  await step('All shows topics, messages and commands for one word, Enter opens a thread and lands on a message, and ⌘3 and ⌘4 keep the text', async () => {
    slack.as('Leo').postIn('eng', THREAD)
    slack.as('Dev').replyIn(THREAD, REPLY)
    slack.as('Maya').postIn('product', MESSAGE)
    await openOnTheme(juno)
    const found = palette.section('Topics and messages').getByRole('option')
    // The thread's title and its root both match: one row.
    await expect(found.filter({ hasText: THREAD })).toHaveCount(1, { timeout: 15_000 })
    await expect(found.filter({ hasText: MESSAGE })).toBeVisible({ timeout: 15_000 })
    await expect(palette.section('Pages, settings and commands').getByRole('option', { name: /Theme: Dark/ })).toBeVisible()
    await palette.arrowTo(THREAD)
    await palette.press('Enter')
    await palette.expectClosed()
    await topic.expectMessage(REPLY)

    await openOnTheme(juno)
    await palette.arrowTo(MESSAGE)
    await palette.press('Enter')
    await palette.expectClosed()
    await topic.expectTitle('Main')
    await topic.expectMessage(MESSAGE)

    await openOnTheme(juno)
    await palette.press('Meta+3')
    await palette.expectTab('Messages')
    await expect(palette.input).toHaveValue('theme')
    await expect(palette.section('Topics and messages').getByRole('option').filter({ hasText: MESSAGE })).toBeVisible()
    await palette.press('Meta+4')
    await palette.expectTab('Commands')
    await expect(palette.input).toHaveValue('theme')
    await palette.press('Escape')
    await palette.expectClosed()
  })

  await step('the results list never commits empty while typing unmatched text, and clearing shows the starting rows again', async () => {
    const document = juno.win.document
    await palette.open()

    for (const tab of ['All', 'Messages'] as const) {
      await step(tab, async () => {
        await palette.tab(tab).click()
        await palette.expectResults()
        await expect(palette.rows().first()).toBeVisible()

        // After each change to the page: whether the results list has a body while the field has text.
        const collapsed: string[] = []
        let seen = 0
        const Observer = (juno.win.window as unknown as { MutationObserver: typeof MutationObserver }).MutationObserver
        const observer = new Observer(() => {
          const query = document.querySelector<HTMLInputElement>('[role="dialog"] [role="combobox"]')?.value ?? ''
          if (query === '') return
          seen++
          const list = document.getElementById('palette-results')
          const body = list !== null && (list.querySelector('[role="option"]') !== null || list.textContent?.includes('No matches.') === true)
          if (!body) collapsed.push(query)
        })
        observer.observe(palette.root.el()!, { subtree: true, childList: true, characterData: true, attributes: true })
        try {
          for (const character of 'zzunmatched 122') {
            await palette.type(character)
            await palette.expectResults()
          }
          await expect(palette.root.getByText('No matches.', { exact: true })).toBeVisible()
          expect(seen).toBeGreaterThan(0)
          expect(collapsed, `${tab}: collapsed commits`).toEqual([])
        } finally {
          observer.disconnect()
        }

        await palette.clear()
        await expect(palette.root.locator('#palette-results')).toContainText(tab === 'Messages' ? 'Recent' : 'Frequent')
        await expect(palette.root.locator('#palette-results')).not.toContainText('No matches.')
        await palette.expectResults()
      })
    }
    await palette.press('Escape')
    await palette.expectClosed()
  })


    await step('keyboard only: ⌘K, type, arrows, Enter and Esc', async () => {
      await palette.open()
      await palette.type('platfo')
      await palette.expectResults()
      await palette.expectActive(/platform$/)
      // Up from the first row wraps to the last, and down from there back to the first.
      await palette.press('ArrowUp')
      await palette.expectActive(innerText(palette.rows().all().at(-1)!))
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

    await step("a channel's menu shows its topics", async () => {
      await palette.open()
      await palette.type('platfo')
      await palette.expectResults()
      await palette.chooseFromMenu(/platform$/, 'show-topics')
      await palette.expectClosed()
      await sidebar.expectScope('platform')
    })

    expect(searchedSlack(fake)).toEqual([])
})

async function openPalette({ juno }: Pick<DomContext, 'juno'>): Promise<void> {
  const { palette, tabs } = juno

  await palette.open()
  await palette.expectTab('All')
  await palette.expectResults()
  // With no text, All shows the most used conversations and the latest topics.
  await expect(palette.section('Frequent').getByRole('option').first()).toBeVisible()
  await expect(palette.section('Recent').getByRole('option').first()).toBeVisible()
  // Tab goes round the tabs, focus staying in the field; ⌘2 picks one.
  await palette.press('Tab')
  await palette.expectTab('Conversations')
  await palette.press('Meta+2')
  await palette.expectTab('Conversations')
  await palette.press('Escape')
  await palette.expectClosed()

  // Each open starts on All.
  await palette.shortcut()
  await palette.expectOpen()
  await palette.expectTab('All')
  await palette.shortcut()
  await palette.expectClosed()

  // A press on the dim around it.
  await palette.open()
  await palette.expectResults()
  await palette.root.parent().click()
  await palette.expectClosed()

  // The first frequent conversation is active, and Enter opens it in the current tab.
  await palette.open()
  await palette.expectResults()
  await expect.poll(() => palette.activeText()).not.toBe('')
  await palette.press('Enter')
  await palette.expectClosed()
  await tabs.expectCount(1)
}

async function openConversations({ juno }: Pick<DomContext, 'juno'>): Promise<void> {
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
