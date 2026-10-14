// Hover and press feedback, and popovers, on the default seed.
import { expect } from '@playwright/test'
import { feedbackInOneFrame, landsAndStays, noFlicker, noLayoutShift, opensAtAnchor, opensWhole, type Check } from './checks'
import { pointAt } from '../driver/juno'
import { test } from './feel'
import { tag } from './pane'
import type { Probe, ProbeFrame } from './recorder'

const POSTGRES = 'Draft plan is in the doc'
const RINA = 'Rina finished the onsite.'

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
  // Only frames where the popover can be seen: it fades in from opacity 0, and what it does while invisible does not show.
  checks: [
    opensWhole('dialog', 'dialogText', label, { from: 'press', where: seen }),
    opensAtAnchor('dialog', 'anchor', label, { from: 'press', where: seen }),
    landsAndStays('dialogBox', label, { from: 'press', where: seen }),
    noLayoutShift({ includeInput: true }),
    noFlicker('window', 'the window'),
  ],
})

test('hover and press feedback', async ({ juno, win, feel }) => {
  await juno.signIn()
  await juno.waitForSync()

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

  const search = await tag(juno.sidebar.searchButton, 'press-button')
  await pointAt(win, juno.sidebar.searchButton)
  await win.waitForTimeout(300)
  await feel.run({ name: 'press-button', title: 'Hold the mouse down on an icon button: the press state shows in the next frame', probes: look(search), checks: feedback('pointerdown', 'button press') }, async (rec) => {
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

test('popovers open from their anchor, whole', async ({ juno, win, feel }) => {
  await juno.signIn()
  await juno.waitForSync()

  await juno.sidebar.row('#eng').open()
  await juno.topic.expectTitle('#eng')
  await win.waitForTimeout(300)
  const threads = await tag(juno.topic.threadsButton, 'threads-button')
  await feel.run({ name: 'threads-popover', title: 'Open the Threads list from a Main header', ...popover('[role="dialog"][aria-label="Threads"]', threads, 'the Threads list') }, async (rec) => {
    await rec.mark('press')
    await juno.topic.threadsButton.click()
    await expect(win.getByRole('dialog', { name: 'Threads' })).toBeVisible()
  })
  await win.keyboard.press('Escape')
  await expect(win.getByRole('dialog', { name: 'Threads' })).toHaveCount(0)

  const account = await tag(juno.sidebar.accountButton, 'account-button')
  await feel.run({ name: 'account-menu', title: 'Open the account menu from the avatar', ...popover('[role="dialog"][aria-label="Account"]', account, 'the account menu') }, async (rec) => {
    await rec.mark('press')
    await juno.sidebar.accountButton.click()
    await expect(juno.accountMenu.root).toBeVisible()
  })
})
