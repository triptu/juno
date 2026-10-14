// The cost of the core's own commits in agent.sqlite: an inbox accept, and a
// projection commit of one message (row, memory keys, cursor). Variants with
// fullfsync on (shipped) and off, interleaved in rounds; minimums and medians.
//
//   node scripts/heavy.mjs node --import ./scripts/ts-resolve-hooks.mjs packages/agent/bench/commit-cost.ts
//   ELECTRON_RUN_AS_NODE=1 apps/desktop/node_modules/.bin/electron --import ./scripts/ts-resolve-hooks.mjs packages/agent/bench/commit-cost.ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { accept } from '../src/inbox/inbox'
import { projectCommit } from '../src/projection/projector'
import { ensureIncarnation } from '../src/recovery/incarnations'
import { openDatabase } from '../src/store/database'
import { initialize, type Store } from '../src/store/store'

const ROUNDS = 5
const PER_ROUND = 100
const dir = mkdtempSync(join(tmpdir(), 'juno-commit-cost-'))

function open(name: string, fullfsync: boolean) {
  const db = openDatabase(join(dir, name))
  if (!fullfsync) db.exec('PRAGMA fullfsync = OFF; PRAGMA checkpoint_fullfsync = OFF')
  const store: Store = { db, now: Date.now }
  initialize(store)
  return { store, incarnation: ensureIncarnation(store), seq: 0, op: 0 }
}

const variants = { on: open('on.sqlite', true), off: open('off.sqlite', false) }
const samples: Record<string, number[]> = { 'accept on': [], 'accept off': [], 'project on': [], 'project off': [] }
const text = 'x'.repeat(400)
for (let round = 0; round < ROUNDS; round++) {
  for (const [name, v] of Object.entries(variants)) {
    let start = performance.now()
    for (let i = 0; i < PER_ROUND; i++) accept(v.store, { opId: `op-${v.op++}`, kind: 'send', text })
    samples[`accept ${name}`]!.push((performance.now() - start) / PER_ROUND)
    start = performance.now()
    for (let i = 0; i < PER_ROUND; i++) {
      v.seq += 2
      projectCommit(v.store, v.incarnation, { seq: v.seq, entries: [{ id: v.seq, kind: 'pi.assistant', model: [{ role: 'assistant', content: [{ type: 'text', text }] }] }] })
    }
    samples[`project ${name}`]!.push((performance.now() - start) / PER_ROUND)
  }
}
const sorted = (xs: number[]) => xs.toSorted((a, b) => a - b)
console.log(`node ${process.versions.node}, ${ROUNDS} rounds of ${PER_ROUND} commits, ms per commit`)
for (const [name, xs] of Object.entries(samples)) console.log(`${name.padEnd(12)} min ${sorted(xs)[0]!.toFixed(3)}  median ${sorted(xs)[Math.floor(xs.length / 2)]!.toFixed(3)}`)
for (const v of Object.values(variants)) v.store.db.close()
rmSync(dir, { recursive: true, force: true })
