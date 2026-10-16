import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect } from 'effect'
import { afterEach, expect, it } from 'vitest'
import { prefsSet } from '@juno/contract'
import { CONVERSATIONS, SELF_ID, startFakeSlack, type FakeSlack } from '@juno/fake-slack'
import { prefs, Store, workspacePaths } from '@juno/store'
import { runCommand, sidebarListAtom } from '@juno/state'
import { startTestEngine, waitFor, type RunningEngine } from './harness'
import { apiCalls, bootedEngine, callMap, DAY, quiet, readDb, seedThread, valueOf } from './scenario'

const engines: RunningEngine[] = []
afterEach(async () => {
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
})

async function quietBoot(days: number, seed: (fake: FakeSlack) => void = () => {}): Promise<RunningEngine> {
  const fake = await startFakeSlack()
  seed(fake)
  const userData = join(tmpdir(), `juno-window-${process.pid}-${days}-${Date.now()}`)
  await mkdir(userData, { recursive: true })
  await Effect.runPromise(prefs.set('quietDays', days).pipe(Effect.provide(Store.layer(workspacePaths(userData, fake.teamId))), Effect.scoped))
  const credentials = fake.signIn()
  const engine = await startTestEngine({ reuse: { userData, fake, credentials }, initial: () => credentials })
  engines.push({ ...engine, stop: async () => { await engine.stop(); await fake.close(); await rm(userData, { recursive: true, force: true }) } })
  await engine.phase('live')
  await quiet(engine)
  return engine
}

it.each([3, 7, 14])('cold boot call budget with a %i-day preference', async (days) => {
  const engine = await quietBoot(days)
  const expected = CONVERSATIONS.filter((c) => c.members.includes(SELF_ID) && c.messages.some((m) => m.ago < days * 24 * 60)).length
  expect(apiCalls(engine, 'conversations.history')).toHaveLength(expected)
  console.info(`quiet-window ${days} days: ${JSON.stringify(callMap(engine))}`)
})


it('a 3-day cold boot skips history for a conversation last active five days ago', async () => {
  const seed = (fake: FakeSlack) => {
    fake.workspace.addConversation({ id: 'C0FIVEDAYS', name: 'five-days', kind: 'public', members: new Set([SELF_ID, 'U0LEO']), created: fake.now() - 30 * DAY, topic: '', purpose: '', isOpen: true, archived: false })
    fake.workspace.post({ channel: 'C0FIVEDAYS', user: 'U0LEO', text: 'Five-day notes', at: fake.now() - 5 * DAY, silent: true })
  }
  const three = await quietBoot(3, seed)
  const seven = await quietBoot(7, seed)
  expect(apiCalls(three, 'conversations.history').some((c) => c.args['channel'] === 'C0FIVEDAYS')).toBe(false)
  expect(apiCalls(seven, 'conversations.history').some((c) => c.args['channel'] === 'C0FIVEDAYS')).toBe(true)
  expect(apiCalls(three, 'conversations.history').length).toBeLessThan(apiCalls(seven, 'conversations.history').length)
})

it('lowering hides an old read topic without calls or deletion; raising backfills every conversation', async () => {
  let oldId = ''
  let unreadId = ''
  const engine = await bootedEngine(engines, {
    initial: (fake) => {
      oldId = seedThread(fake, { channel: 'C0PLATFORM', text: 'Five day topic', ago: 6 * DAY, replies: [5 * DAY], follow: true }).id
      unreadId = seedThread(fake, { channel: 'C0PLATFORM', text: 'Older unread topic', ago: 7 * DAY, replies: [6 * DAY], follow: true, unread: 1 }).id
      return fake.signIn()
    },
  })
  const unmount = engine.registry.mount(sidebarListAtom)
  await engine.rowsUntil((rows) => rows.some((r) => r.id === oldId) && rows.some((r) => r.id === unreadId), 'five-day and older unread topics')
  await quiet(engine)
  const stored = readDb(engine, 'cache.db', (db) => db.prepare('SELECT count(*) AS n FROM messages').get())
  engine.fake.resetCalls()
  valueOf(await runCommand(engine.registry, prefsSet, { key: 'quietDays', value: 3 }))
  await engine.rowsUntil((rows) => rows.every((r) => r.id !== oldId), 'old topic hidden')
  await quiet(engine)
  expect(engine.fake.calls).toEqual([])
  expect(readDb(engine, 'cache.db', (db) => db.prepare('SELECT count(*) AS n FROM messages').get())).toEqual(stored)
  const painted = await waitFor(() => {
    const window = engine.registry.get(sidebarListAtom)
    return !window.rows.has(oldId) && window.rows.has(unreadId) ? window.order : undefined
  }, 30_000, 'painted rows at three days')
  valueOf(await runCommand(engine.registry, prefsSet, { key: 'quietDays', value: 14 }))
  await waitFor(() => engine.registry.get(sidebarListAtom).rows.has(oldId) ? true : undefined, 30_000, 'cached topic returns')
  expect(engine.registry.get(sidebarListAtom).order.slice(0, painted.length)).toEqual(painted)
  await waitFor(() => readDb(engine, 'cache.db', (db) => {
    const row = db.prepare("SELECT value_json FROM sync_state WHERE key = 'boot'").get() as { value_json: string }
    return JSON.parse(row.value_json).quietDays === 14 ? true : undefined
  }), 30_000, 'window backfill')
  await quiet(engine)
  const start = (engine.fake.now() - 14 * DAY) / 1000
  const active = CONVERSATIONS.filter((c) => c.members.includes(SELF_ID) && c.messages.some((m) => m.ago < 14 * 24 * 60))
  for (const c of active) {
    const ranges = readDb(engine, 'cache.db', (db) => db.prepare('SELECT from_ts, to_ts FROM synced_ranges WHERE channel = ?').all(c.id)) as { from_ts: string; to_ts: string }[]
    const latest = Math.max(...engine.fake.messages(c.id).filter((m) => m.thread_ts === undefined || m.thread_ts === m.ts).map((m) => Number(m.ts)))
    expect(ranges.some((r) => Number(r.from_ts) <= start + 30 && Number(r.to_ts) >= latest)).toBe(true)
  }
  expect(apiCalls(engine, 'conversations.history').every((c) => c.args['_x_reason'] === 'window-history')).toBe(true)
  unmount()
})

