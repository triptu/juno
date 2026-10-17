// Tabs: opening uses the current tab, ⌘-click opens a new one, a plain open
// of an open topic focuses its tab, one topic in two tabs scrolls apart,
// closing focuses the neighbour and never leaves no tab, a new tab opens
// Home, where "+" sits, the app menu's tab items, the row menu's Open in
// new tab, tabs survive a restart, dragging and ⌃⇧← ⌃⇧→ reorder them, and
// each tab shows its topic's art or the DM person's photo, and a tab not
// viewed for a day closes by itself.
import { startFakeSlack, topic300Seed } from '@juno/fake-slack'
import { expectNoLayoutShift } from '@juno/testing/layout-shift'
import { expect, launchApp, test } from './fixtures'
import { Juno } from './driver/juno'

test.describe.configure({ timeout: 120_000 })

const POSTGRES = 'Draft plan is in the doc'
const RINA = 'Rina finished the onsite'
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
  // Closing the last tab leaves Home, never no tab.
  await tabs.close(RINA)
  await juno.expectNothingOpen()
})

test('closing a tab from the keyboard leaves focus in the strip', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
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

test('⌘W held down closes a tab per press, even when the tabs it lands on were put away', async ({ juno, running, userData, fake, slackApp }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { sidebar, tabs } = juno
  const topics = [POSTGRES, RINA, ROADMAP, OFFSITE, 'Unrelated: has anyone looked at the', 'p95 on /v2/search jumped to 1.8s', 'Two options for the thread list', 'Final copy for pricing is in']
  await sidebar.row(topics[0]!).open()
  for (const title of topics.slice(1)) await sidebar.row(title).openInNewTab()
  await tabs.menu('tab-1')
  await tabs.expectActive(POSTGRES)
  // Let the save reach the engine.
  await juno.win.waitForTimeout(500)
  await running.close()

  // After a relaunch only the active tab has its topic loaded, so showing any other one waits for the engine.
  const again = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword })
  try {
    const restarted = new Juno(again.app, again.win)
    await restarted.tabs.expectCount(topics.length)
    await restarted.tabs.expectActive(POSTGRES)
    // Three presses in one go, as the key repeats.
    await again.app.evaluate(({ Menu, BrowserWindow }) => {
      const close = Menu.getApplicationMenu()!.getMenuItemById('close-tab')!
      for (let press = 0; press < 3; press++) close.click(undefined, BrowserWindow.getAllWindows()[0])
    })
    await restarted.tabs.expectCount(topics.length - 3)
    await restarted.win.waitForTimeout(500)
    await restarted.tabs.expectCount(topics.length - 3)
    expect(await restarted.tabs.titles()).not.toContain(expect.stringMatching(/^Draft plan/))
  } finally {
    await again.close()
  }
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

test('tabs drag to a new place, move with ⌃⇧← and ⌃⇧→, and keep their order after a restart', async ({ juno, running, userData, fake, slackApp }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { sidebar, tabs } = juno
  await sidebar.row(POSTGRES).open()
  await sidebar.row(RINA).openInNewTab()
  await sidebar.row(ROADMAP).openInNewTab()
  await expect.poll(() => tabs.titles()).toEqual([expect.stringMatching(/^Draft plan/), expect.stringMatching(/^Rina/), expect.stringMatching(/^Proposal/)])

  // The third tab dragged to the first place.
  await tabs.drag(ROADMAP, POSTGRES)
  await expect.poll(() => tabs.titles()).toEqual([expect.stringMatching(/^Proposal/), expect.stringMatching(/^Draft plan/), expect.stringMatching(/^Rina/)])
  await tabs.expectActive(ROADMAP)
  // The dropped tab settles with no transform left on any tab.
  await expect.poll(() => tabs.root.locator('[data-tab]').evaluateAll((boxes) => boxes.map((box) => (box as HTMLElement).style.transform).join(''))).toBe('')

  // The keyboard moves the focused tab one place, and a screen reader hears where it went.
  await tabs.tab(ROADMAP).focus()
  await juno.win.keyboard.press('Control+Shift+ArrowRight')
  await expect.poll(() => tabs.titles()).toEqual([expect.stringMatching(/^Draft plan/), expect.stringMatching(/^Proposal/), expect.stringMatching(/^Rina/)])
  await expect(tabs.announcement).toHaveText(/^Moved to position 2 of 3\./)
  await tabs.expectFocused(ROADMAP)
  await juno.win.keyboard.press('Control+Shift+ArrowLeft')
  await juno.win.keyboard.press('Control+Shift+ArrowLeft')
  await expect.poll(() => tabs.titles()).toEqual([expect.stringMatching(/^Proposal/), expect.stringMatching(/^Draft plan/), expect.stringMatching(/^Rina/)])
  await expect(tabs.announcement).toHaveText(/^Moved to position 1 of 3\./)

  // Esc during a drag puts the tab back.
  const from = await tabs.tab(RINA).boundingBox()
  const to = await tabs.tab(ROADMAP).boundingBox()
  if (!from || !to) throw new Error('No tabs to drag')
  await juno.win.mouse.move(from.x + 24, from.y + from.height / 2)
  await juno.win.mouse.down()
  await juno.win.mouse.move(to.x + 24, from.y + from.height / 2, { steps: 20 })
  await juno.win.keyboard.press('Escape')
  await juno.win.mouse.up()
  await expect.poll(() => tabs.titles()).toEqual([expect.stringMatching(/^Proposal/), expect.stringMatching(/^Draft plan/), expect.stringMatching(/^Rina/)])

  // Let the save reach the engine.
  await juno.win.waitForTimeout(500)
  await running.close()
  const again = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword })
  try {
    const restarted = new Juno(again.app, again.win)
    await restarted.tabs.expectCount(3)
    await expect.poll(() => restarted.tabs.titles()).toEqual([expect.stringMatching(/^Proposal/), expect.stringMatching(/^Draft plan/), expect.stringMatching(/^Rina/)])
  } finally {
    await again.close()
  }
})

