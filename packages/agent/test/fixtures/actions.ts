// The turn engine with cards as a process, for the action crash tests. Opens the engine on a directory
// (recovery runs) with the fake host, whose record and Slack messages persist in `<dir>/slack.json`,
// runs the commands, prints the ledger as JSON and closes. The scripted model proposes a Send message
// card when the last message is the owner's, and answers "Drafted." after the tool result.
//
//   node --import scripts/ts-resolve-hooks.mjs actions.ts <dir> [command...]
//
// Commands: send:<op>:<text>  click:<op>  idle
import { join } from 'node:path'
import { fakeActionHost, fakeProvider, reply, TEST_CHANNEL } from '@juno/agent-testing'
import { createProviderGuard, openTurns } from '../../src/index'

const [dir, ...commands] = process.argv.slice(2)
if (dir === undefined) throw new Error('usage: actions.ts <dir> [command...]')

const fake = fakeProvider()
const message = (content: unknown, stopReason: 'stop' | 'toolUse') => ({
  role: 'assistant', content, api: 'faux', provider: 'openrouter', model: 'anthropic/claude-sonnet-5.5',
  usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  stopReason, timestamp: Date.now(),
}) as never
fake.script(Array.from({ length: 8 }, () => reply((context) => {
  const last = context.messages.at(-1)
  if (last?.role !== 'toolResult') {
    return message([{ type: 'toolCall', id: `call-${Date.now()}`, name: 'send_message', arguments: { messages: [{ topic: `m:${TEST_CHANNEL}`, text: 'On my way.' }] } }], 'toolUse')
  }
  return message([{ type: 'text', text: '<say>Drafted.</say>' }], 'stop')
})))

const slack = fakeActionHost({ file: join(dir, 'slack.json') })
const turns = await openTurns({
  agentDir: dir,
  provider: (store) => createProviderGuard({ store, transport: fake.models }),
  model: { provider: 'openrouter', modelId: 'anthropic/claude-sonnet-5.5' },
  actions: { host: slack.host },
})
if (turns._tag === 'updateNeeded') throw new Error('update needed')

for (const command of commands) {
  const [name, ...rest] = command.split(':')
  switch (name) {
    case 'send': {
      const [opId, ...text] = rest
      turns.accept({ opId: opId!, kind: 'send', text: text.join(':') })
      break
    }
    case 'click': {
      const open = turns.actions.views().find((view) => view.binding !== undefined)
      if (open?.binding === undefined) throw new Error('no open card')
      turns.actions.approve(rest[0]!, open.binding.identity, open.binding.children)
      break
    }
    case 'idle':
      await turns.idle()
      await turns.actions.idle()
      break
    default:
      throw new Error(`unknown command ${command}`)
  }
}

const summary = {
  opened: turns.opened,
  cards: turns.actions.views().map((view) => ('status' in view.card ? view.card.status : undefined)),
  authorizations: turns.store.db.prepare('SELECT outcome FROM authorizations').all(),
  attempts: (turns.store.db.prepare('SELECT count(*) AS n FROM attempts').get() as { n: number }).n,
  sends: slack.calls.length,
  slack: slack.messages().map((m) => m.text),
}
await turns.close()
console.log(JSON.stringify(summary))
