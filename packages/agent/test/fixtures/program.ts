// The agent's durable core as a process for the crash tests. Opens the core
// on a directory (recovery runs), runs the commands, prints its state as JSON
// and closes. The model is the scripted fake; every chat request is answered
// "Reply <n>." unless `hang` makes it wait forever.
//
//   node --import scripts/ts-resolve-hooks.mjs program.ts <dir> [command...]
//
// Commands: send:<op>:<text>  idle  pause  resume  off  rotate  hang
//           authorize:<intent>  attempt  compact  killWhenRunning:<op>  hold
import { fakeProvider, reply } from '@juno/agent-testing'
import { openCore } from '../../src/runtime/core'
import { authorize, outcomes, recordAttempt } from '../../src/store/ledger'
import { ops } from '../../src/inbox/inbox'
import { incarnations } from '../../src/recovery/incarnations'
import { readyKeys, runJob, view } from '../../src/store/memory'

const [dir, ...commands] = process.argv.slice(2)
if (dir === undefined) throw new Error('usage: program.ts <dir> [command...]')

const fake = fakeProvider()
let hang = commands.includes('hang')
let replies = 0
fake.script(
  Array.from({ length: 64 }, () =>
    reply(() => (hang ? new Promise<never>(() => {}) : Promise.resolve(answer(`Reply ${++replies}.`)))),
  ),
)
// The fake's `reply` builds the message itself for a plain string; a factory must return one.
function answer(text: string) {
  return { role: 'assistant', content: [{ type: 'text', text }], api: 'faux', provider: 'openrouter', model: 'anthropic/claude-sonnet-5.5',
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'stop', timestamp: Date.now() } as never
}

const core = await openCore({
  agentDir: dir,
  models: fake.models,
  model: { provider: 'openrouter', modelId: 'anthropic/claude-sonnet-5.5' },
})
if (core._tag === 'updateNeeded') {
  console.log(JSON.stringify({ state: 'updateNeeded' }))
  await core.close()
  process.exit(0)
}

let lastAuthorization: string | undefined
const results: unknown[] = []
for (const command of commands) {
  const [name, ...rest] = command.split(':')
  switch (name) {
    case 'send': {
      const [opId, ...text] = rest
      results.push(core.accept({ opId: opId!, kind: 'send', text: text.join(':') })._tag)
      break
    }
    case 'idle': await core.idle(); break
    case 'pause': core.setMode('paused'); break
    case 'resume': core.setMode('on'); break
    case 'off': core.setMode('off'); break
    case 'rotate': await core.rotate(); break
    case 'hang': hang = true; break
    case 'authorize': {
      const result = authorize(core.store, { intentId: rest[0]!, approvalId: 'approval-1' })
      if (result._tag === 'authorized') lastAuthorization = result.id
      results.push(result._tag === 'authorized' ? 'authorized' : result.reason)
      break
    }
    case 'attempt': {
      const id = lastAuthorization ?? outcomes(core.store).at(-1)?.id
      results.push(id === undefined ? 'none' : recordAttempt(core.store, id) === undefined ? 'refused' : 'sent')
      break
    }
    case 'compact': {
      // The compaction model through pi-ai, as WP11's compactor will call it.
      const haiku = fake.model('anthropic/claude-haiku-5.5')
      const model = {
        id: haiku.id,
        summarize: async (task: ReadonlyArray<string>) => {
          const message = await fake.models.completeSimple(haiku, { messages: [{ role: 'user', content: task.join('\n'), timestamp: 0 }] })
          return message.content.map((part) => (part.type === 'text' ? part.text : '')).join('')
        },
      }
      for (;;) {
        const keys = readyKeys(core.store, { now: Date.now(), active: [], h: undefined })
        if (keys.length === 0) break
        await Promise.all(keys.map((key) => runJob(core.store, key, model)))
      }
      break
    }
    case 'killWhenRunning': {
      // Kill -9 once the op's run is under way: submitted, and its input projected.
      for (;;) {
        const op = ops(core.store).find((o) => o.opId === rest[0])
        const projected = core.store.db.prepare('SELECT 1 FROM messages WHERE origin_op = ?').get(rest[0]!)
        if (op?.state === 'submitted' && projected) process.kill(process.pid, 'SIGKILL')
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
    }
    case 'hold': {
      // A pending promise alone does not keep Node running; a timer does.
      setInterval(() => {}, 1000)
      console.log('HOLDING')
      await new Promise(() => {})
      break
    }
    default: throw new Error(`unknown command ${command}`)
  }
}

const memory = view(core.store)
const summary = {
  state: 'running',
  opened: core.opened,
  mode: core.mode(),
  results,
  incarnation: core.incarnation(),
  incarnations: incarnations(core.store),
  inbox: ops(core.store).map((op) => ({ opId: op.opId, state: op.state, ...(op.reason ? { reason: op.reason } : {}) })),
  messages: core.store.db.prepare('SELECT id, kind, text, origin_op AS origin, incarnation FROM messages ORDER BY id').all(),
  authorizations: outcomes(core.store).map((row) => row.outcome),
  memory: { rev: memory.rev, covered: memory.covered, lines: memory.lines.length, queued: (core.store.db.prepare('SELECT count(*) AS n FROM queue').get() as { n: number }).n },
  chatRequests: fake.requests.filter((r) => r.model === 'anthropic/claude-sonnet-5.5').length,
  compactionRequests: fake.requests.filter((r) => r.model === 'anthropic/claude-haiku-5.5').length,
}
await core.close()
console.log(JSON.stringify(summary))
