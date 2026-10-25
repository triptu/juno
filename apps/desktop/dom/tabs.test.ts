// Tabs (SPEC 4): opening uses the current tab and typing goes to its composer, ⌘-click opens
// a new one, a plain open of an open topic focuses its tab, closing focuses the neighbour and
// never leaves no tab, a new tab opens Home and does not cancel an open still waiting, the app
// menu's tab items, ⌘W held down after a restart, and a tab not viewed for a day closes by itself.
import { readUserDb, savedTabs, threadId } from '../e2e/driver/userDb'
import type { Juno } from './driver/juno'
import { expect } from './expect'
import { domTest } from './test'

const POSTGRES = 'Draft plan is in the doc'
const RINA = 'Rina finished the onsite'
const ROADMAP = 'Proposal: cut offline mode and public'
const OFFSITE = 'Can eng take the Wednesday afternoon'

// Each step but the last ends with Home in the only tab, as a fresh launch shows it.
domTest('tabs open, focus and close from the sidebar, the keyboard and the app menu, and the last one closed leaves Home', async ({ juno, step }) => {
  await step('opening, ⌘-click, focusing an open topic and closing to the neighbour', () => openFocusAndClose(juno))
  await step('closing a tab from the keyboard leaves focus in the strip', () => closeFromKeyboard(juno))
  await step('closing the last tab leaves Home; ⌘T and "+" open Home in a new tab, ready to write', () => newTabsOpenHome(juno))
  await step('the app menu closes the tab and moves between tabs', () => appMenuMovesBetweenTabs(juno))
})

async function openFocusAndClose(juno: Juno): Promise<void> {
  const { sidebar, tabs } = juno
  // An open from the list keeps focus on its row for the arrows. Typing then goes to the composer (the test after this one).
  await sidebar.row(POSTGRES).open()
  await tabs.expectActive(POSTGRES)
  await sidebar.row(RINA).open()
  await tabs.expectCount(1)
  await tabs.expectActive(RINA)
  await sidebar.row(RINA).expectFocused()

  await sidebar.row(POSTGRES).openInNewTab()
  await tabs.expectCount(2)
  await tabs.expectActive(POSTGRES)
  await sidebar.row(ROADMAP).openInNewTab()
  await tabs.expectCount(3)
  expect(await tabs.titles()).toEqual([expect.stringMatching(/^Rina/), expect.stringMatching(/^Draft plan/), expect.stringMatching(/^Proposal/)])

  // Already open: its tab gets focus, no duplicate.
  await sidebar.row(RINA).open()
  await tabs.expectCount(3)
  await tabs.expectActive(RINA)
  await sidebar.row(RINA).expectSelected()

  await tabs.select(POSTGRES)
  await juno.topic.expectTitle(POSTGRES)

  await tabs.close(POSTGRES)
  await tabs.expectActive(ROADMAP)
  await tabs.close(ROADMAP)
  await tabs.expectActive(RINA)
  // Closing the last tab leaves Home, never no tab.
  await tabs.close(RINA)
  await juno.expectNothingOpen()
}

async function closeFromKeyboard(juno: Juno): Promise<void> {
  const { sidebar, tabs } = juno
  await sidebar.row(POSTGRES).open()
  await sidebar.row(RINA).openInNewTab()
  await sidebar.row(ROADMAP).openInNewTab()

  // The close buttons are not Tab stops: from the active tab, Tab goes straight to "+".
  await tabs.tab(ROADMAP).focus()
  await juno.win.keyboard.press('Tab')
  await expect(tabs.newTabButton).toBeFocused()

  // Delete on a focused tab closes it. The tab that slides into the closed one's place takes focus, so the next Tab goes on from the strip.
  await tabs.closeWithKeyboard(RINA)
  await tabs.expectCount(2)
  await tabs.expectFocused(ROADMAP)
  await tabs.closeWithKeyboard(ROADMAP)
  await tabs.expectFocused(POSTGRES)
  // The last one gives way to Home, whose composer takes focus.
  await tabs.closeWithKeyboard(POSTGRES)
  await juno.expectNothingOpen()
  await expect(juno.write.composer).toBeFocused()
}

async function newTabsOpenHome(juno: Juno): Promise<void> {
  const { sidebar, tabs } = juno
  await sidebar.row(POSTGRES).open()
  await tabs.expectCount(1)
  await tabs.close(POSTGRES)
  await juno.expectNothingOpen()

  await sidebar.row(POSTGRES).open()
  await tabs.menu('new-tab')
  await tabs.expectCount(2)
  await tabs.expectActive('Home')
  await juno.home.expectShown()
  await expect(juno.write.composer).toBeFocused()

  const homes = tabs.tab('Home').count()
  await tabs.newTabButton.click()
  await expect(tabs.tab('Home')).toHaveCount(homes + 1)
  await juno.home.expectShown()
  await expect(juno.write.composer).toBeFocused()

  // Closing every tab leaves one Home.
  await tabs.contextMenu(POSTGRES, 'close-all')
  await juno.expectNothingOpen()
}

