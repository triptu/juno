import { answersWithin } from './answers'
// Hover and press feedback, and popovers, on the default seed.
import { expect } from '@playwright/test'
import { feedbackInOneFrame, firstFrameRight, landsAndStays, noFlicker, noLayoutShift, opensAtAnchor, opensWhole, staysDrawn, type Check } from './checks'
import { pointAt } from '../driver/juno'
import { test } from './feel'
import { tag } from './pane'
import type { Probe, ProbeFrame } from './recorder'

// Starts signed in and synced (README, "Synced start").
test.use({ synced: true })

const POSTGRES = 'Draft plan is in the doc'
const RINA = 'Rina finished the onsite'

const look = (selector: string): Probe[] => [{ kind: 'look', name: 'look', selector }]

/** Hover and a held press change nothing but the look, so every shift counts; a press that navigates replaces the pane, so shifts right after it do not. */
const feedback = (event: string, label: string, navigates = false): Check[] => [feedbackInOneFrame('look', event, label, { from: 'go' }), noLayoutShift({ includeInput: !navigates }), noFlicker('window', 'the window')]

const seen = (values: ProbeFrame['values']) => typeof values['dialogOpacity'] === 'number' && values['dialogOpacity'] > 0.02

const popover = (dialog: string, anchor: string, label: string) => ({
  probes: [
    { kind: 'rect', name: 'dialog', selector: dialog },
    { kind: 'box', name: 'dialogBox', selector: dialog },
    { kind: 'text', name: 'dialogText', selector: dialog },
    { kind: 'rect', name: 'anchor', selector: anchor },
    { kind: 'opacity', name: 'dialogOpacity', selector: dialog },
  ] satisfies Probe[],
  // A popover opens at once (SPEC 16): fully drawn, at its full size, in the first frame it is on screen.
  checks: [
    answersWithin('dialog', 'pointerdown', label, { from: 'press', frames: 1 }),
    firstFrameRight(`${label} is fully drawn in its first frame`, (v) => v['dialog'] !== null, (v) => (v['dialogOpacity'] === 1 ? null : `opacity ${String(v['dialogOpacity'])}`), { from: 'press' }),
    staysDrawn('dialogOpacity', label, { from: 'press' }),
    opensWhole('dialog', 'dialogText', label, { from: 'press' }),
    opensAtAnchor('dialog', 'anchor', label, { from: 'press' }),
    landsAndStays('dialogBox', label, { from: 'press' }),
    noLayoutShift({ includeInput: true }),
    noFlicker('window', 'the window'),
  ],
})

test('hover and press feedback', { tag: ['@nightly', '@nightly-feel'] }, async ({ juno, win, feel }) => {

  const row = await tag(juno.sidebar.row(POSTGRES).root, 'hover-row')
  await feel.run({ name: 'hover-row', title: 'Point at a sidebar row: its hover background shows in the next frame', probes: look(row), checks: feedback('pointerover', 'row hover') }, async (rec) => {
    await rec.mark('go')
    await juno.sidebar.row(POSTGRES).hover()
  })

  const press = await tag(juno.sidebar.row(RINA).root, 'press-row')
  await juno.sidebar.row(RINA).hover()
  await win.waitForTimeout(300)
  await feel.run({ name: 'press-row', title: 'Press a sidebar row: it shows as selected in the next frame', probes: look(press), checks: feedback('pointerdown', 'row selection', true) }, async (rec) => {
    await rec.mark('go')
    await win.mouse.down()
    await win.mouse.up()
    await juno.topic.expectTitle(RINA)
  })

  // A button that acts on click, so leaving before the release does nothing.
  const search = await tag(juno.tabs.newTabButton, 'press-button')
  await pointAt(win, juno.tabs.newTabButton)
  await win.waitForTimeout(300)
  await feel.run({ name: 'press-button', title: 'Hold an icon button: it stays still through press and release', probes: [{ kind: 'rect', name: 'buttonRect', selector: search }], checks: [landsAndStays('buttonRect', 'the icon button', { from: 'go' }), noLayoutShift({ includeInput: true })] }, async (rec) => {
    await rec.mark('go')
    await win.mouse.down()
    await win.waitForTimeout(300)
    // Leave before releasing, so nothing is clicked.
    await win.mouse.move(900, 400)
    await win.mouse.up()
  })

  // The active tab has no hover state; point at the other one.
  await juno.sidebar.row(POSTGRES).openInNewTab()
  await juno.tabs.expectActive(POSTGRES)
  const tab = await tag(juno.tabs.tab(RINA), 'hover-tab')
  await win.mouse.move(900, 400)
  await feel.run({ name: 'hover-tab', title: 'Point at an inactive tab: its hover state shows in the next frame', probes: look(tab), checks: feedback('pointerover', 'tab hover') }, async (rec) => {
    await rec.mark('go')
    await juno.tabs.hover(RINA)
  })
})

