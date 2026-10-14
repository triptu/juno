// Browser-like navigation (spec sections 4 and 6): each tab's Back and
// Forward, the reopen stack, pinned tabs and the tab menu, the tab keys,
// the unread dot, and the sidebar's resize and hide.
import { expect, launchApp, test } from './fixtures'
import { Juno } from './driver/juno'

test.describe.configure({ timeout: 120_000 })

const POSTGRES = 'Draft plan is in the doc'
const RINA = 'Rina finished the onsite.'
const ROADMAP = 'Proposal: cut offline mode and public'
const OFFSITE = 'Can eng take the Wednesday afternoon'

test('Back and Forward move through the topics one tab showed', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { sidebar, tabs, topic, nav } = juno

  await nav.expectCanGo(false, false)
  await sidebar.row(POSTGRES).open()
  await sidebar.row(RINA).open()
  await sidebar.row(ROADMAP).open()
  await tabs.expectCount(1)
  await nav.expectCanGo(true, false)

  await nav.back()
  await topic.expectTitle(RINA)
  await tabs.expectActive(RINA)
  await sidebar.row(RINA).expectSelected()
  await nav.menu('back')
  await topic.expectTitle(POSTGRES)
  await nav.expectCanGo(false, true)

  await nav.forward()
  await topic.expectTitle(RINA)
  await nav.mouseButton(4)
  await topic.expectTitle(ROADMAP)
  await nav.expectCanGo(true, false)
  await nav.mouseButton(3)
  await topic.expectTitle(RINA)
  await nav.swipe('right')
  await topic.expectTitle(ROADMAP)
  await nav.swipe('left')
  await topic.expectTitle(RINA)
  await nav.menu('forward')
  await topic.expectTitle(ROADMAP)
  await tabs.expectCount(1)

  // Opening something after going back drops Forward.
  await nav.back()
  await sidebar.row(OFFSITE).open()
  await topic.expectTitle(OFFSITE)
  await nav.expectCanGo(true, false)
  await nav.back()
  await topic.expectTitle(RINA)

  // A new tab has its own, empty history; a topic opened in it replaces its New chat.
  await tabs.menu('new-tab')
  await tabs.expectCount(2)
  await tabs.expectActive('New chat')
  await juno.expectNothingOpen()
  await nav.expectCanGo(false, false)
  await sidebar.row(POSTGRES).open()
  await tabs.expectCount(2)
  await tabs.expectActive(POSTGRES)
  await nav.expectCanGo(false, false)
  await tabs.select(RINA)
  await nav.expectCanGo(true, true)
})

test('⌘⇧T reopens closed tabs, the last closed first, each with its history', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { sidebar, tabs, topic, nav } = juno

  await sidebar.row(POSTGRES).open()
  await sidebar.row(OFFSITE).openInNewTab()
  await sidebar.row(RINA).open()
  await sidebar.row(ROADMAP).openInNewTab()
  expect(await tabs.titles()).toEqual([expect.stringMatching(/^Draft plan/), expect.stringMatching(/^Rina/), expect.stringMatching(/^Proposal/)])

  await tabs.close(RINA)
  await tabs.close(ROADMAP)
  await tabs.expectCount(1)

  await tabs.menu('reopen-tab')
  await tabs.expectActive(ROADMAP)
  expect(await tabs.titles()).toEqual([expect.stringMatching(/^Draft plan/), expect.stringMatching(/^Proposal/)])
  await tabs.menu('reopen-tab')
  await tabs.expectActive(RINA)
  expect(await tabs.titles()).toEqual([expect.stringMatching(/^Draft plan/), expect.stringMatching(/^Rina/), expect.stringMatching(/^Proposal/)])
  await topic.expectTitle(RINA)

  // The tab came back with what it showed before.
  await nav.expectCanGo(true, false)
  await nav.back()
  await topic.expectTitle(OFFSITE)

  // Nothing left to reopen.
  await tabs.menu('reopen-tab')
  await tabs.expectCount(3)
})

