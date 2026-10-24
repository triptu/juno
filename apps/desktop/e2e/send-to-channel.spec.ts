// Also send to #eng (spec section 7, "More" and "Messages"): your own reply in
// a thread goes to the channel too, as Slack's "Send reply to this channel"
// does, with `chat.update` and `reply_broadcast`. It shows in Main at once and
// is marked in the thread. Others' replies and the root have no such item. In
// Main a broadcast reply's "in <topic title>" opens the thread at it.
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import type { Locator } from '@playwright/test'
import { expect, test } from './fixtures'
import { watchFlashes } from './driver/flashes'
import type { Juno } from './driver/juno'

test.use({ synced: true })

test.describe.configure({ timeout: 120_000 })

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

/** Primary mouse down and up on `target`, as a person presses it. */
async function press(juno: Juno, target: Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded()
  const box = await target.boundingBox()
  if (box === null) throw new Error('not on screen')
  await juno.win.mouse.move(box.x + 8, box.y + box.height / 2)
  await juno.win.mouse.down()
  await juno.win.mouse.up()
}

test('Also send to #eng sends your own reply to the channel, and Main shows it at once', async ({ juno, fake }) => {
  await openPostgresThread(juno)
  await juno.setTheme('Dark')
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

function broadcastRows(userData: string, team: string): number {
  const db = new DatabaseSync(join(userData, 'workspaces', team, 'user.db'), { readOnly: true })
  try {
    return Number(db.prepare("SELECT count(*) AS n FROM outbox WHERE kind = 'broadcast'").get()!['n'])
  } finally {
    db.close()
  }
}

test('a lost broadcast answer and socket event reconcile before the row ends', async ({ juno, fake, userData }) => {
  await openPostgresThread(juno)
  const reply = fake.messages('C0ENG').find((message) => message.text === MINE)!
  fake.holdFrames({ types: ['message'] })
  fake.loseResponse({ method: 'chat.update' })
  await juno.topic.chooseInMessageMenu(MINE, 'broadcast')
  await expect.poll(() => fake.calls.filter((call) => call.method === 'chat.update').length).toBeGreaterThanOrEqual(2)
  await expect.poll(() => fake.calls.some((call) => call.method === 'conversations.history' && call.args['oldest'] === reply.ts && call.args['latest'] === reply.ts)).toBe(true)
  await expect.poll(() => broadcastRows(userData, fake.teamId)).toBe(0)
  fake.releaseFrames({ drop: true })
  await expect(juno.topic.message(MINE)).toContainText('also sent to the channel')
  await juno.sidebar.row(ENG_MAIN).open()
  await expect(juno.topic.message(MINE).locator('[data-broadcast-source]')).toHaveText(`in ${ROOT}`)
  await juno.win.reload()
  await juno.waitForSync()
  await juno.sidebar.row(ENG_MAIN).open()
  await expect(juno.topic.message(MINE).locator('[data-broadcast-source]')).toHaveText(`in ${ROOT}`)
})

test('a refused broadcast removes the optimistic copy and mark', async ({ juno, fake, userData }) => {
  await openPostgresThread(juno)
  fake.forceError({ method: 'chat.update', error: 'cant_broadcast_message' })
  fake.holdNext({ method: 'chat.update', before: true })
  await juno.topic.chooseInMessageMenu(MINE, 'broadcast')
  await expect(juno.topic.message(MINE)).toContainText('also sent to the channel')
  await juno.sidebar.row(ENG_MAIN).open()
  await expect(juno.topic.message(MINE)).toBeVisible()
  fake.release()
  await expect.poll(() => broadcastRows(userData, fake.teamId)).toBe(0)
  await expect(juno.topic.message(MINE)).toHaveCount(0)
  await juno.topic.threadLinkUnder(ROOT).open()
  await expect(juno.topic.message(MINE)).not.toContainText('also sent to the channel')
  expect((await juno.topic.chooseInMessageMenu(MINE, null)).labels).toContain('Also send to #eng')
})

test('an edit and broadcast of one reply keep their order and separate calls', async ({ juno, fake }) => {
  await openPostgresThread(juno)
  fake.holdNext({ method: 'chat.update', before: true })
  await juno.topic.chooseInMessageMenu(MINE, 'edit')
  const edit = juno.topic.list.getByRole('textbox', { name: 'Edit message' })
  const changed = 'Keep the old primary warm until Friday.'
  await edit.fill(changed)
  await edit.press('Enter')
  await expect.poll(() => fake.heldCount({ method: 'chat.update' })).toBe(1)
  await juno.topic.chooseInMessageMenu(changed, 'broadcast')
  await expect(juno.topic.message(changed)).toContainText('also sent to the channel')
  fake.release()
  await expect.poll(() => fake.messages('C0ENG').find((message) => message.text === changed)?.subtype).toBe('thread_broadcast')
  const calls = fake.calls.filter((call) => call.method === 'chat.update')
  expect(calls).toHaveLength(2)
  expect(calls[0]!.args['text']).toBe(changed)
  expect(calls[0]!.args['reply_broadcast']).toBeUndefined()
  expect(calls[1]!.args['text']).toBeUndefined()
  expect(calls[1]!.args['reply_broadcast']).toBe('true')
  await juno.sidebar.row(ENG_MAIN).open()
  await expect(juno.topic.message(changed)).toBeVisible()
})

test('the topic title in Main opens the topic at the reply, which flashes, and follows a rename', async ({ juno, fake }) => {
  const { topic } = juno
  const root = fake.messages('C0ENG').find((message) => message.text?.startsWith(ROOT) === true)!
  await test.step('the title opens the topic at the reply, which flashes', async () => {
    await juno.sidebar.row(ENG_MAIN).open()
    await topic.expectTitle('Main')
    fake.injectMessage({ channel: 'C0ENG', user: 'U0DEV', text: 'Dry run passed on staging.', threadTs: root.ts, broadcast: true })
    const source = topic.message('Dry run passed on staging.').locator('[data-broadcast-source]')
    await expect(source).toContainText(`in ${ROOT}`)
    const flashed = await watchFlashes(juno.win)
    await press(juno, source)

    await expect(topic.message(ROOT)).toBeVisible({ timeout: 15_000 })
    await expect(topic.message('Dry run passed on staging.')).toBeInViewport()
    // In its thread it is marked, with no link back.
    await expect(topic.message('Dry run passed on staging.')).toContainText('also sent to the channel')
    await expect(topic.message('Dry run passed on staging.').locator('[data-broadcast-source]')).toHaveCount(0)
    await expect.poll(async () => (await flashed()).some((row) => row.includes('Dry run passed on staging.')), { timeout: 10_000 }).toBe(true)
  })
  await test.step('Main follows a renamed topic title', async () => {
    await juno.sidebar.row(ENG_MAIN).open()
    await topic.expectTitle('Main')
    fake.injectMessage({ channel: 'C0ENG', user: 'U0DEV', text: 'The rollout is ready.', threadTs: root.ts, broadcast: true })
    const source = topic.message('The rollout is ready.').locator('[data-broadcast-source]')
    await expect(source).toHaveText(`in ${ROOT}`)
    await juno.sidebar.row(ROOT, { exact: true }).chooseInMenu('rename')
    await juno.rename('Friday rollout')
    await expect(source).toHaveText('in Friday rollout')
    await press(juno, source)
    await juno.topic.expectTitle('Friday rollout')
  })
})
