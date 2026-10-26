// A 300-message thread with images (the topic300 seed): late images, the
// divider on a long topic, scrolling, and what arrives while scrolled up.
import { startFakeSlack, topic300Seed } from '@juno/fake-slack'
import { contentHoldsStill, happened, landsAndStays, neverBlank, noFlicker, noLayoutShift, noLongFrames, scrollsOneWay, staysAtBottom } from './checks'
import { expect, test as base } from './feel'
import { count, paneRegions, rect, SCROLLER, sidebarReorder, topicProbes } from './pane'

const test = base.extend({
  // oxlint-disable-next-line no-empty-pattern
  fake: async ({}, use) => {
    const fake = await startFakeSlack({ seed: (workspace, avatars) => void topic300Seed()(workspace, avatars) })
    await use(fake)
    await fake.close()
  },
})

const THREAD = 'Review the rollout checklist 1'
/** The list runs under the 68 px header band; the divider opens 80 px below it (inventory 5). */
const DIVIDER_OFFSET = 148
/** Images answer this late, well after the rows paint. */
const FILE_DELAY_MS = 1_200

test('a long thread with late images', { tag: ['@nightly', '@nightly-feel'] }, async ({ juno, slack, win, feel }) => {
  await juno.signIn()
  await juno.waitForSync()
  slack.fake.delayFiles({ ms: FILE_DELAY_MS })
  const row = juno.sidebar.row(THREAD)

  await feel.run(
    {
      name: 'open-long-late-images',
      title: `Open a 300-message thread whose images arrive ${FILE_DELAY_MS} ms after the rows: it lands at the bottom and nothing moves when they arrive`,
      probes: topicProbes,
      regions: paneRegions,
      settleMs: 1_000,
      checks: [
        happened('images arrived after the rows', (r) => {
          const first = r.frames.find((f) => count(f.values, 'rows') > 0)
          return first !== undefined && count(first.values, 'images') === 0 && count(r.frames.at(-1)!.values, 'images') > 0
        }),
        staysAtBottom('scroll', { from: 'press', where: (v) => count(v, 'rows') > 0 }),
        contentHoldsStill('bottom', { from: 'press' }),
        noLayoutShift({ from: 'press' }),
        noFlicker('pane', 'the message list'),
      ],
    },
    async (rec) => {
      await rec.mark('press')
      await row.open()
      await juno.topic.expectAtBottom()
      await juno.topic.expectThumbnailsLoaded()
    },
  )

  await row.expectRead()
  await juno.tabs.close(THREAD)
  for (let i = 0; i < 40; i++) slack.as('Leo').replyIn(THREAD, `Follow-up ${i + 1} on the checklist.`)
  await row.expectUnread(40)

  await feel.run(
    {
      name: 'open-long-at-divider',
      title: 'Reopen it with 40 new replies: it lands with the "40 new" divider 80 px below the header band (148 px from the list top) and stays there while images arrive',
      probes: [...topicProbes, { kind: 'rect', name: 'list', selector: SCROLLER }],
      regions: paneRegions,
      settleMs: 1_500,
      checks: [
        happened('the divider first shows 148 px from the list top, 80 px below the header band', (r) => {
          const first = r.frames.find((f) => rect(f.values, 'divider') !== undefined)
          const divider = first === undefined ? undefined : rect(first.values, 'divider')
          const list = first === undefined ? undefined : rect(first.values, 'list')
          return divider !== undefined && list !== undefined && Math.abs(divider.y - list.y - DIVIDER_OFFSET) <= 2
        }),
        landsAndStays('divider', 'the "40 new" divider', { from: 'press' }),
        contentHoldsStill('top', { from: 'press' }),
        noLayoutShift({ from: 'press' }),
        noFlicker('pane', 'the message list'),
      ],
    },
    async (rec) => {
      await rec.mark('press')
      await row.open()
      await juno.topic.expectDividerBefore('Follow-up 1 on the checklist.')
      await juno.topic.expectThumbnailsLoaded()
    },
  )

  await feel.run(
    {
      name: 'live-reply-scrolled-up',
      title: 'A reply arrives while reading at the divider: it lands below, out of view, and what is on screen does not move',
      probes: topicProbes,
      regions: paneRegions,
      checks: [
        contentHoldsStill('top', { from: 'reply' }),
        noLayoutShift({ from: 'reply', includeInput: true, region: 'pane' }),
        sidebarReorder('reply'),
        noFlicker('pane', 'the message list'),
      ],
    },
    async (rec) => {
      await rec.mark('reply')
      slack.as('Maya').replyIn(THREAD, 'Feel check: a reply while scrolled up.')
      await row.expectPreview(/Feel check: a reply while scrolled up/)
    },
  )

  // A message a few rows above the view, and one in the middle of it.
  const keys = await juno.topic.scroller.evaluate((scroller) => {
    const box = scroller.getBoundingClientRect()
    const rows = [...scroller.querySelectorAll<HTMLElement>('[data-message-row]')]
    const first = rows.findIndex((r) => r.getBoundingClientRect().bottom > box.top)
    const middle = rows.findIndex((r) => r.getBoundingClientRect().top > box.top + box.height / 2)
    return { above: rows[Math.max(0, first - 3)]!.dataset['messageRow']!, middle: rows[Math.max(first + 1, middle)]!.dataset['messageRow']! }
  })
  const channel = slack.root(THREAD).channel
  const leo = slack.as('Leo').id
  for (const [where, ts] of [
    ['above', keys.above],
    ['in-view', keys.middle],
  ] as const) {
    await feel.run(
      {
        name: `reaction-${where}`,
        title: where === 'above' ? 'Someone reacts to a message above the view: nothing on screen moves' : 'Someone reacts to a message in the middle of the view: the rows above it, at the top of the view, do not move',
        probes: topicProbes,
        regions: paneRegions,
        checks: [
          happened('the reaction reached the list', (r) => count(r.frames.at(-1)!.values, 'reactions') > count(r.frames[0]!.values, 'reactions')),
          contentHoldsStill('top', { from: 'react' }),
          ...(where === 'above' ? [noLayoutShift({ from: 'react', includeInput: true, region: 'pane' })] : []),
          noFlicker('pane', 'the message list'),
        ],
      },
      async (rec) => {
        const before = await juno.topic.list.getByRole('list', { name: 'Reactions' }).count()
        await rec.mark('react')
        slack.fake.addReaction({ channel, ts, name: 'eyes', user: leo })
        await expect.poll(() => juno.topic.list.getByRole('list', { name: 'Reactions' }).count(), { timeout: 15_000 }).toBeGreaterThan(before)
      },
    )
  }

  const box = (await juno.topic.scroller.boundingBox())!
  await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await feel.run(
    {
      name: 'scroll-long-thread',
      title: 'Wheel down to the end, then up through older pages: no long frames, no jump against the scroll, no empty frame',
      probes: topicProbes,
      regions: paneRegions,
      checks: [
        noLongFrames({ from: 'down' }),
        scrollsOneWay('top', 'down', { from: 'down', to: 'up' }),
        scrollsOneWay('top', 'up', { from: 'up' }),
        noLayoutShift({ from: 'down', region: 'pane' }),
        neverBlank('pane', 'the message list'),
        noFlicker('pane', 'the message list'),
      ],
    },
    async (rec) => {
      await rec.mark('down')
      for (let i = 0; i < 20; i++) {
        await win.mouse.wheel(0, 300)
        await win.waitForTimeout(40)
      }
      await win.waitForTimeout(300)
      await rec.mark('up')
      for (let i = 0; i < 50; i++) {
        await win.mouse.wheel(0, -300)
        await win.waitForTimeout(40)
      }
    },
  )
})
