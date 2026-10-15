import { openDatabase, transaction } from '../../src/store/database'
import { initialize } from '../../src/store/store'
import { TURNS_MIGRATIONS } from '../../src/router/schema'
import { JOBS_MIGRATIONS } from '../../src/jobs/schema'
import { CHAT_MIGRATIONS } from '../../src/serve/schema'
import type { ChatSource } from '../../src/serve/chat'

export function chatFixture(count: number) {
  const db = openDatabase(':memory:', [TURNS_MIGRATIONS, JOBS_MIGRATIONS, CHAT_MIGRATIONS])
  const store = { db, now: () => 1_800_000_000_000 }
  initialize(store)
  db.prepare("INSERT INTO incarnations (id, created_at) VALUES ('fixture', 0)").run()
  const op = db.prepare("INSERT INTO inbox (op_id, kind, text, at, state) VALUES (?, 'send', ?, ?, 'done')")
  const run = db.prepare("INSERT INTO runs (id, op_id, origin, h, clean, started_at, ended_at, ending) VALUES (?, ?, 'owner', 0, 1, ?, ?, '{\"_tag\":\"complete\"}')")
  const input = db.prepare('INSERT INTO run_inputs VALUES (?, ?, 0)')
  const message = db.prepare("INSERT INTO messages (id, kind, text, bytes, at, origin_op, incarnation, source_pos, entry_id, chunk) VALUES (?, ?, ?, ?, ?, ?, 'fixture', ?, ?, 0)")
  const seen = db.prepare('INSERT INTO chat_bubbles VALUES (?, ?)')
  transaction(db, () => {
    for (let n = 0; n < count / 2; n++) {
      const at = store.now() + n * 1000
      op.run(`op-${n}`, `Question ${n}`, at)
      run.run(`run-${n}`, `op-${n}`, at, at + 1)
      input.run(`op-${n}`, `run-${n}`)
      message.run(n * 2, 'user', `Question ${n}`, 20, at, `op-${n}`, n * 2, n * 2)
      message.run(n * 2 + 1, 'juno', `<say>Answer ${n}</say>`, 30, at + 1, `op-${n}`, n * 2 + 1, n * 2 + 1)
      seen.run(`run-${n}:0`, at + 1)
    }
  })
  const source: ChatSource = { store, live: undefined, seen: (id, fallback) => Number(db.prepare('SELECT at FROM chat_bubbles WHERE id = ?').get(id)?.at ?? fallback), jobs: [], cards: [], readAt: 0, waiting: undefined, dayOf: (at) => Math.floor(at / 86_400_000) * 86_400_000 }
  return { source, close: () => db.close() }
}
