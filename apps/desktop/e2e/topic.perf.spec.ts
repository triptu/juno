import { expect, test } from './fixtures'

test.skip(process.env.JUNO_PERF !== '1', 'set JUNO_PERF=1 to measure')

const POSTGRES = 'Draft plan is in the doc'

test('a read topic warms on hover, opens from the cache, and opens at the bottom', async ({ juno, slack }) => {
  await juno.signIn()
  await juno.waitForSync()

  await test.step('hovering a row warms the topic without asking Slack', async () => {
    slack.resetCalls()
    await juno.sidebar.row(POSTGRES).hover()
    await expect.poll(() => juno.lastMark('juno.prefetch')).toBeDefined()
    // Anything the warm-up would ask Slack has had time to arrive.
    await juno.win.waitForTimeout(500)
    expect(slack.fake.calls.map((call) => call.method)).toEqual([])
    // The open is a cache hit: the tab paints with its rows.
    await juno.sidebar.row(POSTGRES).open()
    await juno.topic.expectMessage('Booked 2–4pm')
    await expect.poll(() => juno.measure('juno.topic-open')).toBeLessThan(250)
  })

  await test.step('a read topic opens at the bottom with no divider', async () => {
    await juno.sidebar.row(POSTGRES).open()
    await juno.topic.expectMessage('Booked 2–4pm')
    await juno.topic.expectNoDivider()
    await juno.topic.expectAtBottom()
  })
})
