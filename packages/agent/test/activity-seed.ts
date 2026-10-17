import type { Database } from '../src/store/database'

/** `count` finished runs, each with its message, six steps and twelve sources, as the Activity page reads them. */
export function seedRuns(db: Database, count: number): void {
  const run = db.prepare("INSERT INTO runs (id, op_id, origin, h, clean, started_at, ended_at, ending) VALUES (?, ?, 'owner', 0, 0, ?, ?, '{\"_tag\":\"complete\"}')")
  const op = db.prepare("INSERT INTO inbox (op_id, kind, text, at, state) VALUES (?, 'send', ?, ?, 'done')")
  const step = db.prepare("INSERT INTO run_steps (run_id, call_id, seq, tool, args, outcome, detail, started_at, ended_at) VALUES (?, ?, ?, ?, ?, 'done', ?, ?, ?)")
  const source = db.prepare("INSERT INTO sources (run_id, handle, channel_id, ts, place) VALUES (?, ?, 'C_ENG', ?, '#eng')")
  db.exec('BEGIN')
  for (let n = 0; n < count; n++) {
    const id = `run-${String(n).padStart(4, '0')}`
    op.run(`op-${n}`, `question ${n} about the rollout plan and who reviews it`, n * 60_000)
    run.run(id, `op-${n}`, n * 60_000, n * 60_000 + 5_000)
    for (let s = 0; s < 6; s++) step.run(id, `c${s}`, s, s % 2 === 0 ? 'slack_history' : 'slack_search', JSON.stringify({ channel: 'C_ENG', query: 'rollout plan review owner' }), '12 messages', n * 60_000, n * 60_000)
    for (let m = 0; m < 12; m++) source.run(id, `m${m + 1}`, `1760400000.${String(m).padStart(6, '0')}`)
  }
  db.exec('COMMIT')
}