test('a topic tab shows its art and a DM tab the person\'s photo', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { sidebar, tabs } = juno
  await sidebar.row(POSTGRES).open()
  // A thread in the DM with Maya, and the DM itself.
  await sidebar.row(OFFSITE).openInNewTab()
  await sidebar.row('Maya', { exact: true }).openInNewTab()

  // The topic's art, or its placeholder shape until it is drawn.
  await expect(tabs.tile(POSTGRES)).toHaveAttribute('data-topic-art', /^(art|placeholder)$/)
  for (const title of [OFFSITE, 'Maya']) {
    const photo = tabs.tile(title)
    await expect(photo).toHaveAttribute('src', /^juno:\/\/files\/avatar/)
    await expect.poll(() => photo.evaluate((img) => img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0)).toBe(true)
  }
  // The DM photo is the URL the sidebar row shows, so it was loaded already.
  const rowPhoto = await sidebar.row('Maya', { exact: true }).root.locator('img').first().getAttribute('src')
  await expect(tabs.tile('Maya')).toHaveAttribute('src', rowPhoto ?? '')
})

test('a tab not viewed for a day closes by itself, ⌘⇧T brings it back, and a tab with a draft stays', async ({ juno, win }) => {
  // The sweep runs hourly on the page's clock, so install the fake one before any tab is viewed.
  await win.clock.install()
  await juno.signIn()
  await juno.waitForSync()
  const { sidebar, tabs, topic } = juno
  await sidebar.row(POSTGRES).open()
  await sidebar.row(RINA).openInNewTab()
  await topic.composer.fill('Half a thought about the onsite')
  // Let the draft save.
  await win.waitForTimeout(800)
  await sidebar.row(ROADMAP).openInNewTab()
  await tabs.expectActive(ROADMAP)

  // A day and an hour later: the tab left a day ago closes, the one with a draft and the active one stay.
  await win.clock.fastForward('25:00:00')
  await expect.poll(() => tabs.titles()).toEqual([expect.stringMatching(/^Rina/), expect.stringMatching(/^Proposal/)])
  await tabs.expectActive(ROADMAP)

  await tabs.menu('reopen-tab')
  await expect.poll(() => tabs.titles()).toEqual([expect.stringMatching(/^Draft plan/), expect.stringMatching(/^Rina/), expect.stringMatching(/^Proposal/)])
  await tabs.expectActive(POSTGRES)
})

