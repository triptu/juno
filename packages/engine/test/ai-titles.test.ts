import { step } from './step'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { afterEach, expect, it } from 'bun:test'
import { SELF_ID } from '@juno/fake-slack'
import { bootedEngine } from './scenario'
import type { RunningEngine } from './harness'
import { TITLE_DAILY_BUDGET } from '../src/titleJob'

const engines: RunningEngine[] = []
afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.stop()
})

it('keeps existing titles after a key change, then respects the daily budget for new threads', async () => {
  const engine = await bootedEngine(engines, { aiJobs: true })
  await step('leaves a stored AI title as it is, sharp in privacy mode, with no second call', async () => {
    const titled = await engine.rowsUntil(rows => rows.some(row => row.kind === 'thread') && rows.filter(row => row.kind === 'thread').every(row => row.titleSource === 'ai'), 'sidebar titles after sync')
    const thread = titled.find(row => row.kind === 'thread')!
    expect(thread.titleSensitive).toBeUndefined()
    const user = join(engine.userData, 'workspaces', engine.fake.teamId, 'user.db')
    const sql = <A>(run: (db: DatabaseSync) => A): A => {
      const db = new DatabaseSync(user)
      try {
        return run(db)
      } finally {
        db.close()
      }
    }
    // An invented title as an older prompt might have written it.
    sql(db => db.prepare("UPDATE topic_overlay SET ai_title = 'Go with 100k for Donna' WHERE topic_id = ?").run(thread.id))
    const stored = () => sql(db => db.prepare('SELECT ai_title, ai_title_at FROM topic_overlay WHERE topic_id = ?').get(thread.id)) as { ai_title: string; ai_title_at: string }
    const before = stored()
    const calls = () => engine.main.host.fromEngine.filter(message => message._tag === 'aiCall' && message.task === 'titleTopic').length
    const asked = calls()
    engine.main.host.deliver({ _tag: 'aiKey', key: 'fake-changed-key' })
    await engine.workPass('title')
    expect(stored()).toEqual(before)
    expect(calls()).toBe(asked)
  })

  await step('titles recent sidebar threads after sync without opening them and respects the daily budget after a key change', async () => {
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
    engine.main.host.deliver({ _tag: 'aiKey', key: 'fake-budget-key' })
    const root = engine.fake.workspace.post({ channel: 'C0ENG', user: 'U0LEO', text: 'Postgres migration after the budget is spent' })
    engine.fake.workspace.post({ channel: 'C0ENG', user: SELF_ID, text: 'Following this.', threadTs: root.ts })
    const id = `t:C0ENG:${root.ts}`
    await engine.rowsUntil(rows => rows.some(row => row.id === id), 'new sidebar thread')
    await engine.workPass('title')
    const after = await engine.rowsUntil(rows => rows.some(row => row.id === id), 'sidebar after the title pass')
    expect(after.find(row => row.id === id)?.titleSource).toBe('fallback')
    // The first words are message text: privacy mode blurs them.
    expect(after.find(row => row.id === id)?.titleSensitive).toBe(true)
    expect(calls()).toBe(before)
  })
})

it('asks a title the model refused once, not again on later passes or after a wake, and again once the thread has a new message', async () => {
  const engine = await bootedEngine(engines, { aiJobs: true })
  const user = join(engine.userData, 'workspaces', engine.fake.teamId, 'user.db')
  const sql = (run: (db: DatabaseSync) => unknown) => {
    const db = new DatabaseSync(user)
    try {
      return run(db)
    } finally {
      db.close()
    }
  }
  // No fallback, so the refusal is the answer.
  sql(db => db.prepare("INSERT OR REPLACE INTO prefs (key, value_json) VALUES ('aiModels', ?)").run(JSON.stringify({ fallback: '' })))
  const calls = () => engine.main.host.fromEngine.filter(message => message._tag === 'aiCall' && message.task === 'titleTopic').length
  const root = engine.fake.workspace.post({ channel: 'C0ENG', user: 'U0LEO', text: '::refuse:: Kya kar rahe hain idhar bhai' })
  engine.fake.workspace.post({ channel: 'C0ENG', user: SELF_ID, text: 'Looking.', threadTs: root.ts })
  const id = `t:C0ENG:${root.ts}`
  const refusal = async () => {
    for (let tries = 0; tries < 100; tries++) {
      const row = sql(db => db.prepare("SELECT kind, at FROM ai_refusals WHERE task = 'titleTopic' AND key = ?").get(id)) as { kind: string; at: number } | undefined
      if (row !== undefined) return row
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error('no refusal recorded')
  }
  const first = await refusal()
  expect(first.kind).toBe('policy')
  const refused = calls()

  // A wake (a key change) and the passes after it do not send the same thread again.
  engine.main.host.deliver({ _tag: 'aiKey', key: 'fake-changed-key' })
  await engine.workPass('title')
  expect(calls()).toBe(refused)
  const rows = await engine.rowsUntil(rows => rows.some(row => row.id === id), 'the refused thread')
  expect(rows.find(row => row.id === id)?.titleSource).toBe('fallback')
  const logged = sql(db => db.prepare("SELECT count(*) AS n FROM ai_calls WHERE feature = 'titleTopic' AND subject_id = ? AND kind = 'policy'").get(id)) as { n: number }
  expect(logged.n).toBe(1)

  // A new message changes the input: it is asked again.
  engine.fake.workspace.post({ channel: 'C0ENG', user: 'U0LEO', text: 'Any update?', threadTs: root.ts })
  for (let tries = 0; tries < 100 && calls() === refused; tries++) await new Promise(resolve => setTimeout(resolve, 100))
  expect(calls()).toBe(refused + 1)
})

it('takes the fallback model\'s title when the main model refuses, and logs both calls', async () => {
  const engine = await bootedEngine(engines, { aiJobs: true })
  const root = engine.fake.workspace.post({ channel: 'C0ENG', user: 'U0LEO', text: '::refuse:: Postgres migration plan' })
  engine.fake.workspace.post({ channel: 'C0ENG', user: SELF_ID, text: 'Looking.', threadTs: root.ts })
  const id = `t:C0ENG:${root.ts}`
  await engine.rowsUntil(rows => rows.find(row => row.id === id)?.titleSource === 'ai', 'the fallback title')
  const db = new DatabaseSync(join(engine.userData, 'workspaces', engine.fake.teamId, 'user.db'))
  try {
    let logged: Array<{ model: string; outcome: string; kind: string }> = []
    for (let tries = 0; tries < 50 && logged.length < 2; tries++) {
      logged = db.prepare("SELECT model, outcome, kind FROM ai_calls WHERE feature = 'titleTopic' AND subject_id = ? ORDER BY id").all(id) as typeof logged
      if (logged.length < 2) await new Promise(resolve => setTimeout(resolve, 100))
    }
    expect(logged).toEqual([
      { model: 'fake', outcome: 'error', kind: 'policy.fallback' },
      { model: 'google/gemini-3.8-flash', outcome: 'ok', kind: 'fallback' },
    ])
    // The title was answered, so nothing is kept for it. Its art was refused too, with no fallback for art, and that is kept.
    // The art call runs on its own, so its refusal may be kept a moment after the title.
    const refusals = () => db.prepare("SELECT task FROM ai_refusals WHERE key = ? ORDER BY task").all(id).map((row) => (row as { task: string }).task)
    for (let tries = 0; tries < 50 && refusals().length === 0; tries++) await new Promise(resolve => setTimeout(resolve, 100))
    expect(refusals()).toEqual(['topicArt'])
  } finally {
    db.close()
  }
})