it('backfill pages to the window and stores every message before marking it covered', async () => {
  const engine = await quietBoot(7, (fake) => {
    fake.workspace.addConversation({ id: 'C0OLDPAGES', name: 'old-pages', kind: 'public', members: new Set([SELF_ID, 'U0LEO']), created: fake.now() - 30 * DAY, topic: '', purpose: '', isOpen: true, archived: false })
    for (let i = 0; i < 220; i++) fake.workspace.post({ channel: 'C0OLDPAGES', user: 'U0LEO', text: `Old note ${i}`, at: fake.now() - 10 * DAY + i * 60_000, silent: true })
  })
  expect(apiCalls(engine, 'conversations.history').some((c) => c.args['channel'] === 'C0OLDPAGES')).toBe(false)
  valueOf(await runCommand(engine.registry, prefsSet, { key: 'quietDays', value: 14 }))
  await waitFor(() => readDb(engine, 'cache.db', (db) => {
    const row = db.prepare("SELECT count(*) AS n FROM messages WHERE channel = 'C0OLDPAGES'").get() as { n: number }
    return row.n === 220 ? true : undefined
  }), 30_000, 'all older pages')
  await quiet(engine)
  expect(apiCalls(engine, 'conversations.history').filter((c) => c.args['channel'] === 'C0OLDPAGES')).toHaveLength(3)
  const before = apiCalls(engine, 'conversations.history').length
  valueOf(await runCommand(engine.registry, prefsSet, { key: 'quietDays', value: 3 }))
  await quiet(engine)
  valueOf(await runCommand(engine.registry, prefsSet, { key: 'quietDays', value: 14 }))
  await quiet(engine)
  expect(apiCalls(engine, 'conversations.history')).toHaveLength(before)
})

it('lowering cancels a held backfill without claiming its coverage', async () => {
  const engine = await quietBoot(3)
  engine.fake.holdNext({ method: 'conversations.history', reason: 'window-history' })
  valueOf(await runCommand(engine.registry, prefsSet, { key: 'quietDays', value: 14 }))
  await waitFor(() => engine.fake.heldCount() > 0 ? true : undefined, 30_000, 'held backfill page')
  const ranges = readDb(engine, 'cache.db', (db) => db.prepare('SELECT * FROM synced_ranges ORDER BY channel, from_ts').all())
  valueOf(await runCommand(engine.registry, prefsSet, { key: 'quietDays', value: 1 }))
  await engine.syncIdle()
  engine.fake.release()
  await quiet(engine)
  expect(readDb(engine, 'cache.db', (db) => db.prepare('SELECT * FROM synced_ranges ORDER BY channel, from_ts').all())).toEqual(ranges)
  expect(apiCalls(engine, 'conversations.history').filter((c) => c.args['_x_reason'] === 'window-history')).toHaveLength(1)
  valueOf(await runCommand(engine.registry, prefsSet, { key: 'quietDays', value: 14 }))
  await waitFor(() => readDb(engine, 'cache.db', (db) => {
    const row = db.prepare("SELECT value_json FROM sync_state WHERE key = 'boot'").get() as { value_json: string }
    return JSON.parse(row.value_json).quietDays === 14 ? true : undefined
  }), 30_000, 'resumed backfill')
})