test('popovers open from their anchor, whole', { tag: ['@nightly', '@nightly-feel'] }, async ({ juno, win, feel }) => {

  await juno.sidebar.row('#eng').open()
  await juno.topic.expectTitle('Main')
  await win.waitForTimeout(300)
  const title = await tag(juno.topic.titleButton, 'title-button')
  await feel.run({ name: 'topic-switcher', title: 'Open the topic switcher from a Main header', ...popover('[role="dialog"][aria-label="Topics in this channel"]', title, 'the topic switcher') }, async (rec) => {
    await rec.mark('press')
    await pointAt(win, juno.topic.titleButton)
    await win.mouse.down()
    await expect(win.getByRole('dialog', { name: 'Topics in this channel' })).toBeVisible()
    await win.waitForTimeout(60)
    await rec.mark('release')
    await win.mouse.up()
    await expect(win.getByRole('dialog', { name: 'Topics in this channel' })).toBeVisible()
  })
  await win.keyboard.press('Escape')
  await expect(win.getByRole('dialog', { name: 'Topics in this channel' })).toHaveCount(0)

  const account = await tag(juno.sidebar.accountButton, 'account-button')
  await feel.run({ name: 'account-menu', title: 'Open the account menu from the avatar', ...popover('[role="dialog"][aria-label="Account"]', account, 'the account menu') }, async (rec) => {
    await rec.mark('press')
    await pointAt(win, juno.sidebar.accountButton)
    await win.mouse.down()
    await expect(juno.accountMenu.root).toBeVisible()
    await win.waitForTimeout(60)
    await rec.mark('release')
    await win.mouse.up()
    await expect(juno.accountMenu.root).toBeVisible()
  })
})

test('palette opens with frequent conversations and holds still', { tag: ['@nightly', '@nightly-feel'] }, async ({ juno, win, feel }) => {
  const dialog = '[role="dialog"][aria-label="Search and commands"]'
  // The app warms the palette's list in its first idle moment after launch (Palette.tsx); a warm start can be
  // here before that on a busy machine. Idle callbacks run in order, so this one runs after the warm-up's.
  await win.evaluate(() => new Promise<void>((resolve) => requestIdleCallback(() => resolve(), { timeout: 5_000 })))
  await win.waitForTimeout(300)
  await feel.run({
    name: 'palette-open',
    title: 'Open search with frequent conversations',
    probes: [
      { kind: 'rect', name: 'dialog', selector: dialog },
      { kind: 'box', name: 'dialogBox', selector: dialog },
      { kind: 'opacity', name: 'dialogOpacity', selector: dialog },
    ],
    checks: [landsAndStays('dialogBox', 'the palette', { from: 'press', where: seen }), noFlicker('window', 'the window')],
  }, async (rec) => {
    await rec.mark('press')
    await juno.palette.open()
    // ⌘K opens on All, with the frequent conversations first (dom/palette.test.ts).
    await expect(juno.palette.section('Frequent').getByRole('option').first()).toBeVisible()
  })
  await win.keyboard.press('Escape')
  await juno.palette.expectClosed()
})
