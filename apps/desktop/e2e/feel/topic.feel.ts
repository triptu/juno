// What arrives while a topic is open, on the default seed. Opening topics is in after-idle.feel.ts.
import { happened, noFlicker, noLayoutShift, staysAtBottom } from './checks'
import { expect, test } from './feel'
import { count, paneRegions, sidebarReorder, topicProbes } from './pane'

// Starts signed in and synced (README, "Synced start").
test.use({ synced: true })

const POSTGRES = 'Draft plan is in the doc'

test('a reaction and a live reply arrive while reading at the bottom', { tag: '@on-demand' }, async ({ juno, slack, feel }) => {
  await juno.sidebar.row(POSTGRES).open()
  // Enough replies that the list scrolls, in Compact density too: in a list that fits, staying at the bottom proves nothing.
  for (let i = 1; i <= 14; i++) slack.as('Leo').replyIn(POSTGRES, `Notes from the dry run, part ${i}.`)
  await juno.topic.expectMessage('Notes from the dry run, part 14.')
  await juno.topic.expectAtBottom()
  await expect.poll(() => juno.topic.scroller.evaluate((scroller) => scroller.scrollHeight - scroller.clientHeight)).toBeGreaterThan(200)
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
