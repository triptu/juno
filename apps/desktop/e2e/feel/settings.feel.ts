// The avatar menu's hover and Settings' sections, on the default seed.
import { expect } from '@playwright/test'
import { pointAt, press } from '../driver/juno'
import { contentHoldsStill, feedbackInOneFrame, firstFrameRight, landsAndStays, noFlicker, noLayoutShift, switchesOnce } from './checks'
import { test } from './feel'
import { edgeKey, paneRegions, tag, topEdgeNow, topicProbes } from './pane'
import type { ProbeFrame } from './recorder'

// Starts signed in and synced (README, "Synced start").
test.use({ synced: true })

const title = (values: ProbeFrame['values']): string => (typeof values['title'] === 'string' ? values['title'] : 'no title')

test('menu hover: the avatar menu highlights the item under the pointer in the next frame', { tag: ['@nightly', '@nightly-feel'] }, async ({ juno, win, feel }) => {
  await juno.accountMenu.open()
  const item = await tag(juno.accountMenu.item(/^Notifications/), 'menu-item')
  await juno.accountMenu.item(/^Set yourself/).hover()
  await win.waitForTimeout(300)
  await feel.run(
    {
      name: 'menu-hover',
      title: 'Point at Notifications in the avatar menu: it is highlighted in the next frame',
      probes: [{ kind: 'look', name: 'look', selector: item }],
      checks: [feedbackInOneFrame('look', 'pointerover', 'menu item hover', { from: 'go' }), noLayoutShift({ includeInput: true }), noFlicker('window', 'the window')],
    },
    async (rec) => {
      await rec.mark('go')
      await juno.accountMenu.item(/^Notifications/).hover()
    },
  )
  await juno.accountMenu.close()
})

test('settings sections switch in place: the list holds still and the page changes once', { tag: ['@nightly', '@nightly-feel'] }, async ({ juno, feel }) => {
  await juno.openSettings()
  const nav = '[data-settings-nav]'
  await feel.run(
    {
      name: 'settings-section',
      title: 'In Settings, pick Appearance: the section list holds still and the page switches once',
      probes: [
        { kind: 'rect', name: 'nav', selector: nav },
        { kind: 'text', name: 'title', selector: 'main [data-settings-section] h1' },
      ],
      regions: { nav },
      checks: [switchesOnce('the section title', title, { from: 'go' }), landsAndStays('nav', 'the section list'), noFlicker('window', 'the window'), noFlicker('nav', 'the section list')],
    },
    async (rec) => {
      await rec.mark('go')
      await juno.settings.section('Appearance').click()
      await expect(juno.settings.section('Appearance')).toHaveAttribute('aria-current', 'page')
    },
  )
})

const POSTGRES = 'Draft plan is in the doc'

/** The sidebar rows' heights, top to bottom: one density's rows, or the other's. */
const rowHeights = (values: ProbeFrame['values']): string => {
  const rows = values['rows']
  return Array.isArray(rows) ? rows.map((row) => Math.round(row.height)).join(' ') : 'no rows'
}

test('switching density redraws the sidebar once, and the open topic keeps the row at its top', { tag: ['@nightly', '@nightly-feel'] }, async ({ juno, win, feel }) => {
  // The topic in a tab of its own, so Settings, which opens in the current tab, leaves it there.
  await juno.sidebar.row(POSTGRES).openInNewTab()
  await juno.tabs.expectActive(POSTGRES)
  await juno.topic.expectAtBottom()
  // Up from the bottom, so the top row is one in the middle of the topic.
  await juno.topic.scroller.hover()
  await win.mouse.wheel(0, -400)
  await win.waitForTimeout(400)
  const before = await topEdgeNow(juno.topic.scroller)
  await juno.tabs.select('Home')
  await juno.openSettings('Appearance')
  await expect(juno.settings.densityRadio('Compact')).toHaveAttribute('aria-checked', 'true')
  const radio = await tag(juno.settings.densityRadio('Comfortable'), 'density-radio')
  await pointAt(win, win.locator(radio))
  await win.waitForTimeout(300)

  await feel.run(
    {
      name: 'density-switch',
      title: 'Pick Comfortable in Settings › Appearance: the radio shows at once, and the sidebar goes from one density to the other in one frame',
      probes: [
        { kind: 'look', name: 'look', selector: radio },
        { kind: 'boxes', name: 'rows', selector: 'aside[aria-label="Sidebar"] [data-topic-row]', key: 'data-topic-id' },
        { kind: 'rect', name: 'page', selector: 'main [data-settings-section] h1' },
      ],
      regions: { sidebar: 'aside[aria-label="Sidebar"]' },
      checks: [
        feedbackInOneFrame('look', 'pointerdown', 'the radio press', { from: 'go' }),
        // The whole recording: the radio acts on the press, in the frame the press mark names.
        switchesOnce('the sidebar rows', rowHeights),
        landsAndStays('page', 'the section title'),
        noFlicker('sidebar', 'the sidebar'),
      ],
    },
    async (rec) => {
      await rec.mark('go')
      await press(win)
      await expect.poll(() => win.evaluate(() => document.documentElement.dataset['density'])).toBe('comfortable')
    },
  )

  await feel.run(
    {
      name: 'density-topic',
      title: 'Go back to the topic after switching density: its first frame has the same row at the top, which then holds still',
      probes: topicProbes,
      regions: paneRegions,
      checks: [
        firstFrameRight('the first frame has the same row at the top', (v) => edgeKey(v, 'top') !== 'no rows', (v) => (edgeKey(v, 'top') === before.key ? null : `${edgeKey(v, 'top')} at the top, not ${before.key}`)),
        contentHoldsStill('top', { from: 'go' }),
        noFlicker('pane', 'the topic'),
      ],
    },
    async (rec) => {
      await rec.mark('go')
      await juno.tabs.select(POSTGRES)
      await juno.topic.expectTitle(POSTGRES)
    },
  )
})
