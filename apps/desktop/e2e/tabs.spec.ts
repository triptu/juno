// Tabs: opening uses the current tab, ⌘-click opens a new one, an open
// topic focuses its tab, closing focuses the neighbour, the app menu's tab
// items, the row menu's Open in new tab, and tabs survive a restart.
import { expectNoLayoutShift } from '@juno/testing/layout-shift'
import { expect, launchApp, test } from './fixtures'
import { Juno } from './driver/juno'

test.describe.configure({ timeout: 120_000 })

const POSTGRES = 'Draft plan is in the doc'
const RINA = 'Rina finished the onsite.'
const ROADMAP = 'Proposal: cut offline mode and public'
const OFFSITE = 'Can eng take the Wednesday afternoon'

test('opening, ⌘-click, focusing an open topic and closing to the neighbour', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { sidebar, tabs } = juno

  await sidebar.row(POSTGRES).open()
  await tabs.expectActive(POSTGRES)
  await sidebar.row(RINA).open()
  await tabs.expectCount(1)
  await tabs.expectActive(RINA)

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

  // Switching moves nothing in the strip.
  await expectNoLayoutShift(juno.win, () => tabs.select(POSTGRES), { root: '[role="tablist"]' })
  await tabs.expectActive(POSTGRES)
  await juno.topic.expectTitle(POSTGRES)

  await tabs.close(POSTGRES)
  await tabs.expectActive(ROADMAP)
  await tabs.close(ROADMAP)
  await tabs.expectActive(RINA)
  await tabs.close(RINA)
  await tabs.expectCount(0)
  await juno.expectNothingOpen()
})

test('closing a tab from the keyboard leaves focus in the strip', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { sidebar, tabs } = juno
  await sidebar.row(POSTGRES).open()
  await sidebar.row(RINA).openInNewTab()
  await sidebar.row(ROADMAP).openInNewTab()

  // The tab that slides into the closed one's place takes focus, so the next Tab goes on from the strip.
  await tabs.closeWithKeyboard(RINA)
  await tabs.expectCount(2)
  await tabs.expectFocused(ROADMAP)
  await tabs.closeWithKeyboard(ROADMAP)
  await tabs.expectFocused(POSTGRES)
  await tabs.closeWithKeyboard(POSTGRES)
  await tabs.expectCount(0)
  await expect(tabs.newTabButton).toBeFocused()
})

test('the app menu closes the tab and moves between tabs', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
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
})

test('tabs survive a restart', async ({ juno, running, userData, fake, slackApp }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { sidebar, tabs } = juno
  await sidebar.row(POSTGRES).open()
  await sidebar.row(RINA).openInNewTab()
  await sidebar.row(ROADMAP).openInNewTab()
  await sidebar.row(OFFSITE).openInNewTabFromMenu()
  await tabs.expectActive(OFFSITE)
  // Let the save reach the engine.
  await juno.win.waitForTimeout(500)
  await running.close()

  const again = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword })
  try {
    const restarted = new Juno(again.app, again.win)
    await restarted.tabs.expectCount(4)
    await expect.poll(() => restarted.tabs.titles()).toEqual([expect.stringMatching(/^Draft plan/), expect.stringMatching(/^Rina/), expect.stringMatching(/^Proposal/), expect.stringMatching(/^Can eng/)])
    await restarted.tabs.expectActive(OFFSITE)
    await restarted.sidebar.row(OFFSITE).expectVisible()
  } finally {
    await again.close()
  }
})
