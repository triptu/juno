import { afterEach, expect, it } from 'bun:test'
import { type FakeSlack } from '@juno/fake-slack'
import { bootedEngine, apiCalls, seedThread, storedFollow, type SeededThread } from './scenario'
import { type RunningEngine } from './harness'

const engines: RunningEngine[] = []
afterEach(async () => { for (const engine of engines.splice(0).toReversed()) await engine.stop() })

function threads(fake: FakeSlack): SeededThread[] {
  fake.workspace.subscriptions.clear()
  return Array.from({ length: 12 }, (_, index) => seedThread(fake, {
    channel: 'C0ENG', text: `Schema check ${index}`, ago: 120_000 + index * 2000,
    replies: [60_000 + index * 2000], follow: true,
  }))
}

function malformed(fake: FakeSlack, thread: SeededThread, field: string): void {
  const root = fake.workspace.find(thread.channel, thread.ts)!
  const fields = { ...fake.workspace.withThreadFields({ ...root, channel: thread.channel }) }
  Reflect.deleteProperty(fields, field)
  fake.workspace.threadViewRowOverrides.set(thread.ts, { root_msg: fields })
}

it('boots with a malformed last thread, pages from its original cursor, and keeps good sidebar rows', async () => {
  let seeded: SeededThread[] = []
  let cursor = ''
  const engine = await bootedEngine(engines, { timing: { followPassMillis: 3_600_000 }, initial: (fake) => {
    seeded = threads(fake)
    const last = seeded[9]!
    cursor = fake.workspace.withThreadFields(fake.workspace.find(last.channel, last.ts)!).latest_reply!
    malformed(fake, last, 'reply_count')
    return fake.signIn()
  } })
  const calls = apiCalls(engine, 'subscriptions.thread.getView')
  expect(calls).toHaveLength(2)
  expect(calls[1]?.args['current_ts']).toBe(cursor)
  const rows = await engine.rows()
  expect(rows.some((row) => row.id === seeded[0]?.id)).toBe(true)
  expect(rows.some((row) => row.id === seeded[11]?.id)).toBe(true)
  expect(rows.some((row) => row.id === 'm:C0ENG')).toBe(true)
  expect(engine.online()).toBe(true)
  expect(apiCalls(engine, 'client.userBoot')).toHaveLength(1)

  // The dropped row was still listed. A later pass must not probe it as absent.
  engine.fake.resetCalls()
  const cycle = engine.nextSync()
  engine.fake.emitFrame({ type: 'force_reload' })
  await cycle
  expect(storedFollow(engine, 'C0ENG', seeded[9]!.ts)).toBe(1)
  expect(apiCalls(engine, 'conversations.replies').filter((call) => call.args['_x_reason'] === 'root' && call.args['ts'] === seeded[9]!.ts)).toHaveLength(0)
})

it('keeps a stored follow when an unidentified row or missing cursor makes the list incomplete', async () => {
  let seeded: SeededThread[] = []
  const engine = await bootedEngine(engines, { timing: { followPassMillis: 3_600_000 }, recheckTopics: 0, initial: (fake) => { seeded = threads(fake); return fake.signIn() } })
  const omitted = seeded[11]!
  engine.fake.workspace.subscription(omitted.channel, omitted.ts)!.subscribed = false
  // No event: the existing follow would normally be probed from its absence.
  engine.fake.workspace.threadViewRowOverrides.set(seeded[0]!.ts, null)
  engine.fake.resetCalls()
  let cycle = engine.nextSync()
  engine.fake.emitFrame({ type: 'force_reload' })
  await cycle
  expect(storedFollow(engine, omitted.channel, omitted.ts)).toBe(1)
  expect(apiCalls(engine, 'conversations.replies').filter((call) => call.args['_x_reason'] === 'root' && call.args['ts'] === omitted.ts)).toHaveLength(0)

  engine.fake.workspace.threadViewRowOverrides.clear()
  malformed(engine.fake, seeded[9]!, 'latest_reply')
  engine.fake.resetCalls()
  cycle = engine.nextSync()
  engine.fake.emitFrame({ type: 'force_reload' })
  await cycle
  expect(apiCalls(engine, 'subscriptions.thread.getView')).toHaveLength(1)
  expect(storedFollow(engine, omitted.channel, omitted.ts)).toBe(1)

  engine.fake.workspace.threadViewRowOverrides.clear()
  cycle = engine.nextSync()
  engine.fake.emitFrame({ type: 'force_reload' })
  await cycle
  expect(storedFollow(engine, omitted.channel, omitted.ts)).toBe(0)
})

it.each([1, 100])('finishes first sync after %i getView refusals and retries on the background lane', async (times) => {
  let seeded: SeededThread[] = []
  const engine = await bootedEngine(engines, { timing: { followPassMillis: 3_600_000 }, initial: (fake) => {
    seeded = threads(fake)
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
