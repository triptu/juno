// Home's review cards that read the cache alone (SPEC 12, docs/design/settled-suggestions/, "More
// self-management"): Unfollow threads you never open, Ignore channels you never read, and old drafts. Each
// row's action, its Undo and its "no" run through the same state helpers the review sheet calls, and the
// test reads what changed in Slack, the store and the sidebar. Follow-ups that look done come from the AI
// jobs and are in ai-jobs.flow.test.ts; the sheet itself is in the browser specs.
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { afterEach, expect, it } from 'bun:test'
import { channelsIgnored, channelsUnignore, homeView, type HomeItem, type HomeView, type IgnoredChannel, type UndoCommand } from '@juno/contract'
import type { FakeSlack } from '@juno/fake-slack'
import { actOnOldDraft, actOnSuggested, liveQuery, runCommand, undoOne } from '@juno/state'
import { waitFor, WAIT_MS, type RunningEngine } from '../harness'
import { DAY, readDb, restart, slackWrites, threadId, valueOf } from '../scenario'
import { step } from '../step'
import { syncedEngine } from '../synced'

const engines: Array<RunningEngine> = []
const unmounts: Array<() => void> = []
afterEach(async () => {
  for (const unmount of unmounts.splice(0)) unmount()
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
})

/** A live query's value once `pick` finds something in it. */
function liveUntil<A, B>(engine: RunningEngine, atom: Parameters<RunningEngine['registry']['mount']>[0], pick: (value: A) => B | undefined, label: string): Promise<B> {
  unmounts.push(engine.registry.mount(atom))
  return waitFor(() => {
    const value = (engine.registry.get(atom) as { value?: A }).value
    return value === undefined ? undefined : pick(value)
  }, WAIT_MS, label)
}
const home = (engine: RunningEngine, predicate: (view: HomeView) => boolean, label: string) =>
  liveUntil<HomeView, HomeView>(engine, liveQuery(homeView)(undefined), (view) => (predicate(view) ? view : undefined), label)
const card = (view: HomeView, kind: HomeItem['kind']) => view.items.find((item) => item.kind === kind)
const topicOf = (item: HomeItem | undefined, id: string) => item!.topics.find((topic) => topic.id === id)!
/** A row's action resolves with its undo, as the sheet keeps it for the row's Undo. */
const undoOf = (undo: UndoCommand | undefined): UndoCommand => {
  if (undo === undefined) throw new Error('the action changed nothing')
  return undo
}

/** A thread in #platform the user follows and never read: a root 20 days ago and seven replies since, the newest yesterday. */
function followedUnread(fake: FakeSlack, text: string): string {
  const root = fake.workspace.post({ channel: 'C0PLATFORM', user: 'U0DEV', text, at: fake.now() - 20 * DAY, silent: true })
  for (const [days, user] of [[18, 'U0LEO'], [15, 'U0MAYA'], [11, 'U0LEO'], [7, 'U0PRIYA'], [4, 'U0LEO'], [2, 'U0MAYA'], [1, 'U0LEO']] as const) {
    fake.workspace.post({ channel: 'C0PLATFORM', threadTs: root.ts, user, text: `Update from ${days} days ago`, at: fake.now() - days * DAY, silent: true })
  }
  fake.followThread({ channel: 'C0PLATFORM', threadTs: root.ts })
  return root.ts
}

it('Unfollow threads you never open: the reason, Unfollow and Undo in Slack, Keep following, and a mention follows again', async () => {
  let queue = ''
  const engine = await restart(engines, await syncedEngine(engines), (fake) => {
    queue = followedUnread(fake, 'Billing queue rollout')
    followedUnread(fake, 'Pricing page copy')
  })
  const { fake, registry } = engine
  const queueId = `t:C0PLATFORM:${queue}`
  const pricingId = threadId(fake, 'C0PLATFORM', 'Pricing page copy')
  const followed = () => fake.workspace.subscription('C0PLATFORM', queue)?.subscribed
  const followedIs = (value: boolean, label: string) => waitFor(() => (followed() === value ? true : undefined), WAIT_MS, label)

  const view = await home(engine, (value) => card(value, 'unfollow') !== undefined, 'the Unfollow card')
  const unfollow = card(view, 'unfollow')!
  expect(unfollow.topics.map((topic) => topic.id).toSorted()).toEqual([pricingId, queueId].toSorted())
  expect(topicOf(unfollow, queueId).unopened).toMatchObject({ count: 7 })
  const queueTopic = topicOf(unfollow, queueId)

  await step('Unfollow unfollows in Slack, and the row’s Undo follows again', async () => {
    const undo = undoOf(await actOnSuggested(registry, 'unfollow', queueTopic, 'act'))
    await followedIs(false, 'unfollowed in Slack')
    await undoOne(registry, undo)
    await followedIs(true, 'followed again in Slack')
  })

  await step('Keep following is not proposed again', async () => {
    undoOf(await actOnSuggested(registry, 'unfollow', topicOf(unfollow, pricingId), 'keep'))
    await home(engine, (value) => card(value, 'unfollow')?.topics.some((topic) => topic.id === pricingId) !== true, 'the kept thread off the card')
  })

  await step('unfollowed, the thread leaves the sidebar; a mention follows it again, as in Slack', async () => {
    await actOnSuggested(registry, 'unfollow', queueTopic, 'act')
    await followedIs(false, 'unfollowed in Slack')
    await engine.rowsUntil((rows) => !rows.some((row) => row.id === queueId), 'the thread out of the sidebar')
    fake.injectMessage({ channel: 'C0PLATFORM', threadTs: queue, user: 'U0MAYA', text: '<@U0TUSHAR> can you check the numbers before Friday?' })
    await followedIs(true, 'followed again after the mention')
    await engine.rowsUntil((rows) => rows.some((row) => row.id === queueId), 'the thread back in the sidebar')
    await home(engine, (value) => card(value, 'unfollow') === undefined, 'no Unfollow card')
  })
})

