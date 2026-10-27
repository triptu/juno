// Tabs (spec sections 4 and 6): opening uses the current tab and typing goes to its composer, ⌘-click
// opens a new one, a plain open of an open topic focuses its tab, closing focuses the neighbour and
// never leaves no tab, a new tab opens Home and does not cancel an open still waiting, the app menu's
// tab items, each tab's Back and Forward, the reopen stack with each tab's history, the unread dot on
// an inactive tab and each tab's composer focus. What a relaunch keeps is in tabs-relaunch.test.ts.
import type { Juno } from './driver/juno'
import { expect } from './expect'
import { domTest } from './test'

const POSTGRES = 'Draft plan is in the doc'
const RINA = 'Rina finished the onsite'
const ROADMAP = 'Proposal: cut offline mode and public'
const OFFSITE = 'Can eng take the Wednesday afternoon'

/** Closes every tab, which leaves one Home with a history of its own, as a fresh launch shows it. */
async function freshHome(juno: Juno): Promise<void> {
  const [first] = await juno.tabs.titles()
  await juno.tabs.contextMenu(first!, 'close-all')
  await juno.expectNothingOpen()
}

// One launch: typing after an open goes first, while no topic has been opened. The other steps start from one Home tab.
domTest('tabs open, focus, close, go back and forward and reopen from the sidebar, the keyboard and the app menu', async ({ juno, slack, step }) => {
  await step('typing right after an open from the list goes to the topic composer, even before the topic shows', async () => {
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
    await topic.composer.fill('')
    await freshHome(juno)
  })

  await step('⌘⇧T reopens closed tabs, the last closed first, each with its history; an inactive tab shows the unread dot until its topic is read', async () => {
    const { sidebar, tabs, topic, nav } = juno

    await sidebar.row(POSTGRES).open()
    await sidebar.row(OFFSITE).openInNewTab()
    await sidebar.row(RINA).open()
    await sidebar.row(ROADMAP).openInNewTab()
    await expect.poll(() => tabs.titles()).toEqual([expect.stringMatching(/^Draft plan/), expect.stringMatching(/^Rina/), expect.stringMatching(/^Proposal/)])

    await tabs.close(RINA)
    await tabs.close(ROADMAP)
    await tabs.expectCount(1)

    await tabs.menu('reopen-tab')
    await tabs.expectActive(ROADMAP)
    await expect.poll(() => tabs.titles()).toEqual([expect.stringMatching(/^Draft plan/), expect.stringMatching(/^Proposal/)])
    await tabs.menu('reopen-tab')
    await tabs.expectActive(RINA)
    await expect.poll(() => tabs.titles()).toEqual([expect.stringMatching(/^Draft plan/), expect.stringMatching(/^Rina/), expect.stringMatching(/^Proposal/)])
    await topic.expectTitle(RINA)

    // The tab came back with what it showed before.
    await nav.expectCanGo(true, false)
    await nav.back()
    await topic.expectTitle(OFFSITE)


    // The tabs now show the Draft plan, the offsite (active) and the roadmap; all three topics are read.
    await sidebar.row(POSTGRES).expectRead()
    await tabs.expectUnread(POSTGRES, false)
    slack.as('Leo').replyIn(POSTGRES, 'Replica check passed.')
    await sidebar.row(POSTGRES).expectUnread(1)
    await tabs.expectUnread(POSTGRES)
    await tabs.expectUnread(ROADMAP, false)

    // The active tab never shows it; opening marks read, so it stays gone.
    await tabs.select(POSTGRES)
    await tabs.expectUnread(POSTGRES, false)
    await sidebar.row(POSTGRES).expectRead()
    await tabs.select(ROADMAP)
    await tabs.expectUnread(POSTGRES, false)
    await freshHome(juno)
  })

  await step('Back and Forward move through the topics one tab showed', async () => {
    const { sidebar, tabs, topic, nav } = juno

    await nav.expectCanGo(false, false)
    await sidebar.row(POSTGRES).open()
    await topic.expectTitle(POSTGRES)
    await sidebar.row(RINA).open()
    await topic.expectTitle(RINA)
    await sidebar.row(ROADMAP).open()
    await topic.expectTitle(ROADMAP)
    await tabs.expectCount(1)
    await nav.expectCanGo(true, false)

    await nav.back()
    await topic.expectTitle(RINA)
    await tabs.expectActive(RINA)
    await sidebar.row(RINA).expectSelected()
    await nav.menu('back')
    await topic.expectTitle(POSTGRES)
    // The launch tab began at Home, so Back still has Home behind the first topic.
    await nav.expectCanGo(true, true)

    await nav.forward()
    await topic.expectTitle(RINA)
    await nav.mouseButton(4)
    await topic.expectTitle(ROADMAP)
    await nav.expectCanGo(true, false)
    await nav.mouseButton(3)
    await topic.expectTitle(RINA)
    await nav.menu('forward')
    await topic.expectTitle(ROADMAP)
    await tabs.expectCount(1)

    // Opening something after going back drops Forward.
    await nav.back()
    await topic.expectTitle(RINA)
    await sidebar.row(OFFSITE).open()
    await topic.expectTitle(OFFSITE)
    await nav.expectCanGo(true, false)
    await nav.back()
    await topic.expectTitle(RINA)

    // A new tab has its own history, starting at Home; a topic opened in it goes after Home, so Back returns there.
    await tabs.menu('new-tab')
    await tabs.expectCount(2)
    await tabs.expectActive('Home')
    await nav.expectCanGo(false, false)
    await sidebar.row(POSTGRES).open()
    await tabs.expectCount(2)
    await tabs.expectActive(POSTGRES)
    await nav.expectCanGo(true, false)
    await tabs.select(RINA)
    await nav.expectCanGo(true, true)
    await freshHome(juno)
  })

  await step('a click on the topic on screen, while another open waits for its topic, keeps the topic on screen', async () => {
    const { sidebar, tabs, topic } = juno
    await sidebar.row(POSTGRES).open()
    await topic.expectTitle(POSTGRES)
    // Rina's open waits for her thread to paint; the second click, on the topic on screen, is the last ask.
    await sidebar.row(RINA).open()
    await sidebar.row(POSTGRES).open()
    // Changes apply in the order asked, so once the new tab shows, Rina's open has applied or been dropped.
    await tabs.menu('new-tab')
    await tabs.expectActive('Home')
    await tabs.select(POSTGRES)
    await topic.expectTitle(POSTGRES)
    await freshHome(juno)
  })

  await step('opening, ⌘-click, focusing an open topic and closing to the neighbour', () => openFocusAndClose(juno))
  await step('closing a tab from the keyboard leaves focus in the strip', () => closeFromKeyboard(juno))
  await step('closing the last tab leaves Home; ⌘T and "+" open Home in a new tab, ready to write', () => newTabsOpenHome(juno))
  await step('the app menu closes the tab and moves between tabs', async () => {
    await appMenuMovesBetweenTabs(juno)
    await freshHome(juno)
  })

  await step('each tab gets its composer focus back after a keyboard tab switch', async () => {
    await juno.sidebar.row(POSTGRES).open()
    await juno.topic.composer.click()
    await juno.topic.composer.pressSequentially('Typing in the topic')
    await juno.tabs.menu('new-tab')
    await expect(juno.write.composer).toBeFocused()
    await juno.write.composer.pressSequentially('Typing on Home')
    await juno.tabs.menu('previous-tab')
    await juno.tabs.expectActive(POSTGRES)
    await expect(juno.topic.composer).toBeFocused()
    await juno.tabs.menu('next-tab')
    await juno.tabs.expectActive('Home')
    await expect(juno.write.composer).toBeFocused()
    await juno.write.composer.fill('')
    await juno.tabs.select(POSTGRES)
    await juno.topic.composer.fill('')
    await freshHome(juno)
  })

  await step('a new tab asked for while a topic is still opening leaves that open in the old tab', async () => {
    const { sidebar, tabs } = juno
    // "+" is clicked in the same task as the press on the row, before the topic can paint.
    const plus = await tabs.newTabButton.element()
    juno.win.window.addEventListener('pointerdown', () => queueMicrotask(() => plus.click()), { once: true })
    await sidebar.row(POSTGRES).open()
    await expect.poll(() => tabs.titles()).toEqual([expect.stringMatching(/^Draft plan/), 'Home'])
    await tabs.expectActive('Home')
    await freshHome(juno)
  })
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
  // A new tab can show before its topic has given it a title.
  await expect.poll(() => tabs.titles()).toEqual([expect.stringMatching(/^Rina/), expect.stringMatching(/^Draft plan/), expect.stringMatching(/^Proposal/)])

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
