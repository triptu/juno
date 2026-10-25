// Tabs (spec sections 4 and 6): the reopen stack with each tab's history, the
// unread dot on an inactive tab, and pinned tabs from the tab menu, kept over a
// restart. Back and Forward are the browser lane's canary (navigation.spec.ts).
import { savedTabs, threadId } from '../e2e/driver/userDb'
import { expect } from './expect'
import { domTest } from './test'

const POSTGRES = 'Draft plan is in the doc'
const RINA = 'Rina finished the onsite'
const ROADMAP = 'Proposal: cut offline mode and public'
const OFFSITE = 'Can eng take the Wednesday afternoon'

domTest('⌘⇧T reopens closed tabs, the last closed first, each with its history; an inactive tab shows the unread dot until its topic is read', async ({ juno, slack }) => {
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

  // Nothing left to reopen.
  await tabs.menu('reopen-tab')
  await tabs.expectCount(3)

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
})

domTest('the tab menu pins, unpins and closes, and pins survive a restart', async ({ juno, relaunch, userData, fake, slack }) => {
  const { sidebar, tabs } = juno

  await sidebar.row(POSTGRES).open()
  await sidebar.row(RINA).openInNewTab()
  await sidebar.row(ROADMAP).openInNewTab()

  await tabs.contextMenu(ROADMAP, 'pin')
  await tabs.expectPinned(ROADMAP)
  await expect.poll(() => tabs.titles()).toEqual([expect.stringMatching(/^Proposal/), expect.stringMatching(/^Draft plan/), expect.stringMatching(/^Rina/)])
  await expect(tabs.closeButton(ROADMAP)).toHaveCount(0)

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
  await expect.poll(() => tabs.titles()).toEqual([expect.stringMatching(/^Proposal/), expect.stringMatching(/^Draft plan/)])

  // Copy Slack link and Open in Slack.
  await tabs.contextMenu(POSTGRES, 'copy-link')
  await expect.poll(() => juno.clipboard()).toMatch(/\/archives\/C[A-Z0-9]+\/p\d+$/)
  await tabs.contextMenu(POSTGRES, 'open-in-slack')
  expect(await juno.slackLinks()).toEqual([expect.stringMatching(/^slack:\/\/channel\?team=T0JUNO&id=C[A-Z0-9]+$/)])

  // The pin and the closes have reached the engine.
  await expect.poll(() => savedTabs(userData, fake.teamId)?.tabs).toEqual([{ place: threadId(slack, ROADMAP), pinned: true }, { place: threadId(slack, POSTGRES), pinned: false }])
  const restarted = await relaunch()
  await restarted.tabs.expectCount(2)
  await restarted.tabs.expectPinned(ROADMAP)
  await restarted.tabs.expectPinned(POSTGRES, false)
  expect(await restarted.tabs.contextMenu(ROADMAP, 'pin')).toContain('Unpin tab')
  await restarted.tabs.expectPinned(ROADMAP, false)
  expect(await restarted.tabs.titles()).toEqual([expect.stringMatching(/^Proposal/), expect.stringMatching(/^Draft plan/)])
  await expect(restarted.tabs.closeButton(ROADMAP)).toHaveCount(1)
})
