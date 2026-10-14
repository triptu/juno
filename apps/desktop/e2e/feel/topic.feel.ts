// Opening topics, and what arrives while one is open, on the default seed.
import { contentHoldsStill, happened, landsAndStays, neverBlank, noFlicker, noLayoutShift, staysAtBottom, switchesOnce } from './checks'
import { expect, test } from './feel'
import { count, edgeKey, header, paneRegions, sidebarReorder, topicProbes } from './pane'

const POSTGRES = 'Draft plan is in the doc'
const RINA = 'Rina finished the onsite.'

test('open a topic at its divider, then another at its bottom', async ({ juno, feel }) => {
  await juno.signIn()
  await juno.waitForSync()

  await feel.run(
    {
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
    },
    async (rec) => {
      await rec.mark('press')
      await juno.sidebar.row(RINA).open()
      await juno.topic.expectDividerBefore('Strong systems design')
    },
  )

  await feel.run(
    {
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
    },
    async (rec) => {
      await rec.mark('press')
      await juno.sidebar.row(POSTGRES).open()
      await juno.topic.expectMessage('Booked 2–4pm')
      await juno.topic.expectAtBottom()
    },
  )
})

test('a reaction and a live reply arrive while reading at the bottom', async ({ juno, slack, feel }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.expectAtBottom()
  await juno.win.waitForTimeout(500)
  const root = slack.root(POSTGRES)
  const leo = slack.as('Leo').id

  await feel.run(
    {
      name: 'reaction-at-bottom',
      title: 'Someone reacts to the last message: the chip appears and the list stays at the bottom without a jump',
      probes: topicProbes,
      regions: paneRegions,
      checks: [
        happened('the reaction showed', (r) => count(r.frames.at(-1)!.values, 'reactions') > count(r.frames[0]!.values, 'reactions')),
        // The last row grows by the chip; the list keeps its end in view, which scrolls what is above it. That is following, not a jump.
        staysAtBottom('scroll', { from: 'react' }),
        noLayoutShift({ from: 'react', includeInput: true, region: 'pane' }),
        sidebarReorder('react'),
        noFlicker('pane', 'the message list'),
      ],
    },
    async (rec) => {
      const last = await juno.topic.list.locator('[data-message-row]').last()
      const ts = (await last.getAttribute('data-message-row'))!
      await rec.mark('react')
      slack.fake.addReaction({ channel: root.channel, ts, name: 'eyes', user: leo })
      await expect(last.getByRole('list', { name: 'Reactions' })).toBeVisible({ timeout: 15_000 })
    },
  )

  await feel.run(
    {
      name: 'live-reply-at-bottom',
      title: 'A reply arrives while reading at the bottom: it appears at the bottom and the list follows it in the same frame',
      probes: topicProbes,
      regions: paneRegions,
      checks: [
        happened('the reply showed', (r) => count(r.frames.at(-1)!.values, 'rows') > count(r.frames[0]!.values, 'rows')),
        staysAtBottom('scroll', { from: 'reply' }),
        noLayoutShift({ from: 'reply', includeInput: true, region: 'pane' }),
        sidebarReorder('reply'),
        noFlicker('pane', 'the message list'),
      ],
    },
    async (rec) => {
      await rec.mark('reply')
      slack.as('Leo').replyIn(POSTGRES, 'Feel check: a live reply at the bottom.')
      await juno.topic.expectMessage('Feel check: a live reply at the bottom.')
    },
  )
})
