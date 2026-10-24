// getView faults at boot (specs/follow.qnt): a row Juno cannot read never costs the good rows, a list it
// cannot prove complete never reads as unfollows, and refusals do not stop the first sync. Each test
// cold-boots because the fault must be in place before the first sync.
import { afterEach, expect, it } from 'bun:test'
import type { FakeSlack } from '@juno/fake-slack'
import type { RunningEngine } from './harness'
import { apiCalls, bootedEngine, seedThread, storedFollow, type SeededThread } from './scenario'
import { step } from './step'

const engines: Array<RunningEngine> = []
afterEach(async () => {
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
})

/** Twelve followed threads in #eng, the only follows, newest first. */
function followedThreads(fake: FakeSlack): Array<SeededThread> {
  fake.workspace.subscriptions.clear()
  return Array.from({ length: 12 }, (_, i) => seedThread(fake, { channel: 'C0ENG', text: `Schema check ${i}`, ago: 120_000 + i * 2000, replies: [60_000 + i * 2000], follow: true }))
}

/** getView lists `thread` with `field` missing from its root. */
function malformed(fake: FakeSlack, thread: SeededThread, field: string): void {
  const fields = { ...fake.workspace.withThreadFields({ ...fake.workspace.find(thread.channel, thread.ts)!, channel: thread.channel }) }
  Reflect.deleteProperty(fields, field)
  fake.workspace.threadViewRowOverrides.set(thread.ts, { root_msg: fields })
}

it('a malformed or unidentified getView row keeps the good rows and never reads as an unfollow', async () => {
  let seeded: Array<SeededThread> = []
  let cursor = ''
  const engine = await bootedEngine(engines, { timing: { followPassMillis: 3_600_000 }, recheckTopics: 0, initial: (fake) => {
    seeded = followedThreads(fake)
    cursor = fake.workspace.withThreadFields(fake.workspace.find('C0ENG', seeded[9]!.ts)!).latest_reply!
    malformed(fake, seeded[9]!, 'reply_count')
    return fake.signIn()
  } })
  const getViews = () => apiCalls(engine, 'subscriptions.thread.getView')
  const probed = (thread: SeededThread) => apiCalls(engine, 'conversations.replies').filter((call) => call.args['_x_reason'] === 'root' && call.args['ts'] === thread.ts)
  const reload = async () => {
    engine.fake.resetCalls()
    const cycle = engine.nextSync()
    engine.fake.emitFrame({ type: 'force_reload' })
    await cycle
  }
  const omitted = seeded[11]!

  await step("the boot reads on from the malformed last row's own cursor and keeps the good rows", async () => {
    expect(getViews()).toHaveLength(2)
    expect(getViews()[1]?.args['current_ts']).toBe(cursor)
    const rows = await engine.rows()
    for (const id of [seeded[0]!.id, seeded[11]!.id, 'm:C0ENG']) expect(rows.some((row) => row.id === id)).toBe(true)
    expect(engine.online()).toBe(true)
    expect(apiCalls(engine, 'client.userBoot')).toHaveLength(1)
  })

  await step('a later pass does not probe the dropped row as absent: it was listed', async () => {
    await reload()
    expect(storedFollow(engine, 'C0ENG', seeded[9]!.ts)).toBe(1)
    expect(probed(seeded[9]!)).toHaveLength(0)
  })

  await step('an unidentified row makes the list incomplete, so a follow missing from it is kept', async () => {
    engine.fake.workspace.threadViewRowOverrides.clear()
    // Unfollowed with no event: the stored follow would normally be probed from its absence.
    engine.fake.workspace.subscription(omitted.channel, omitted.ts)!.subscribed = false
    engine.fake.workspace.threadViewRowOverrides.set(seeded[0]!.ts, null)
    await reload()
    expect(storedFollow(engine, omitted.channel, omitted.ts)).toBe(1)
    expect(probed(omitted)).toHaveLength(0)
  })

  await step('a row without its cursor ends the list early, and the follow is still kept', async () => {
    engine.fake.workspace.threadViewRowOverrides.clear()
    malformed(engine.fake, seeded[9]!, 'latest_reply')
    await reload()
    expect(getViews()).toHaveLength(1)
    expect(storedFollow(engine, omitted.channel, omitted.ts)).toBe(1)
  })

  await step('a complete list reads the missing follow as the unfollow it is', async () => {
    engine.fake.workspace.threadViewRowOverrides.clear()
    await reload()
    expect(storedFollow(engine, omitted.channel, omitted.ts)).toBe(0)
  })
})

it.each([1, 100])('finishes the first sync after %i getView refusals and retries on the background lane', async (times) => {
  let seeded: Array<SeededThread> = []
  const engine = await bootedEngine(engines, { timing: { followPassMillis: 3_600_000 }, initial: (fake) => {
    seeded = followedThreads(fake)
    fake.forceError({ method: 'subscriptions.thread.getView', error: 'not_allowed', times })
    return fake.signIn()
  } })
  const rows = await engine.rows()
  expect(rows.some((row) => row.id === 'm:C0ENG')).toBe(true)
  expect(rows.some((row) => row.channel.kind === 'im')).toBe(true)
  expect(rows.some((row) => row.id === seeded[11]?.id)).toBe(true)
  expect(engine.online()).toBe(true)
  expect(apiCalls(engine, 'client.userBoot')).toHaveLength(1)
  const calls = apiCalls(engine, 'subscriptions.thread.getView')
  expect(calls[0]?.ok).toBe(false)
  expect(calls.length).toBeGreaterThan(1)
  expect(calls.slice(1).every((call) => call.ok)).toBe(times === 1)
})