it('Ignore channels you never read: the reason, nothing in Slack, Undo, Stop ignoring brings it back, and Keep showing stops it', async () => {
  const engine = await restart(engines, await syncedEngine(engines), (fake) => {
    // Nothing read in #build-chatter since a message 40 days ago, and 55 messages in the last week.
    fake.addChannel({ id: 'C0BUILDS', name: 'build-chatter', messages: [{ user: 'U0LEO', text: 'Nightly builds move to 2am', ago: 40 * 24 * 60 }] })
    for (let i = 0; i < 55; i++) {
      fake.workspace.post({ channel: 'C0BUILDS', user: i % 2 === 0 ? 'U0LEO' : 'U0SAM', text: `Build ${i} is green`, at: fake.now() - 6 * DAY + i * 2 * 60 * 60_000, silent: true })
    }
  })
  const { registry } = engine
  const inSidebar = (shown: boolean, label: string) => engine.rowsUntil((rows) => rows.some((row) => row.channel.id === 'C0BUILDS') === shown, label)
  const ignored = () => liveUntil<ReadonlyArray<IgnoredChannel>, ReadonlyArray<IgnoredChannel>>(engine, liveQuery(channelsIgnored)(undefined), (list) => list, 'the ignore list')

  const view = await home(engine, (value) => card(value, 'ignore') !== undefined, 'the Ignore card')
  const topic = topicOf(card(view, 'ignore'), 'm:C0BUILDS')
  expect(card(view, 'ignore')!.topics).toHaveLength(1)
  expect(topic.unopened).toMatchObject({ count: 55 })
  expect(Date.now() - topic.unopened!.lastRead!).toBeGreaterThan(35 * DAY)

  await step('Ignore hides the channel and writes nothing to Slack; the row’s Undo shows it again', async () => {
    const since = engine.fake.calls.length
    const undo = undoOf(await actOnSuggested(registry, 'ignore', topic, 'act'))
    await inSidebar(false, 'the channel out of the sidebar')
    expect((await ignored()).map((channel) => channel.id)).toContain('C0BUILDS')
    expect(slackWrites(engine, since)).toEqual([])
    await undoOne(registry, undo)
    await inSidebar(true, 'the channel back')
  })

  await step('ignored and then no longer ignored, the suggestion comes back; Keep showing stops it', async () => {
    await actOnSuggested(registry, 'ignore', topic, 'act')
    await inSidebar(false, 'the channel out of the sidebar')
    valueOf(await runCommand(registry, channelsUnignore, { channel: 'C0BUILDS' }))
    const back = await home(engine, (value) => card(value, 'ignore') !== undefined, 'the suggestion back')
    undoOf(await actOnSuggested(registry, 'ignore', topicOf(card(back, 'ignore'), 'm:C0BUILDS'), 'keep'))
    await home(engine, (value) => card(value, 'ignore') === undefined, 'no Ignore card')
    await inSidebar(true, 'the channel still shown')
  })
})

it('old drafts: one untouched for two weeks is proposed with its age and first line; Delete, Undo and Keep work per row', async () => {
  const first = await syncedEngine(engines)
  const postgres = threadId(first.fake, 'C0ENG', 'Draft plan is in the doc')
  const engine = await restart(engines, first, (fake) => {
    // Two drafts written 15 days ago, in topics that moved on since.
    const old = String(Date.now() - 15 * DAY)
    const db = new DatabaseSync(join(first.userData, 'workspaces', fake.teamId, 'user.db'))
    const insert = db.prepare('INSERT INTO drafts (topic_id, text, updated_at) VALUES (?, ?, ?)')
    insert.run('m:C0ENG', 'Before the window we should\nsecond line', old)
    insert.run(postgres, 'Can we move the cutover to', old)
    db.close()
  })
  const { registry } = engine
  const draftOf = (topicId: string) => readDb(engine, 'user.db', (db) => (db.prepare('SELECT text FROM drafts WHERE topic_id = ?').get(topicId) as { text: string } | undefined)?.text)

  const view = await home(engine, (value) => card(value, 'oldDrafts') !== undefined, 'the old drafts card')
  const drafts = card(view, 'oldDrafts')!
  expect(drafts.topics.map((topic) => topic.id).toSorted()).toEqual(['m:C0ENG', postgres].toSorted())
  const main = topicOf(drafts, 'm:C0ENG')
  expect(main.draft).toMatchObject({ text: 'Before the window we should' })
  expect(main.draft!.since).toBeGreaterThan(0)
  expect(topicOf(drafts, postgres).draft).toMatchObject({ text: 'Can we move the cutover to' })

  await step('Delete removes the draft, and the row’s Undo puts it back', async () => {
    const undo = undoOf(await actOnOldDraft(registry, main, 'delete'))
    expect(draftOf('m:C0ENG')).toBeUndefined()
    await undoOne(registry, undo)
    expect(draftOf('m:C0ENG')).toBe('Before the window we should\nsecond line')
  })

  await step('a kept draft is not proposed again and stays; a deleted one is gone', async () => {
    undoOf(await actOnOldDraft(registry, topicOf(drafts, postgres), 'keep'))
    undoOf(await actOnOldDraft(registry, main, 'delete'))
    await home(engine, (value) => card(value, 'oldDrafts') === undefined, 'no old drafts card')
    expect(draftOf(postgres)).toBe('Can we move the cutover to')
    expect(draftOf('m:C0ENG')).toBeUndefined()
  })
})
