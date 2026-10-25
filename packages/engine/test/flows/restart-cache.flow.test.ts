// Restarts that find a cache written by an earlier build (ADR 0008): the kept cache.db is used as it is, filled
// in where the earlier build left gaps, and migrated in place, with no new first sync. Every test starts warm on
// the synced default workspace.
import { DatabaseSync } from 'node:sqlite'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it } from 'bun:test'
import type { Person } from '@juno/contract'
import { sessionProfileAtom } from '@juno/state'
import { startTestEngine, waitFor, type RunningEngine } from '../harness'
import { apiCalls, readDb, restart } from '../scenario'
import { syncedEngine } from '../synced'

const engines: Array<RunningEngine> = []
afterEach(async () => {
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
})

const synced = () => syncedEngine(engines)
const callsFor = (engine: RunningEngine, method: string, reason: string) => apiCalls(engine, method).filter((call) => call.args['_x_reason'] === reason)

it('users stored without a photo get one on the next start, from the cache kept, with no new sync', async () => {
  const first = await synced()
  const engine = await restart(engines, first, () => {
    // A cache written before photos were built from the avatar hash.
    const db = new DatabaseSync(join(first.userData, 'workspaces', first.fake.teamId, 'cache.db'))
    try {
      db.prepare('UPDATE users SET avatar_url = NULL, avatar_small_url = NULL, avatar_large_url = NULL').run()
      db.prepare(`INSERT INTO sync_state (key, value_json) VALUES ('test_kept', 'true')`).run()
    } finally {
      db.close()
    }
  })
  const rows = await engine.rowsUntil((list) => list.some((row) => row.id === 'm:D0MAYA' && row.channel.partner?.avatarLargeUrl !== undefined), 'Maya’s DM with her photo')
  expect(rows.find((row) => row.id === 'm:D0MAYA')!.channel.partner!.avatarLargeUrl).toMatch(/T0JUNO-U0MAYA-fakeu0maya-192$/)
  // The account menu's photo.
  const unmount = engine.registry.mount(sessionProfileAtom)
  try {
    const self = await waitFor(() => {
      const result = engine.registry.get(sessionProfileAtom)
      return result._tag === 'Success' && result.value?.avatarUrl !== undefined ? result.value : undefined
    }, undefined, 'the signed-in person’s photo')
    expect((self as Person).avatarUrl).toBeTruthy()
  } finally {
    unmount()
  }
  // The cache file was kept, not deleted and synced again.
  expect(readDb(engine, 'cache.db', (db) => db.prepare(`SELECT value_json FROM sync_state WHERE key = 'test_kept'`).get())).toEqual({ value_json: 'true' })
  expect(callsFor(engine, 'conversations.history', 'history')).toEqual([])
})

// An update keeps the local cache. A build that adds a cache migration runs it on the synced file,
// shows the stored rows before Slack answers, and catches up as a warm boot does.
it('an update that adds a cache migration keeps the synced rows and makes no cold-boot history calls', async () => {
  const first = await synced()
  const { fake, userData } = first
  const credentials = fake.credentials()
  await first.syncIdle()
  first.registry.dispose()
  await first.handle.stop()
  engines.splice(engines.indexOf(first), 1)
  fake.resetCalls()
  // Nothing from Slack reaches the new build until the test lets it.
  fake.holdNext({ method: 'client.userBoot', before: true })
  const engine = await startTestEngine({ reuse: { userData, fake, credentials }, initial: () => credentials, cacheMigrationProbe: true })
  engines.push({ ...engine, stop: async () => { await engine.stop(); await fake.close(); await rm(userData, { recursive: true, force: true }) } })

  const painted = await engine.rowsUntil((rows) => rows.some((row) => row.title.startsWith('Draft plan is in the doc')), 'the stored rows')
  expect(painted.length).toBeGreaterThan(5)
  await waitFor(() => (fake.heldCount({ method: 'client.userBoot' }) === 1 ? true : undefined), undefined, 'the held userBoot')
  expect(fake.callCount('conversations.history')).toBe(0)

  fake.release()
  await engine.phase('live')
  await engine.syncIdle()
  const history = engine.fake.calls.filter((call) => call.method === 'conversations.history' || call.method === 'conversations.replies')
  expect(history.filter((call) => ['history', 'thread-preview'].includes(call.args['_x_reason'] ?? ''))).toEqual([])
  // A warm boot's budget: no history pages, only the restart's recheck of at most 10 topics, one page each.
  expect(new Set(history.map((call) => call.args['_x_reason']))).toEqual(new Set(['recheck']))
  expect(history.length).toBeLessThanOrEqual(10)
  expect(fake.callCount('client.userBoot')).toBe(1)
  // The migration ran on the populated file and kept its rows.
  readDb(engine, 'cache.db', (db) => {
    expect((db.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>).map((column) => column.name)).toContain('update_probe')
    expect((db.prepare('SELECT count(*) AS n FROM messages').get() as { n: number }).n).toBeGreaterThan(0)
  })
})
