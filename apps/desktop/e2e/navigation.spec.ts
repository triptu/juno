// Browser-like navigation (spec sections 4 and 6): each tab's Back and
// Forward, the reopen stack, pinned tabs and the tab menu, the tab keys,
// the unread dot, and the sidebar's resize and hide.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, launchApp, syncedTest, test } from './fixtures'
import { Juno } from './driver/juno'

test.describe.configure({ timeout: 120_000 })

const POSTGRES = 'Draft plan is in the doc'
const RINA = 'Rina finished the onsite'
const ROADMAP = 'Proposal: cut offline mode and public'
const OFFSITE = 'Can eng take the Wednesday afternoon'

syncedTest('Back and Forward move through the topics one tab showed', async ({ juno }) => {
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
})

syncedTest('window swipe events move back and forward', { tag: '@electron' }, async ({ juno }) => {
  await juno.sidebar.row(RINA).open()
  await juno.sidebar.row(ROADMAP).open()
  await juno.nav.swipe('left')
  await juno.topic.expectTitle(RINA)
  await juno.nav.swipe('right')
  await juno.topic.expectTitle(ROADMAP)
})

syncedTest('the sidebar resizes by its edge, resets on double-click, and hides', { tag: '@electron' }, async ({ juno, running, userData, fake, slackApp }) => {
  const { frame, nav, sidebar } = juno

  await frame.expectWidth(384)
  await frame.drag(60)
  await frame.expectWidth(444)
  await frame.drag(200)
  await frame.expectWidth(480)
  // Past the narrowest but not below 200: it stops at 312.
  await frame.drag(-250)
  await frame.expectWidth(312)
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

  // Width and hidden state come back after a restart, once main has written them.
  await expect
    .poll(async () => {
      try {
        return (JSON.parse(await readFile(join(userData, 'launch.json'), 'utf8')) as { sidebar?: unknown }).sidebar
      } catch {
        return undefined
      }
    })
    .toEqual({ width: 344, collapsed: true })
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

test('in full screen the title bars drop the traffic lights’ room, and keep it again after', { tag: '@electron' }, async ({ juno, app }) => {
  await juno.signIn()
  const fullScreen = (on: boolean) => app.evaluate(({ BrowserWindow }, on) => BrowserWindow.getAllWindows()[0]!.setFullScreen(on), on)
  // A button's left edge from the left of the pane it sits in.
  const leftOf = (pane: string, name: RegExp) =>
    juno.win.locator(pane).getByRole('button', { name }).evaluate((button, pane) => button.getBoundingClientRect().left - button.closest(pane)!.getBoundingClientRect().left, pane)
  const hide = () => leftOf('aside[aria-label="Sidebar"]', /^Hide sidebar/)
  const show = () => leftOf('[data-tab-strip]', /^Show sidebar/)

  // The 78px after the lights, then the sidebar's 10px inset in full screen.
  expect(await hide()).toBe(78)
  await fullScreen(true)
  await expect.poll(hide).toBe(10)
  await fullScreen(false)
  await expect.poll(hide).toBe(78)

  // With the sidebar hidden, the tab strip does the same, from its own 10px padding.
  await juno.frame.toggleWithButton()
  await juno.frame.expectHidden()
  expect(await show()).toBe(78)
  await fullScreen(true)
  await expect.poll(show).toBe(10)
  await fullScreen(false)
  await expect.poll(show).toBe(78)
})
