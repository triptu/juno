// Switching back to a scrolled tab, while it is still mounted and after it
// was unmounted for being older than the 4 most recent (performance 4.3).
import { seedWorkspace, startFakeSlack, topic300Seed } from '@juno/fake-slack'
import { contentHoldsStill, firstFrameRight, neverBlank, noFlicker, noLayoutShift, switchesOnce } from './checks'
import { test as base } from './feel'
import { edgeKey, header, paneRegions, topEdgeNow, topicProbes } from './pane'
import type { Probe, ProbeFrame } from './recorder'

const test = base.extend({
  // oxlint-disable-next-line no-empty-pattern
  fake: async ({}, use) => {
    const fake = await startFakeSlack({
      seed: (workspace, avatars) => {
        seedWorkspace(workspace, avatars)
        topic300Seed()(workspace, avatars)
      },
    })
    await use(fake)
    await fake.close()
  },
})

const THREAD = 'Review the rollout checklist 1'
const OTHERS = ['Draft plan is in the doc', 'Rina finished the onsite.', 'Proposal: cut offline mode and public', 'Can eng take the Wednesday afternoon']

test('switching back to a scrolled tab restores it before the first paint', { tag: ['@nightly', '@nightly-feel'] }, async ({ juno, feel }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row(THREAD).open()
  await juno.topic.expectAtBottom()
  await juno.topic.scrollUp(2_500)
  // The tab records its position on scrollend.
  await juno.win.waitForTimeout(400)
  const saved = await topEdgeNow(juno.topic.scroller)
  await juno.sidebar.row('#perf-main').openInNewTab()
  await juno.tabs.expectActive('perf-main')
  // Main's oldest messages are the user's, so it opens at the "N new" divider after them.
  await juno.topic.toLatest()

  const isThread = (v: ProbeFrame['values']) => header(v).includes(THREAD)
  const restored = (v: ProbeFrame['values']) => {
    const at = v['saved']
    if (typeof at !== 'number') return `the saved row ${saved.key} is not in the list`
    return Math.abs(at - saved.at) <= 1 ? null : `the saved row at ${at}px from the top instead of ${saved.at}px`
  }
  const probes: ReadonlyArray<Probe> = [...topicProbes, { kind: 'row', name: 'saved', scroller: '[data-topic-view] [data-scroll]', rowKey: 'data-message-row', key: saved.key }]
  const checks = [
    firstFrameRight('the first frame of the tab is at the saved position', isThread, restored, { from: 'press' }),
    switchesOnce('header and rows together', (v) => `${header(v)} / ${edgeKey(v, 'top')}`, { from: 'press' }),
    contentHoldsStill('top', { from: 'press', where: isThread }),
    noLayoutShift({ from: 'press' }),
    neverBlank('pane', 'the message list'),
    noFlicker('pane', 'the message list'),
  ]

  await feel.run({ name: 'tab-switch-mounted', title: 'Switch back to a thread scrolled 2,500 px up, still mounted: it shows at that position in its first frame', probes, regions: paneRegions, checks }, async (rec) => {
    await rec.mark('press')
    await juno.tabs.select(THREAD)
    await juno.tabs.expectActive(THREAD)
  })

  // Four newer tabs push the thread out of the mounted set.
  await juno.tabs.select('perf-main')
  for (const title of OTHERS) await juno.sidebar.row(title).openInNewTab()
  await juno.tabs.expectCount(6)
  await juno.win.waitForTimeout(500)

  await feel.run({ name: 'tab-switch-restored', title: 'Switch back to the same thread after four newer tabs unmounted it: it remounts at the saved position in its first frame', probes, regions: paneRegions, settleMs: 1_000, checks }, async (rec) => {
    await rec.mark('press')
    await juno.tabs.select(THREAD)
    await juno.tabs.expectActive(THREAD)
  })
})