test('the tab menu pins, unpins and closes, and pins survive a restart', async ({ juno, running, userData, fake, slackApp }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { sidebar, tabs } = juno

  await sidebar.row(POSTGRES).open()
  await sidebar.row(RINA).openInNewTab()
  await sidebar.row(ROADMAP).openInNewTab()

  const labels = await tabs.contextMenu(ROADMAP, 'pin')
  expect(labels).toEqual(['Pin tab', '-', 'Close tab', 'Close other tabs', '(Close tabs to the right)', 'Close all tabs', '-', 'Copy Slack link', 'Open in Slack'])
  await tabs.expectPinned(ROADMAP)
  expect(await tabs.titles()).toEqual([expect.stringMatching(/^Proposal/), expect.stringMatching(/^Draft plan/), expect.stringMatching(/^Rina/)])
  await expect(tabs.closeButton(ROADMAP)).toHaveCount(0)
  const pinnedBox = await tabs.tab(ROADMAP).boundingBox()
  expect(Math.round(pinnedBox?.width ?? 0)).toBe(40)

  // ⌘1 counts the pinned tab; ⌘9 is the last tab.
  await tabs.menu('tab-1')
  await tabs.expectActive(ROADMAP)
  await tabs.menu('tab-last')
  await tabs.expectActive(RINA)
  await tabs.menu('next-tab-control')
  await tabs.expectActive(ROADMAP)

  // Close other tabs leaves the pinned one.
  await tabs.contextMenu(POSTGRES, 'close-others')
  await tabs.expectCount(2)
  await tabs.expectActive(POSTGRES)
  expect(await tabs.titles()).toEqual([expect.stringMatching(/^Proposal/), expect.stringMatching(/^Draft plan/)])

  // Copy Slack link and Open in Slack.
  await tabs.contextMenu(POSTGRES, 'copy-link')
  await expect.poll(() => juno.app.evaluate(({ clipboard }) => clipboard.readText())).toMatch(/\/archives\/C[A-Z0-9]+\/p\d+$/)
  await tabs.contextMenu(POSTGRES, 'open-in-slack')
  const opened = await juno.app.evaluate(() => [...(globalThis as unknown as { junoTest: { slackLinks: string[] } }).junoTest.slackLinks])
  expect(opened).toEqual([expect.stringMatching(/^slack:\/\/channel\?team=T0JUNO&id=C[A-Z0-9]+$/)])

  // Let the save reach the engine.
  await juno.win.waitForTimeout(500)
  await running.close()
  const again = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword })
  try {
    const restarted = new Juno(again.app, again.win)
    await restarted.tabs.expectCount(2)
    await restarted.tabs.expectPinned(ROADMAP)
    await restarted.tabs.expectPinned(POSTGRES, false)
    expect(await restarted.tabs.contextMenu(ROADMAP, 'pin')).toContain('Unpin tab')
    await restarted.tabs.expectPinned(ROADMAP, false)
    expect(await restarted.tabs.titles()).toEqual([expect.stringMatching(/^Proposal/), expect.stringMatching(/^Draft plan/)])
    await expect(restarted.tabs.closeButton(ROADMAP)).toHaveCount(1)
  } finally {
    await again.close()
  }
})

test('an inactive tab shows the unread dot until its topic is read', async ({ juno, slack }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { sidebar, tabs } = juno

  await sidebar.row(POSTGRES).open()
  await sidebar.row(POSTGRES).expectRead()
  await sidebar.row(RINA).openInNewTab()
  await tabs.expectUnread(POSTGRES, false)

  slack.as('Leo').replyIn(POSTGRES, 'Replica check passed.')
  await sidebar.row(POSTGRES).expectUnread(1)
  await tabs.expectUnread(POSTGRES)
  await tabs.expectUnread(RINA, false)

  // The active tab never shows it; opening marks read, so it stays gone.
  await tabs.select(POSTGRES)
  await tabs.expectUnread(POSTGRES, false)
  await sidebar.row(POSTGRES).expectRead()
  await tabs.select(RINA)
  await tabs.expectUnread(POSTGRES, false)
})

test('the sidebar resizes by its edge, resets on double-click, and hides', async ({ juno, running, userData, fake, slackApp }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { frame, nav, sidebar } = juno

  await frame.expectWidth(384)
  await frame.drag(60)
  await frame.expectWidth(444)
  await frame.drag(200)
  await frame.expectWidth(480)
  await frame.drag(-300)
  await frame.expectWidth(280)
  await frame.doubleClickEdge()
  await frame.expectWidth(384)

  await frame.drag(-40)
  await frame.expectWidth(344)

  // Hidden, the tab strip carries Show sidebar, Back and Forward.
  expect(await frame.menuLabel()).toBe('Hide Sidebar')
  await frame.toggleWithButton()
  await frame.expectHidden()
  await expect(nav.backButton).toBeVisible()
  await expect(juno.win.getByRole('region', { name: 'Workspace' }).getByRole('button', { name: 'Show sidebar ⌃⌘S' })).toBeVisible()
  await expect.poll(() => frame.menuLabel()).toBe('Show Sidebar')
  await frame.toggleWithMenu()
  await frame.expectHidden(false)
  await frame.expectWidth(344)
  await sidebar.expectRows()

  // Dragging the edge far enough left hides it and keeps its width.
  await frame.drag(-250)
  await frame.expectHidden()

  // Width and hidden state come back after a restart.
  await juno.win.waitForTimeout(500)
  await running.close()
  const again = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword })
  try {
    const restarted = new Juno(again.app, again.win)
    await restarted.frame.expectHidden()
    await restarted.frame.toggleWithMenu()
    await restarted.frame.expectWidth(344)
  } finally {
    await again.close()
  }
})
