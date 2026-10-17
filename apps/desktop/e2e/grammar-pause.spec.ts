import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { expect, test } from './fixtures'

/**
 * Grammar starts on a typing pause (SPEC section 8), so a model slower than the
 * one-second window still shows its suggestion in time. The fake answers in
 * 1.2 s, slower than the window, as the live model does (p50 1.39 s on 10-16).
 */

test.describe.configure({ timeout: 120_000 })
test.use({ fakeAiDelayMillis: 1_200 })

const POSTGRES = 'Draft plan is in the doc'

const posts = (fake: { calls: ReadonlyArray<{ method: string; args: Record<string, unknown> }> }) => fake.calls.filter((call) => call.method === 'chat.postMessage')

/** Waits until a grammar answer for a draft typed after `since` is stored. */
async function grammarAnswered(userData: string, teamId: string, since: number): Promise<void> {
  await expect.poll(() => {
    const db = new DatabaseSync(join(userData, 'workspaces', teamId, 'cache.db'), { readOnly: true })
    try {
      const row = db.prepare(`SELECT max(CAST(created_at AS INTEGER)) AS at FROM ai_cache WHERE task = 'grammarCheck' AND model != ''`).get() as { at: number | null }
      return row.at ?? 0
    } finally { db.close() }
  }, { timeout: 15_000 }).toBeGreaterThanOrEqual(since)
}

test('a typing pause readies grammar, so a model slower than the window still shows within a second of sending', async ({ juno, fake, userData }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row(POSTGRES).open()
  const since = Date.now()
  await juno.topic.composer.fill('its broken')
  await grammarAnswered(userData, fake.teamId, since)
  await juno.topic.composer.press('Enter')
  await expect(juno.win.locator('[data-send-suggestion]')).toContainText("its → it's", { timeout: 1_000 })
  expect(posts(fake).map((call) => call.args['text'])).toEqual(['its broken'])
})

test('changing the text after a pause stops its grammar request and checks the new text', async ({ juno, fake, userData }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.composer.fill('its broken')
  // The pause has started the request; it is still waiting for the model.
  await juno.win.waitForTimeout(700)
  const since = Date.now()
  await juno.topic.composer.fill('their is a bug')
  await grammarAnswered(userData, fake.teamId, since)
  await juno.topic.composer.press('Enter')
  const suggestion = juno.win.locator('[data-send-suggestion]')
  await expect(suggestion).toContainText('their → there', { timeout: 1_000 })
  const cache = new DatabaseSync(join(userData, 'workspaces', fake.teamId, 'cache.db'), { readOnly: true })
  try {
    const rows = cache.prepare("SELECT key, output_json FROM ai_cache WHERE task = 'grammarCheck' ORDER BY created_at").all() as Array<{ key: string; output_json: string }>
    expect(rows).toHaveLength(2)
    expect(rows[0]!.key).toContain(':stopped:')
    expect(rows[0]!.output_json).toBe('')
    expect(JSON.parse(rows[1]!.output_json).edits).toHaveLength(1)
  } finally { cache.close() }
  // The AI activity log records both calls, the first one as stopped.
  await expect.poll(() => {
    const db = new DatabaseSync(join(userData, 'workspaces', fake.teamId, 'user.db'), { readOnly: true })
    try { return db.prepare("SELECT outcome FROM ai_calls WHERE feature = 'grammarCheck' ORDER BY id").all().map((row) => (row as { outcome: string }).outcome) }
    finally { db.close() }
  }).toEqual(['cancelled', 'ok'])
})
