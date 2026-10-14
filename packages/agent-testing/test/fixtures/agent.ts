// A stand-in agent for the crash harness test: an inbox in agent.sqlite and a
// journal in pi-1.sqlite, both at synchronous=FULL, with the crash points of
// the inbox and bridge between their commits. Prints its state as JSON.
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { crashPoint } from '../../src/crash/points.ts'

const dir = process.argv[2]!
const open = (name: string) => {
  const db = new DatabaseSync(join(dir, name))
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL')
  return db
}
const agent = open('agent.sqlite')
const journal = open('pi-1.sqlite')
agent.exec('CREATE TABLE IF NOT EXISTS inbox (op TEXT PRIMARY KEY, state TEXT); CREATE TABLE IF NOT EXISTS cursor (pos INTEGER)')
journal.exec('CREATE TABLE IF NOT EXISTS entries (seq INTEGER PRIMARY KEY, op TEXT UNIQUE)')
if (!agent.prepare('SELECT 1 FROM cursor').get()) agent.exec('INSERT INTO cursor VALUES (0)')

const last = () => Number((journal.prepare('SELECT coalesce(max(seq), 0) AS n FROM entries').get() as { n: number }).n)
const cursor = () => Number((agent.prepare('SELECT pos FROM cursor').get() as { pos: number }).pos)
// §3 step 4: a journal behind the archive cursor is a rollback.
const rollback = last() < cursor()

for (const op of process.argv.slice(3)) {
  agent.prepare("INSERT OR IGNORE INTO inbox VALUES (?, 'accepted')").run(op)
  crashPoint('inbox.committed')
  crashPoint('bridge.reset')
  journal.prepare('INSERT OR IGNORE INTO entries (op) VALUES (?)').run(op)
  crashPoint('bridge.submitted')
  agent.prepare("UPDATE inbox SET state = 'submitted' WHERE op = ?").run(op)
  agent.prepare('UPDATE cursor SET pos = ?').run(last())
}
const inbox = agent.prepare('SELECT op, state FROM inbox ORDER BY op').all()
console.log(JSON.stringify({ inbox, journal: last(), cursor: cursor(), rollback }))