test.describe('one topic in two tabs', () => {
  const longTest = test.extend({
    // oxlint-disable-next-line no-empty-pattern
    fake: async ({}, use) => {
      const fake = await startFakeSlack({ seed: (workspace, avatars) => void topic300Seed()(workspace, avatars) })
      await use(fake)
      await fake.close()
    },
  })
  const THREAD = 'Review the rollout checklist 1'

  longTest('each tab keeps its own scroll position', async ({ juno }) => {
    await juno.signIn()
    await juno.waitForSync()
    const { sidebar, tabs, topic } = juno
    await sidebar.row(THREAD).open()
    await topic.expectAtBottom()

    // ⌘-click opens the topic again in a new tab, though a tab shows it.
    await sidebar.row(THREAD).openInNewTab()
    await expect(tabs.tab(THREAD)).toHaveCount(2)
    await tabs.expectActiveAt(THREAD, 1)
    await topic.expectAtBottom()
    await topic.scrollUp(2400)
    const up = await topic.firstVisibleRow()

    // The first tab is still at the bottom; the second is where it was left.
    await tabs.selectAt(THREAD, 0)
    await tabs.expectActiveAt(THREAD, 0)
    await topic.expectAtBottom()
    await tabs.selectAt(THREAD, 1)
    await tabs.expectActiveAt(THREAD, 1)
    // The row that was first in view is back where it was. Which row counts as first can flip on a
    // sub-pixel when a row edge sits on the list's top, so the same row is followed instead.
    expect(await topic.rowTop(up.ts)).toBeCloseTo(up.top, 0)

    // A plain open focuses the tab that was active last, without moving it.
    await tabs.selectAt(THREAD, 0)
    await sidebar.row(THREAD).open()
    await tabs.expectActiveAt(THREAD, 0)
    await topic.expectAtBottom()
    await expect(tabs.tab(THREAD)).toHaveCount(2)
  })
})

test('closing the last tab leaves Home; ⌘T and "+" open Home in a new tab, ready to write', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
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
  await expect(tabs.newTabButton).toHaveAccessibleName('New tab ⌘T')

  const homes = await tabs.tab('Home').count()
  await tabs.newTabButton.click()
  await expect(tabs.tab('Home')).toHaveCount(homes + 1)
  await juno.home.expectShown()
  await expect(juno.write.composer).toBeFocused()

  // Closing every tab leaves one Home.
  await tabs.contextMenu(POSTGRES, 'close-all')
  await juno.expectNothingOpen()
})

test('"+" sits one tab gap after the last tab, level with the tabs, and stays at the end of the strip when the tabs scroll', async ({ juno, app }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { sidebar, tabs } = juno

  // `strip` is the tablist, the scroller the tabs sit in.
  const place = async () => {
    const last = (await tabs.root.getByRole('tab').last().boundingBox())!
    const plus = (await tabs.newTabButton.boundingBox())!
    const strip = (await tabs.root.boundingBox())!
    return { last, plus, strip }
  }
  const expectAfterLastTab = async () => {
    await expect
      .poll(async () => {
        const { last, plus } = await place()
        // The 2px tab gap, then the button's even inset in its tab-high square: (35 - 28) / 2.
        return { gap: Math.round((plus.x - (last.x + last.width)) * 2) / 2, level: Math.abs(plus.y + plus.height / 2 - (last.y + last.height / 2)) <= 0.5 }
      })
      .toEqual({ gap: 5.5, level: true })
  }

  await juno.expectNothingOpen()
  await expectAfterLastTab()
  await sidebar.row(POSTGRES).open()
  await sidebar.row(RINA).openInNewTab()
  await expectAfterLastTab()

  // A narrow window: the tabs overflow and scroll, and "+" stays in view at the strip's end.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(760, 600))
  await sidebar.row(ROADMAP).openInNewTab()
  await sidebar.row(OFFSITE).openInNewTab()
  await expect.poll(() => tabs.root.evaluate((list) => list.scrollWidth > list.clientWidth)).toBe(true)
  // The tabs fill the strip up to "+", which follows the scroller and ends inside the window.
  const { plus, strip } = await place()
  expect(plus.x).toBeGreaterThanOrEqual(strip.x + strip.width)
  expect(plus.x - (strip.x + strip.width)).toBeLessThanOrEqual(5.5)
  expect(plus.x + plus.width).toBeLessThanOrEqual(await juno.win.evaluate(() => window.innerWidth))
  await expect(tabs.newTabButton).toBeInViewport()
})