async function appMenuMovesBetweenTabs(juno: Juno): Promise<void> {
  const { sidebar, tabs } = juno
  await sidebar.row(POSTGRES).open()
  await sidebar.row(RINA).openInNewTab()
  await sidebar.row(ROADMAP).openInNewTab()
  await tabs.expectActive(ROADMAP)

  await tabs.menu('next-tab')
  await tabs.expectActive(POSTGRES)
  await tabs.menu('previous-tab')
  await tabs.expectActive(ROADMAP)
  await tabs.menu('previous-tab')
  await tabs.expectActive(RINA)
  await tabs.menu('close-tab')
  await tabs.expectCount(2)
  await tabs.expectActive(ROADMAP)
}

domTest('typing right after an open from the list goes to the topic composer, even before the topic shows', async ({ juno }) => {
  const { sidebar, tabs, topic } = juno
  await sidebar.row(POSTGRES).open()
  await juno.win.keyboard.type('ok')
  await tabs.expectActive(POSTGRES)
  await expect(topic.composer).toBeFocused()
  await expect(topic.composer).toHaveValue('ok')
  await topic.composer.fill('')
  await sidebar.row(RINA).open()
  await sidebar.row(RINA).expectFocused()
  await juno.win.keyboard.type('x')
  await expect(topic.composer).toBeFocused()
  await expect(topic.composer).toHaveValue('x')
  await juno.win.keyboard.press('Backspace')
  await sidebar.row(POSTGRES).openInNewTab()
  await tabs.expectActive(POSTGRES)
  await juno.win.keyboard.type('x')
  await expect(topic.composer).toHaveValue('x')
})

domTest('⌘W held down closes a tab per press, even when the tabs it lands on were put away', async ({ juno, relaunch, userData, fake, slack }) => {
  const { sidebar, tabs } = juno
  const topics = [POSTGRES, RINA, ROADMAP, OFFSITE, 'Unrelated: has anyone looked at the', 'p95 on /v2/search jumped to 1.8s', 'Two options for the thread list', 'Final copy for pricing is in']
  await sidebar.row(topics[0]!).open()
  for (const title of topics.slice(1)) await sidebar.row(title).openInNewTab()
  await tabs.menu('tab-1')
  await tabs.expectActive(POSTGRES)
  // The save has reached the engine.
  await expect.poll(() => savedTabs(userData, fake.teamId)).toEqual({ tabs: topics.map((title) => ({ place: threadId(slack, title), pinned: false })), active: 0 })
  // After a relaunch only the active tab has its topic loaded, so showing any other one waits for the engine.
  const restarted = await relaunch()
  await restarted.tabs.expectCount(topics.length)
  await restarted.tabs.expectActive(POSTGRES)
  // Three presses in one go, as the key repeats.
  await restarted.surface.appMenu('close-tab', 3)
  await restarted.tabs.expectCount(topics.length - 3)
  await expect.poll(() => savedTabs(userData, fake.teamId)?.tabs.length).toBe(topics.length - 3)
  expect(await restarted.tabs.titles()).not.toContain(expect.stringMatching(/^Draft plan/))
})

// The sweep runs hourly on the page's clock, installed before any tab is viewed.
domTest('a tab not viewed for a day closes by itself, ⌘⇧T brings it back, and a tab with a draft stays', async ({ juno, userData, fake, slack, clock }) => {
  const { sidebar, tabs, topic } = juno
  await sidebar.row(POSTGRES).open()
  await sidebar.row(RINA).openInNewTab()
  await topic.composer.fill('Half a thought about the onsite')
  // The draft is saved.
  await expect.poll(() => readUserDb(userData, fake.teamId, (db) => db.prepare('SELECT text FROM drafts WHERE topic_id = ?').get(threadId(slack, RINA)))).toEqual({ text: 'Half a thought about the onsite' })
  await sidebar.row(ROADMAP).openInNewTab()
  await tabs.expectActive(ROADMAP)

  // A day and an hour later: the tab left a day ago closes, the one with a draft and the active one stay.
  await clock.fastForward('25:00:00')
  await expect.poll(() => tabs.titles()).toEqual([expect.stringMatching(/^Rina/), expect.stringMatching(/^Proposal/)])
  await tabs.expectActive(ROADMAP)

  await tabs.menu('reopen-tab')
  await expect.poll(() => tabs.titles()).toEqual([expect.stringMatching(/^Draft plan/), expect.stringMatching(/^Rina/), expect.stringMatching(/^Proposal/)])
  await tabs.expectActive(POSTGRES)
}, { clock: true })

domTest('a new tab asked for while a topic is still opening leaves that open in the old tab', async ({ juno }) => {
  const { sidebar, tabs } = juno
  // "+" is clicked in the same task as the press on the row, before the topic can paint.
  const plus = await tabs.newTabButton.element()
  juno.win.window.addEventListener('pointerdown', () => queueMicrotask(() => plus.click()), { once: true })
  await sidebar.row(POSTGRES).open()
  await expect.poll(() => tabs.titles()).toEqual([expect.stringMatching(/^Draft plan/), 'Home'])
  await tabs.expectActive('Home')
})
