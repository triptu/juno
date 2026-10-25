// Also send to #eng (spec section 7, "More" and "Messages"): your own reply in
// a thread goes to the channel too, as Slack's "Send reply to this channel"
// does, with `chat.update` and `reply_broadcast`. It shows in Main at once and
// is marked in the thread. Others' replies and the root have no such item. In
// Main a broadcast reply's "in <topic title>" opens the thread at it. That
// the reply is in view and flashes is the browser lane's (notifications.spec.ts).
import type { Juno } from './driver/juno'
import { expect } from './expect'
import { domTest } from './test'

const ENG_MAIN = '#eng'
const ROOT = 'Draft plan is in the doc'
const MINE = "Good. What's the rollback if replication lags on cutover day?"
const LEOS = 'We keep the old primary warm for 48h'

async function openPostgresThread(juno: Juno): Promise<void> {
  await juno.sidebar.row(ENG_MAIN).open()
  await juno.topic.expectTitle('Main')
  await juno.topic.threadLinkUnder(ROOT).open()
  await expect(juno.topic.message(MINE)).toBeVisible({ timeout: 15_000 })
}

domTest('Also send to #eng sends your own reply to the channel, and Main shows it at once', async ({ juno, fake }) => {
  await openPostgresThread(juno)
  await juno.sidebar.row(ROOT, { exact: true }).open()
  const { topic } = juno
  const stored = () => fake.messages('C0ENG').find((message) => message.text === MINE)

  // Only your own replies have it: not someone else's, and not the root.
  expect((await topic.chooseInMessageMenu(LEOS, null)).labels).not.toContain('Also send to #eng')
  expect((await topic.chooseInMessageMenu(ROOT, null)).labels).not.toContain('Also send to #eng')

  // Slack holds its answer: everything below shows before it has the change.
  fake.holdNext({ method: 'chat.update', before: true })
  const { labels } = await topic.chooseInMessageMenu(MINE, 'broadcast')
  // With your own message's rows, after the shared ones and before Edit.
  expect(labels.indexOf('Also send to #eng')).toBeGreaterThan(labels.indexOf('Open in Slack'))
  expect(labels.indexOf('Also send to #eng')).toBeLessThan(labels.indexOf('Edit'))
  await expect(topic.message(MINE)).toContainText('also sent to the channel')

  await juno.sidebar.row(ENG_MAIN).open()
  await topic.expectTitle('Main')
  const source = topic.message(MINE).locator('[data-broadcast-source]')
  await expect(source).toContainText(`in ${ROOT}`)
  expect(stored()?.subtype).toBeUndefined()

  fake.release()
  await expect.poll(() => stored()?.subtype).toBe('thread_broadcast')
  await expect(source).toContainText(`in ${ROOT}`)
  const updates = fake.calls.filter((call) => call.method === 'chat.update')
  expect(updates).toHaveLength(1)
  expect(updates[0]!.args).toMatchObject({ channel: 'C0ENG', ts: stored()!.ts, reply_broadcast: 'true' })
  expect(updates[0]!.args['text']).toBeUndefined()

  // Sent, the reply's menu no longer offers it.
  await topic.threadLinkUnder(ROOT).open()
  await expect(topic.message(MINE)).toContainText('also sent to the channel')
  expect((await topic.chooseInMessageMenu(MINE, null)).labels).not.toContain('Also send to #eng')
})

domTest('the topic title in Main opens the topic at the reply, and follows a rename', async ({ juno, fake, step }) => {
  const { topic } = juno
  const root = fake.messages('C0ENG').find((message) => message.text?.startsWith(ROOT) === true)!
  await step('the title opens the topic at the reply', async () => {
    await juno.sidebar.row(ENG_MAIN).open()
    await topic.expectTitle('Main')
    fake.injectMessage({ channel: 'C0ENG', user: 'U0DEV', text: 'Dry run passed on staging.', threadTs: root.ts, broadcast: true })
    const source = topic.message('Dry run passed on staging.').locator('[data-broadcast-source]')
    await expect(source).toContainText(`in ${ROOT}`)
    await source.click()

    await expect(topic.message(ROOT)).toBeVisible({ timeout: 15_000 })
    await expect(topic.message('Dry run passed on staging.')).toBeVisible()
    // In its thread it is marked, with no link back.
    await expect(topic.message('Dry run passed on staging.')).toContainText('also sent to the channel')
    await expect(topic.message('Dry run passed on staging.').locator('[data-broadcast-source]')).toHaveCount(0)
  })
  await step('Main follows a renamed topic title', async () => {
    await juno.sidebar.row(ENG_MAIN).open()
    await topic.expectTitle('Main')
    fake.injectMessage({ channel: 'C0ENG', user: 'U0DEV', text: 'The rollout is ready.', threadTs: root.ts, broadcast: true })
    const source = topic.message('The rollout is ready.').locator('[data-broadcast-source]')
    await expect(source).toHaveText(`in ${ROOT}`)
    await juno.sidebar.row(ROOT, { exact: true }).chooseInMenu('rename')
    await juno.rename('Friday rollout')
    await expect(source).toHaveText('in Friday rollout')
    await source.click()
    await juno.topic.expectTitle('Friday rollout')
  })
})
