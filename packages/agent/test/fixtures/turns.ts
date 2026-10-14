// The turn engine as a process for the crash tests. Opens the engine on a directory (recovery
// runs), runs the commands, prints its state as JSON and closes. The model is the scripted fake:
// a request whose last message is the owner's answers with a call to `slack_search`; a request
// after a tool result answers "Found it.", or, with `killInAnswer`, kills the process first.
//
//   node --import scripts/ts-resolve-hooks.mjs turns.ts <dir> [command...]
//
// Commands: send:<op>:<text>  idle  killInAnswer
import { fakeProvider, reply } from '@juno/agent-testing'
import { createProviderGuard, openTurns, type HostReads, type TurnEvent } from '../../src/index'

const [dir, ...commands] = process.argv.slice(2)
if (dir === undefined) throw new Error('usage: turns.ts <dir> [command...]')

const fake = fakeProvider()
const message = (content: unknown, stopReason: 'stop' | 'toolUse') => ({
  role: 'assistant', content, api: 'faux', provider: 'openrouter', model: 'anthropic/claude-sonnet-5.5',
  usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  stopReason, timestamp: Date.now(),
}) as never
fake.script(Array.from({ length: 16 }, () => reply((context) => {
  const last = context.messages.at(-1)
  if (last?.role !== 'toolResult') return message([{ type: 'toolCall', id: `call-${Date.now()}`, name: 'slack_search', arguments: { query: 'lunch' } }], 'toolUse')
  if (commands.includes('killInAnswer')) process.kill(process.pid, 'SIGKILL')
  return message([{ type: 'text', text: 'Found it.' }], 'stop')
})))

let searches = 0
const page = { messages: [] as never[] }
const host: HostReads = {
  search: async () => (searches++, page),
  history: async () => page,
  replies: async () => page,
  topics: async () => ({ topics: [] }),
  person: async (id) => ({ id, name: 'maya', displayName: 'Maya' }),
}

const events: TurnEvent[] = []
const turns = await openTurns({
  agentDir: dir,
  provider: (store) => createProviderGuard({ store, transport: fake.models }),
  model: { provider: 'openrouter', modelId: 'anthropic/claude-sonnet-5.5' },
  host,
})
if (turns._tag === 'updateNeeded') {
  console.log(JSON.stringify({ state: 'updateNeeded' }))
  await turns.close()
  process.exit(0)
}
turns.subscribe((event) => events.push(event))

const sent: string[] = []
for (const command of commands) {
  const [name, ...rest] = command.split(':')
  switch (name) {
    case 'send': {
      const [opId, ...text] = rest
      turns.accept({ opId: opId!, kind: 'send', text: text.join(':') })
      sent.push(opId!)
      break
    }
    case 'idle': await turns.idle(); break
    case 'killInAnswer': break
    default: throw new Error(`unknown command ${command}`)
  }
}

const summary = {
  opened: turns.opened,
  ops: Object.fromEntries(sent.map((opId) => [opId, turns.op(opId)?.state])),
  messages: turns.messages().map((m) => [m.kind, m.text]),
  endings: events.flatMap((e) => (e._tag === 'ended' ? [e.ending] : [])),
  searches,
  chatRequests: fake.requests.length,
}
await turns.close()
console.log(JSON.stringify(summary))
