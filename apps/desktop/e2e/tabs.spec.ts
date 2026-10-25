// Tabs in the browser: typing right after an open goes to the topic's composer, switching moves
// nothing in the strip, dragging and ⌃⇧← ⌃⇧→ reorder them, and each tab shows its topic's art
// or the DM person's photo. Opening, focusing, closing, the app menu's tab items, ⌘W held down
// and the day-old sweep are in the DOM lane (`dom/tabs.test.ts`).
import { expectNoLayoutShift } from '@juno/testing/layout-shift'
import { expect, syncedTest, test } from './fixtures'

import { schemeUrl } from './driver/juno'
import { savedTabs, threadId } from './driver/userDb'

test.use({ freshContext: true })

test.describe.configure({ timeout: 120_000 })

const POSTGRES = 'Draft plan is in the doc'
const RINA = 'Rina finished the onsite'
const ROADMAP = 'Proposal: cut offline mode and public'
const OFFSITE = 'Can eng take the Wednesday afternoon'

// The keys go to the composer through the browser's editing (execCommand), so this stays here.
syncedTest('typing right after an open from the list goes to the topic composer, even before the topic shows, and switching tabs moves nothing in the strip', async ({ juno }) => {
  const { sidebar, tabs } = juno
  await sidebar.row(POSTGRES).open()
  await juno.win.keyboard.type('ok')
  await tabs.expectActive(POSTGRES)
  await expect(juno.topic.composer).toBeFocused()
  await expect(juno.topic.composer).toHaveValue('ok')
  await juno.topic.composer.fill('')
  await sidebar.row(RINA).open()
  await sidebar.row(RINA).expectFocused()
  await juno.win.keyboard.type('x')
  await expect(juno.topic.composer).toBeFocused()
  await expect(juno.topic.composer).toHaveValue('x')
  await juno.win.keyboard.press('Backspace')
  await sidebar.row(POSTGRES).openInNewTab()
  await tabs.expectActive(POSTGRES)
  await juno.win.keyboard.type('x')
  await expect(juno.topic.composer).toHaveValue('x')
  // Switching moves nothing in the strip.
  await expectNoLayoutShift(juno.win, () => tabs.select(RINA), { root: '[role="tablist"]' })
})

syncedTest('tabs drag to a new place, move with ⌃⇧← and ⌃⇧→, and keep their order and the active tab after a restart', async ({ juno, relaunch, userData, fake, slack }) => {
  const { sidebar, tabs } = juno
  await sidebar.row(POSTGRES).open()
  await sidebar.row(RINA).openInNewTab()
  await sidebar.row(ROADMAP).openInNewTabFromMenu()
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

  // The order and the active last tab have reached the engine.
  await tabs.tab(RINA).click()
  await tabs.expectActive(RINA)
  await expect.poll(() => savedTabs(userData, fake.teamId)).toEqual({ tabs: [ROADMAP, POSTGRES, RINA].map((title) => ({ place: threadId(slack, title), pinned: false })), active: 2 })
  const restarted = await relaunch()
  await restarted.tabs.expectCount(3)
  await expect.poll(() => restarted.tabs.titles()).toEqual([expect.stringMatching(/^Proposal/), expect.stringMatching(/^Draft plan/), expect.stringMatching(/^Rina/)])
  await restarted.tabs.expectActive(RINA)
  await restarted.sidebar.row(RINA).expectVisible()
})

syncedTest('a topic tab shows its art and a DM tab the person\'s photo', async ({ juno }) => {
  const { sidebar, tabs } = juno
  await sidebar.row(POSTGRES).open()
  // A thread in the DM with Maya, and the DM itself.
  await sidebar.row(OFFSITE).openInNewTab()
  await sidebar.row('Maya', { exact: true }).openInNewTab()

  // The topic's art, or its placeholder shape until it is drawn.
  await expect(tabs.tile(POSTGRES)).toHaveAttribute('data-topic-art', /^(art|placeholder)$/)
  for (const title of [OFFSITE, 'Maya']) {
    const photo = tabs.tile(title)
    await expect(photo).toHaveAttribute('src', new RegExp(`${schemeUrl('files').source}avatar`))
    await expect.poll(() => photo.evaluate((img) => img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0)).toBe(true)
  }
  // The DM photo is the URL the sidebar row shows, so it was loaded already.
  const rowPhoto = await sidebar.row('Maya', { exact: true }).root.locator('img').first().getAttribute('src')
  await expect(tabs.tile('Maya')).toHaveAttribute('src', rowPhoto ?? '')
})
