// Runs on Node: Bun's node:sqlite on macOS cannot open its SQLite files (docs/development.md, "Runtimes").
// The cost of the core's own commits in agent.sqlite: an inbox accept, a
// projection commit of one message (row, memory keys, cursor), and clearing
// one message's text as a removal does (a 400-byte row, and a 16 KB row on
// overflow pages). Variants: shipped (fullfsync and secure_delete on), without
// secure_delete, without fullfsync, and without either (the last two show
// secure_delete's own cost, which the fsync hides), interleaved in rounds;
// minimums and medians.
//
//   bun scripts/heavy.mjs node --import ./scripts/ts-resolve-hooks.mjs packages/agent/bench/commit-cost.ts
//   ELECTRON_RUN_AS_NODE=1 apps/desktop/node_modules/.bin/electron --import ./scripts/ts-resolve-hooks.mjs packages/agent/bench/commit-cost.ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { accept } from '../src/inbox/inbox'
import { projectCommit } from '../src/projection/projector'
import { ensureIncarnation } from '../src/recovery/incarnations'
import { openDatabase, transaction } from '../src/store/database'
import { initialize, type Store } from '../src/store/store'

const ROUNDS = 5
const PER_ROUND = 100
const dir = mkdtempSync(join(tmpdir(), 'juno-commit-cost-'))

function open(name: string, options: { readonly fullfsync: boolean; readonly secureDelete: boolean }) {
  const db = openDatabase(join(dir, name))
  if (!options.fullfsync) db.exec('PRAGMA fullfsync = OFF; PRAGMA checkpoint_fullfsync = OFF')
  if (!options.secureDelete) db.exec('PRAGMA secure_delete = OFF')
  const store: Store = { db, now: Date.now }
  initialize(store)
  return { store, incarnation: ensureIncarnation(store), seq: 0, op: 0 }
}

const variants = {
  shipped: open('shipped.sqlite', { fullfsync: true, secureDelete: true }),
  'no secure_delete': open('plain.sqlite', { fullfsync: true, secureDelete: false }),
  'no fullfsync': open('nofsync.sqlite', { fullfsync: false, secureDelete: true }),
  'no fullfsync, no secure_delete': open('neither.sqlite', { fullfsync: false, secureDelete: false }),
}
const samples: Record<string, number[]> = {}
const sample = (name: string, ms: number) => (samples[name] ??= []).push(ms)
const text = 'x'.repeat(400)
const big = 'y'.repeat(16_000)
for (let round = 0; round < ROUNDS; round++) {
  for (const [name, v] of Object.entries(variants)) {
    let start = performance.now()
    for (let i = 0; i < PER_ROUND; i++) accept(v.store, { opId: `op-${v.op++}`, kind: 'send', text })
    sample(`accept, ${name}`, (performance.now() - start) / PER_ROUND)
    const first = (v.store.db.prepare('SELECT count(*) AS n FROM messages').get() as { n: number }).n
    for (const [label, body] of [['project', text], ['project 16 KB', big]] as const) {
      start = performance.now()
      for (let i = 0; i < PER_ROUND; i++) {
        v.seq += 2
        projectCommit(v.store, v.incarnation, { seq: v.seq, entries: [{ id: v.seq, kind: 'pi.assistant', model: [{ role: 'assistant', content: [{ type: 'text', text: body }] }] }] })
      }
      sample(`${label}, ${name}`, (performance.now() - start) / PER_ROUND)
    }
    // Clear what this round projected, one commit per message, as a removal tombstones it.
    const ids = (v.store.db.prepare("SELECT id, bytes FROM messages WHERE id >= ? AND text != '' ORDER BY id").all(first) as Array<{ id: number; bytes: number }>)
    for (const [label, small] of [['clear', true], ['clear 16 KB', false]] as const) {
      const rows = ids.filter((row) => (row.bytes <= 400) === small).slice(0, PER_ROUND)
      start = performance.now()
      for (const row of rows) transaction(v.store.db, () => v.store.db.prepare("UPDATE messages SET text = '', bytes = 0 WHERE id = ?").run(row.id))
      sample(`${label}, ${name}`, (performance.now() - start) / rows.length)
    }
  }
}
const sorted = (xs: number[]) => xs.toSorted((a, b) => a - b)
console.log(`node ${process.versions.node}, ${ROUNDS} rounds of ${PER_ROUND} commits, ms per commit`)
for (const [name, xs] of Object.entries(samples).toSorted(([a], [b]) => a.localeCompare(b))) console.log(`${name.padEnd(46)} min ${sorted(xs)[0]!.toFixed(3)}  median ${sorted(xs)[Math.floor(xs.length / 2)]!.toFixed(3)}`)
for (const v of Object.values(variants)) v.store.db.close()
rmSync(dir, { recursive: true, force: true })
