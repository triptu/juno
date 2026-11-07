import { testDurability } from '@juno/agent-testing'
// The turn engine with cards as a process, for the action crash tests. Opens the engine on a directory
// (recovery runs) with the fake host, whose record and Slack messages persist in `<dir>/slack.json`,
// runs the commands, prints the ledger as JSON and closes. The scripted model proposes a Send message
// card when the last message is the owner's, and answers "Drafted." after the tool result.
//
//   bun actions.ts <dir> [command...]
//
// Commands: send:<op>:<text>  change:<call>  click:<op>  idle
//
// `change` proposes a Change card on a fake connection whose write always lands and is always found
// by reconcile, as a Notion page update is.
import { join } from 'node:path'
import { fakeActionHost, fakeProvider, reply, TEST_CHANNEL } from '@juno/agent-testing'
import type { CardPayload } from '@juno/agent-cards'
import { createProviderGuard, openTurns, type Executor } from '../../src/index'

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
const fakeWrite: Executor = {
  tool: 'fake_write', tier: 3, deduped: false,
  run: async () => ({ _tag: 'done', receipt: { confirmed: true } }),
  reconcile: async () => ({ _tag: 'found', receipt: { confirmed: true } }),
}
const change = {
  _tag: 'change', server: 'Notion', target: 'Roadmap',
  action: {
    id: '0199f0a0-0000-7000-8000-000000000003', rev: 1, tier: 3, deduped: false, source: 0,
    payload: { connection_id: 'notion', account_id: 'acct', destination_ids: [], tool: 'fake_write', schema_hash: '0'.repeat(64), args: { title: 'Q4' }, preconditions: {}, ops: [] },
  },
} as unknown as CardPayload
const turns = await openTurns({
  durability: testDurability,
  agentDir: dir,
  provider: (store) => createProviderGuard({ store, transport: fake.models }),
  model: { provider: 'openrouter', modelId: 'anthropic/claude-sonnet-5.5' },
  actions: { host: slack.host, executors: [fakeWrite] },
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
    case 'change':
      turns.actions.propose({ runId: 'run-fixture', callId: rest[0]!, payload: change })
      break
    case 'click': {
      const open = turns.actions.views().find((view) => view.binding !== undefined)
      if (open?.binding === undefined) throw new Error('no open card')
      turns.actions.approve(rest[0]!, open.binding.identity, open.binding.children)
      break
    }
    case 'idle':
      // Reconcile and a click's dispatch may start a run; a run may propose a card.
      await turns.actions.idle()
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
  inbox: turns.store.db.prepare('SELECT op_id AS opId, state FROM inbox ORDER BY seq').all(),
  /** The card outcomes the model was told in this process, each once (a run's later requests repeat its inputs). */
  told: [...new Set(fake.requests.flatMap((request) => request.context.messages).flatMap((message) => {
    const content = (message as { content?: unknown }).content
    const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map((part: { text?: string }) => part.text ?? '').join('') : ''
    return text.match(/<card-outcome [^>]*>/g) ?? []
  }))],
}
await turns.close()
console.log(JSON.stringify(summary))
