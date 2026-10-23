// An update keeps the local cache: a build that adds a cache migration opens
// the synced cache.db, runs the migration on it, paints the stored rows before
// any Slack answer and catches up with a warm boot, not a full sync again
// (ADR 0008, note of 10-16).
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, test } from './fixtures'

/** The `_x_reason`s of the cold boot's history and preview pages (`@juno/sync` `boot.ts`). */
const COLD_BOOT_REASONS = ['history', 'thread-preview']

test('an update that adds a cache migration keeps the synced rows and makes no cold-boot history calls', async ({ juno, fake, userData, relaunch }) => {
  await juno.signIn()
  await juno.waitForSync()
  const coldHistory = fake.calls.filter((call) => COLD_BOOT_REASONS.includes(call.args['_x_reason'] ?? '')).length
  expect(coldHistory).toBeGreaterThan(0)
  const updated = await relaunch({
    cacheMigration: true,
    whileClosed: () => {
      fake.resetCalls()
      // Nothing from Slack reaches the next build until the test lets it.
      fake.holdNext({ method: 'client.userBoot', before: true })
    },
  })
  await updated.expectSignedIn('Juno Fake')
  // First paint comes from the kept cache.
  await updated.sidebar.row('Draft plan is in the doc').expectVisible()
  await expect.poll(() => fake.heldCount({ method: 'client.userBoot' })).toBe(1)
  expect(fake.callCount('conversations.history')).toBe(0)

  fake.release()
  await updated.waitForSync()
  const history = fake.calls.filter((call) => call.method === 'conversations.history' || call.method === 'conversations.replies')
  expect(history.filter((call) => COLD_BOOT_REASONS.includes(call.args['_x_reason'] ?? ''))).toEqual([])
  // A warm boot's budget: no history pages, only the restart's recheck of at most `recheckTopics` (10) topics, one page each.
  expect(new Set(history.map((call) => call.args['_x_reason']))).toEqual(new Set(['recheck']))
  expect(history.length).toBeLessThanOrEqual(10)
  expect(fake.callCount('client.userBoot')).toBe(1)

  // The migration ran on the populated file and kept its rows.
  const [workspace] = await readdir(join(userData, 'workspaces'))
  const db = new DatabaseSync(join(userData, 'workspaces', workspace!, 'cache.db'), { readOnly: true })
  try {
    const columns = db.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>
    expect(columns.map((column) => column.name)).toContain('update_probe')
    const messages = db.prepare('SELECT count(*) AS n FROM messages').get() as { n: number }
    expect(messages.n).toBeGreaterThan(0)
  } finally {
    db.close()
  }
})
