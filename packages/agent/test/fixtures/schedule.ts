import { join } from 'node:path'
import { openDatabase } from '../../src/store/database'
import { initialize } from '../../src/store/store'
import { ACTIONS_MIGRATIONS } from '../../src/actions/schema'
import { SCHEDULE_MIGRATIONS } from '../../src/schedule/schema'
import { createScheduler } from '../../src/schedule/scheduler'
const [dir, phase] = process.argv.slice(2)
if (dir === undefined) throw new Error('Missing test directory')
const db = openDatabase(join(dir, 'agent.sqlite'), [ACTIONS_MIGRATIONS, SCHEDULE_MIGRATIONS])
const store = { db, now: () => 1000 }
initialize(store)
const scheduler = createScheduler({ store, changed: () => {}, replies: async () => ({ owner: 'owner', messages: [] }) })
scheduler.create({ key: 'owner-click', sourceOp: 'owner-click', authority: { _tag: 'menu' }, definition: {
  what: 'Test watch', prompt: 'Check the test conversation.', schedule: { _tag: 'once', at: 1000 }, deliver: 'now',
} })
scheduler.queue()
if (phase === 'queued') process.kill(process.pid, 'SIGKILL')
await scheduler.tick()
if (phase === 'admitted') process.kill(process.pid, 'SIGKILL')
const occurrence = scheduler.occurrences()[0]
if (occurrence === undefined) throw new Error('Missing occurrence')
const started = scheduler.start(occurrence.op_id, () => {
  db.prepare("INSERT INTO schedule_test_runs (op_id) VALUES (?)").run(occurrence.op_id)
})
process.stdout.write(JSON.stringify({ started, occurrences: scheduler.occurrences().length, runs: db.prepare('SELECT * FROM schedule_test_runs').all().length }))
db.close()
