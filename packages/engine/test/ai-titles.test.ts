import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { SELF_ID } from '@juno/fake-slack'
import { bootedEngine } from './scenario'
import type { RunningEngine } from './harness'
import { TITLE_DAILY_BUDGET } from '../src/titleJob'

const engines: RunningEngine[] = []
afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.stop()
})

it('titles recent sidebar threads after sync without opening them and respects the daily budget after a key change', async () => {
  const engine = await bootedEngine(engines)
  const titled = await engine.rowsUntil(rows => rows.some(row => row.kind === 'thread') && rows.filter(row => row.kind === 'thread').every(row => row.titleSource === 'ai'), 'sidebar titles after sync')
  expect(titled.filter(row => row.kind === 'thread').length).toBeGreaterThan(1)
  const calls = () => engine.main.host.fromEngine.filter(message => message._tag === 'aiCall' && message.task === 'titleTopic').length
  expect(calls()).toBeGreaterThan(0)
  expect(calls()).toBeLessThanOrEqual(TITLE_DAILY_BUDGET)

  // Exhaust today's stored budget before a new thread arrives. These are invented answers.
  const db = new DatabaseSync(join(engine.userData, 'workspaces', engine.fake.teamId, 'cache.db'))
  try {
    const insert = db.prepare("INSERT INTO ai_cache (task, key, input_hash, output_json, created_at) VALUES ('titleTopic', ?, 'fake', '\"A title\"', ?)")
    for (let i = 0; i < TITLE_DAILY_BUDGET; i++) insert.run(`budget-fixture:${i}`, String(Date.now()))
  } finally {
    db.close()
  }
  const before = calls()
  engine.main.host.deliver({ _tag: 'aiKey', key: 'fake-changed-key' })
  const root = engine.fake.workspace.post({ channel: 'C0ENG', user: 'U0LEO', text: 'Postgres migration after the budget is spent' })
  engine.fake.workspace.post({ channel: 'C0ENG', user: SELF_ID, text: 'Following this.', threadTs: root.ts })
  const id = `t:C0ENG:${root.ts}`
  await engine.rowsUntil(rows => rows.some(row => row.id === id), 'new sidebar thread')
  await new Promise(resolve => setTimeout(resolve, 3_000))
  const rows = await engine.rowsUntil(rows => rows.some(row => row.id === id), 'sidebar after the title pass')
  expect(rows.find(row => row.id === id)?.titleSource).toBe('fallback')
  expect(calls()).toBe(before)
})
