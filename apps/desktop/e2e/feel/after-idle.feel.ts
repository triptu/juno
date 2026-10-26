// What opens after the app has sat for a while: Home and two topics, read again after their subscriptions'
// 30 s idle time (performance.md 3.3), then the Home icon from a topic. One launch, so the wait is paid once.
import { pointAt, press } from '../driver/juno'
import { contentHoldsStill, feedbackInOneFrame, happened, landsAndStays, neverBlank, noFlicker, noLayoutShift, staysAtBottom, switchesOnce } from './checks'
import { expect, test, type Scenario } from './feel'
import { edgeKey, header, paneRegions, tag, topicProbes } from './pane'

// Starts signed in and synced (README, "Synced start").
test.use({ synced: true })

const POSTGRES = 'Draft plan is in the doc'
const RINA = 'Rina finished the onsite'
const OTHER = 'Proposal: cut offline mode'

const homeAfterIdle: Scenario = {
  name: 'home-after-idle',
  title: 'Open Home after reading a topic: it replaces the topic with its rows, with no loading frame between',
  probes: [
    { kind: 'count', within: 'main', name: 'topic', selector: '[data-topic-view]' },
    { kind: 'count', within: 'main', name: 'home', selector: '[data-home-item]' },
    { kind: 'count', within: 'main', name: 'waiting', selector: '[data-home-waiting]' },
  ],
  checks: [
    happened('Home showed its rows', (r) => r.frames.some((f) => Number(f.values['home']) > 0)),
    happened('no loading placeholder between pages', (r) => r.frames.every((f) => Number(f.values['waiting']) === 0 && (Number(f.values['topic']) > 0 || Number(f.values['home']) > 0))),
    switchesOnce('topic to Home', (v) => (Number(v['home']) > 0 ? 'home' : Number(v['topic']) > 0 ? 'topic' : 'empty')),
  ],
}

const openAtDivider: Scenario = {
  name: 'open-at-divider',
  title: 'Open a thread with 2 unread replies: it lands at the "2 new" divider and does not move after',
  probes: topicProbes,
  regions: paneRegions,
  checks: [
    happened('the divider showed', (r) => r.frames.some((f) => f.values['divider'] !== null)),
    landsAndStays('divider', 'the "2 new" divider', { from: 'press' }),
    contentHoldsStill('top', { from: 'press' }),
    switchesOnce('the header', header, { from: 'press' }),
    noLayoutShift({ from: 'press' }),
    noFlicker('pane', 'the message list', { from: 'press' }),
  ],
}

const openAtBottom: Scenario = {
  name: 'open-at-bottom',
  title: 'Open a read thread in the same tab: the old topic gives way to the new one at its bottom in one step',
  probes: topicProbes,
  regions: paneRegions,
  checks: [
    switchesOnce('header and rows together', (v) => `${header(v)} / ${edgeKey(v, 'bottom')}`, { from: 'press' }),
    staysAtBottom('scroll', { from: 'press', where: (v) => header(v).includes(POSTGRES) }),
    contentHoldsStill('bottom', { from: 'press', where: (v) => header(v).includes(POSTGRES) }),
    noLayoutShift({ from: 'press' }),
    neverBlank('pane', 'the message list'),
    noFlicker('pane', 'the message list'),
  ],
}

const homeIcon = (icon: string): Scenario => ({
  name: 'home-icon',
  title: "Press the Home icon in the sidebar's title bar from a topic: the press shows in the next frame, and Home replaces the topic in one step",
  probes: [
    { kind: 'look', name: 'look', selector: icon },
    { kind: 'count', within: 'main', name: 'topic', selector: '[data-topic-view]' },
    { kind: 'count', within: 'main', name: 'home', selector: '[data-home-item]' },
    { kind: 'count', within: 'main', name: 'waiting', selector: '[data-home-waiting], [data-home-loading]' },
    { kind: 'box', name: 'field', selector: '[data-home] [data-composer-field]' },
  ],
  regions: { main: 'main' },
  checks: [
    feedbackInOneFrame('look', 'pointerdown', 'the icon press', { from: 'press' }),
    happened('Home showed its rows', (r) => r.frames.some((f) => Number(f.values['home']) > 0)),
    switchesOnce('topic to Home', (v) => (Number(v['home']) > 0 && Number(v['waiting']) === 0 ? 'home' : Number(v['topic']) > 0 ? 'topic' : 'empty')),
    landsAndStays('field', "Home's field", { tolerance: 0 }),
    noFlicker('main', 'the page'),
  ],
})

test('after 30 s idle: Home replaces a topic with its rows, a topic opens at its divider, another at its bottom; then the Home icon', { tag: ['@nightly', '@nightly-feel'] }, async ({ juno, win, feel }) => {
  await juno.home.open()
  await expect(juno.home.item('waiting')).toBeVisible()
  // After sign-in the thread's replies are search matches, which do not cover its window (performance.md 3.3);
  // the first open brings them in full. Its subscription then expires, so the recorded open reads the cache.
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.expectMessage('Booked 2–4pm')
  // Home and the thread wait out their idle time behind another topic.
  await juno.sidebar.row(OTHER).open()
  await expect(win.locator('[data-topic-view]').filter({ visible: true })).toContainText(OTHER)
  await win.waitForTimeout(31_000)

  await feel.run(homeAfterIdle, async (rec) => {
    await rec.mark('press')
    await juno.home.open()
    await expect(juno.home.item('waiting')).toBeVisible()
  })
  await feel.run(openAtDivider, async (rec) => {
    await rec.mark('press')
    await juno.sidebar.row(RINA).open()
    await juno.topic.expectDividerBefore('Strong systems design')
  })
  await feel.run(openAtBottom, async (rec) => {
    await rec.mark('press')
    await juno.sidebar.row(POSTGRES).open()
    await juno.topic.expectMessage('Booked 2–4pm')
    await juno.topic.expectAtBottom()
  })

  const icon = await tag(juno.home.navItem, 'home-icon')
  await pointAt(win, juno.home.navItem)
  await win.waitForTimeout(300)
  await feel.run(homeIcon(icon), async (rec) => {
    await rec.mark('press')
    await press(win)
    await expect(juno.home.item('waiting')).toBeVisible()
  })
})
