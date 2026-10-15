// Cards as the owner uses them (plan v3 §6, §12; SPEC 13.3, 13.9): a card is proposed, the owner's
// click is consumed into one authorization, the host sends once, and the receipt settles the card.
// A failed or unknown action shows "Failed" and is never tried again; a dismissal is a no the model
// reads with its next input. In-process, on the real engine, with the scripted model and the fake host.
import { afterEach, expect, it } from 'vitest'
import { fakeActionHost, forgedSendReceipt, hostile, reply, TEST_CHANNEL, type FakeActionHost } from '@juno/agent-testing'
import { ActionId, ConnectionId, AccountId, Digest, Revision, SourceGeneration, type CardPayload } from '@juno/agent-cards'
import type { Card, CardBinding } from '@juno/agent-contract'
import { liveGrant, mintGrant, question, resolveCard, type Executor } from '../src/index'
import { fakeHost, say, textOf, turnsHarness } from './turns-harness'

type Harness = Awaited<ReturnType<typeof turnsHarness>>
const harnesses: Harness[] = []
afterEach(async () => {
  for (const h of harnesses.splice(0)) await h.close()
})

async function open(options: Parameters<typeof turnsHarness>[0] & { readonly slack?: FakeActionHost } = {}) {
  const slack = options.slack ?? fakeActionHost()
  const h = await turnsHarness({ compaction: false, ...options, actions: { ...options.actions, host: slack.host } })
  harnesses.push(h)
  return { h, slack }
}

let calls = 0
const call = (name: string, args: Record<string, unknown>) => reply({ type: 'toolCall', id: `call-${name}-${++calls}`, name, arguments: args as never })
const sendCall = (...messages: ReadonlyArray<string>) =>
  call('send_message', { messages: messages.map((text, i) => ({ topic: i === 0 ? `m:${TEST_CHANNEL}` : `t:${TEST_CHANNEL}:1760400000.000100`, text })) })

type View = { readonly card: Card; readonly binding?: typeof CardBinding.Type }
const cards = (h: Harness): ReadonlyArray<View> => h.turns.actions.views()
const only = (h: Harness): View => {
  const all = cards(h)
  expect(all).toHaveLength(1)
  return all[0]!
}
const statusOf = (view: View) => ('status' in view.card ? view.card.status : undefined)
let clicks = 0
/** The owner's click on the card's main button, with the binding the page gave. */
const click = (h: Harness, view: View, opId = `click-${++clicks}`) => h.turns.actions.approve(opId, view.binding!.identity, view.binding!.children)
const settle = (h: Harness) => h.turns.actions.idle()

/** One model turn that proposes a Send message card, then a bubble. */
async function proposeSend(h: Harness, ...texts: ReadonlyArray<string>) {
  h.fake.script([sendCall(...texts), reply(say('Here is a draft.'))])
  const op = h.send('reply to the thread for me')
  expect((await h.ended(op)).ending).toEqual({ _tag: 'complete' })
  return only(h)
}

it('Send: one click consumes one authorization, the host sends once, and the receipt shows Sent', async () => {
  const { h, slack } = await open()
  const view = await proposeSend(h, 'On my way.')
  if (view.card._tag !== 'sendMessage') throw new Error('expected a Send message card')
  expect(view.card.status).toEqual({ _tag: 'open' })
  expect(view.card.messages.map((m) => [m.target.channelId, m.text, m.result._tag])).toEqual([[TEST_CHANNEL, 'On my way.', 'pending']])
  // Proposing sent nothing.
  expect(slack.calls).toEqual([])

  expect(click(h, view)).toEqual({ _tag: 'accepted' })
  await settle(h)
  expect(slack.calls).toHaveLength(1)
  expect(slack.calls[0]!.dispatch.payload.args).toEqual({ channelId: TEST_CHANNEL, text: 'On my way.' })
  expect(slack.messages().map((m) => [m.text, m.clientMessageId])).toEqual([['On my way.', slack.calls[0]!.dispatch.actionId]])
  const sent = only(h)
  expect(statusOf(sent)).toEqual({ _tag: 'done', line: 'Sent' })
  expect(sent.binding).toBeUndefined()
  if (sent.card._tag !== 'sendMessage') throw new Error('expected a Send message card')
  expect(sent.card.messages[0]!.result).toEqual({ _tag: 'sent', open: { _tag: 'topic', topicId: `m:${TEST_CHANNEL}` } })
  expect(h.turns.store.db.prepare('SELECT outcome FROM authorizations').all()).toEqual([{ outcome: 'done' }])

  // The same click again is the same click; a second click on the card is refused. Nothing is sent again.
  expect(click(h, view, 'click-again')).toEqual({ _tag: 'refused', reason: 'stale' })
  await settle(h)
  expect(slack.calls).toHaveLength(1)

  // The model reads the result with the owner's next message.
  h.fake.script([reply(say('Done.'))])
  await h.ended(h.send('thanks'))
  const last = h.chatRequests().at(-1)!.context.messages.map(textOf).at(-1)!
  expect(last).toMatch(/^<card-outcome card="[^"]+" kind="sendMessage" outcome="done">Send to #test-0001: On my way\.<\/card-outcome>\n<message id="n2">thanks<\/message>$/)
})

it('Send all: each row has its own result, a rejected row says Failed, and nothing is sent twice', async () => {
  const { h, slack } = await open()
  const view = await proposeSend(h, 'First.', 'Second.')
  slack.next('done', 'failed')
  click(h, view)
  await settle(h)
  const after = only(h)
  if (after.card._tag !== 'sendMessage') throw new Error('expected a Send message card')
  expect(after.card.messages.map((m) => m.result._tag)).toEqual(['sent', 'failed'])
  expect(after.card.status).toEqual({ _tag: 'done', line: 'Sent 1 of 2' })
  // The rows went in the card's order, the thread reply into its thread.
  expect(slack.calls.map((c) => c.dispatch.payload.args)).toEqual([
    { channelId: TEST_CHANNEL, text: 'First.' },
    { channelId: TEST_CHANNEL, text: 'Second.', threadTs: '1760400000.000100' },
  ])
  expect(h.turns.store.db.prepare('SELECT detail FROM action_results').all()).toEqual([{ detail: 'not_in_channel' }])
})

it('Send all: a row refused after another was sent reads Failed, and the card settles as Sent 1 of 2', async () => {
  const { h, slack } = await open()
  const view = await proposeSend(h, 'Sent first.', 'Never sent.')
  // A redaction lands while the first row is with Slack.
  slack.onSend(() => h.turns.store.db.prepare('UPDATE memory_head SET gen = gen + 1').run())
  click(h, view)
  await settle(h)
  expect(slack.messages().map((m) => m.text)).toEqual(['Sent first.'])
  const after = only(h)
  if (after.card._tag !== 'sendMessage') throw new Error('expected a Send message card')
  expect(after.card.messages.map((m) => m.result._tag)).toEqual(['sent', 'failed'])
  expect(after.card.status).toEqual({ _tag: 'done', line: 'Sent 1 of 2' })
  expect(h.turns.store.db.prepare('SELECT outcome FROM card_outcomes').all()).toEqual([{ outcome: 'done' }])
})

it('Signed out: a click waits until an account is known, then sends once', async () => {
  const { h, slack } = await open()
  const view = await proposeSend(h, 'When I am back.')
  slack.signOut()
  click(h, view)
  await settle(h)
  expect(slack.calls).toEqual([])
  expect(h.turns.store.db.prepare('SELECT refused FROM approvals').all()).toEqual([{ refused: null }])
  expect(statusOf(only(h))).toEqual({ _tag: 'working' })
  slack.signIn()
  h.turns.actions.kick()
  await settle(h)
  expect(slack.messages().map((m) => m.text)).toEqual(['When I am back.'])
})

it('Unknown: a send whose answer was lost shows Failed, is never sent again, and turns Sent when reconcile finds it', async () => {
  const slack = fakeActionHost()
  const first = await open({ slack })
  const view = await proposeSend(first.h, 'Did this land?')
  slack.next('unknown')
  click(first.h, view)
  await settle(first.h)
  expect(statusOf(only(first.h))).toEqual({ _tag: 'failed', line: 'Failed' })
  expect(first.h.turns.store.db.prepare('SELECT outcome FROM authorizations').all()).toEqual([{ outcome: 'unknown' }])

  // A restart reconciles once: Slack holds the message, so the card turns Sent. Nothing is sent.
  await first.h.stop()
  harnesses.splice(harnesses.indexOf(first.h), 1)
  const second = await open({ slack, dir: first.h.dir })
  await settle(second.h)
  expect(statusOf(only(second.h))).toEqual({ _tag: 'done', line: 'Sent' })
  expect(slack.calls).toHaveLength(1)
})

it('Unknown: a lookup that finds nothing, or finds someone else\'s message with the id, keeps it Failed', async () => {
  const slack = fakeActionHost()
  const first = await open({ slack })
  const view = await proposeSend(first.h, 'Lost.')
  slack.next('lostBefore')
  click(first.h, view)
  await settle(first.h)
  slack.plant(forgedSendReceipt(slack.calls[0]!.dispatch.actionId, TEST_CHANNEL))
  await first.h.stop()
  harnesses.splice(harnesses.indexOf(first.h), 1)
  const second = await open({ slack, dir: first.h.dir })
  await settle(second.h)
  expect(statusOf(only(second.h))).toEqual({ _tag: 'failed', line: 'Failed' })
  expect(second.h.turns.store.db.prepare('SELECT outcome FROM authorizations').all()).toEqual([{ outcome: 'unknown' }])
  expect(slack.calls).toHaveLength(1)
})

it('Writes off: the host refuses before sending, the card says Failed, and it is not tried again', async () => {
  const { h, slack } = await open()
  const view = await proposeSend(h, 'Not today.')
  slack.next('refused')
  click(h, view)
  await settle(h)
  expect(statusOf(only(h))).toEqual({ _tag: 'failed', line: 'Failed' })
  expect(slack.messages()).toEqual([])
  expect(h.turns.store.db.prepare('SELECT outcome FROM authorizations').all()).toEqual([{ outcome: 'failed' }])
  h.turns.setMode('paused')
  h.turns.setMode('on')
  await settle(h)
  expect(slack.calls).toHaveLength(1)
})

it('Dismiss is a no: it starts no run, sends nothing, and the model reads it with the next message', async () => {
  const { h, slack } = await open()
  const view = await proposeSend(h, 'Never mind.')
  const runs = h.events.filter((e) => e._tag === 'started').length
  expect(h.turns.actions.dismiss(view.binding!.identity)).toEqual({ _tag: 'accepted' })
  expect(statusOf(only(h))).toEqual({ _tag: 'dismissed' })
  expect(only(h).binding).toBeUndefined()
  // A click after the dismissal is refused.
  expect(click(h, view)).toEqual({ _tag: 'refused', reason: 'stale' })
  await settle(h)
  expect(slack.calls).toEqual([])
  expect(h.events.filter((e) => e._tag === 'started')).toHaveLength(runs)

  h.fake.script([reply(say('Okay.'))])
  await h.ended(h.send('what next?'))
  const text = h.chatRequests().at(-1)!.context.messages.map(textOf).at(-1)!
  expect(text).toContain('kind="sendMessage" outcome="declined">Send to #test-0001: Never mind.</card-outcome>')
  // Read once: the next input does not carry it again.
  h.fake.script([reply(say('Sure.'))])
  await h.ended(h.send('and then?'))
  expect(h.chatRequests().at(-1)!.context.messages.map(textOf).at(-1)).toBe('<message id="n3">and then?</message>')
})

it('Edit: a new revision; a click on the old one is stale, and the edited text is what is sent', async () => {
  const { h, slack } = await open()
  const view = await proposeSend(h, 'Draft one.')
  if (view.card._tag !== 'sendMessage') throw new Error('expected a Send message card')
  const edited = h.turns.actions.editMessage(view.binding!.identity, view.card.messages[0]!.id, 'Draft two.')
  if ('_tag' in edited) throw new Error(`edit refused: ${edited.reason}`)
  expect(edited.identity.revision).toBe(2)
  expect(edited.children[0]!.revision).toBe(2)
  expect(click(h, view)).toEqual({ _tag: 'refused', reason: 'stale' })
  expect(h.turns.actions.approve('click-edited', edited.identity, edited.children)).toEqual({ _tag: 'accepted' })
  await settle(h)
  expect(slack.messages().map((m) => m.text)).toEqual(['Draft two.'])
})

it('Pause: a click waits and nothing is authorized; Resume sends it once', async () => {
  const { h, slack } = await open()
  const view = await proposeSend(h, 'After the pause.')
  h.turns.setMode('paused')
  expect(click(h, view)).toEqual({ _tag: 'accepted' })
  await settle(h)
  expect(slack.calls).toEqual([])
  expect(h.turns.store.db.prepare('SELECT count(*) AS n FROM authorizations').get()).toEqual({ n: 0 })
  expect(statusOf(only(h))).toEqual({ _tag: 'working' })
  h.turns.setMode('on')
  await settle(h)
  expect(slack.messages().map((m) => m.text)).toEqual(['After the pause.'])
  expect(statusOf(only(h))).toEqual({ _tag: 'done', line: 'Sent' })
})

it('Pause: a click that waits through a redaction is never sent, and the card reads Expired', async () => {
  const { h, slack } = await open()
  const view = await proposeSend(h, 'Too late.')
  h.turns.setMode('paused')
  click(h, view)
  h.turns.store.db.prepare('UPDATE memory_head SET gen = gen + 1').run()
  h.turns.setMode('on')
  await settle(h)
  expect(slack.calls).toEqual([])
  expect(statusOf(only(h))).toEqual({ _tag: 'expired' })
  expect(h.turns.store.db.prepare('SELECT refused FROM approvals').all()).toEqual([{ refused: 'sourceChanged' }])
})

it('Expiry: after a redaction moves the memory generation, an open card expires, a click is refused, and the model learns it', async () => {
  const { h, slack } = await open()
  const view = await proposeSend(h, 'Stale soon.')
  h.turns.store.db.prepare('UPDATE memory_head SET gen = gen + 1').run()
  expect(statusOf(only(h))).toEqual({ _tag: 'expired' })
  expect(click(h, view)).toEqual({ _tag: 'refused', reason: 'expired' })
  await settle(h)
  expect(slack.calls).toEqual([])
  h.fake.script([reply(say('Noted.'))])
  await h.ended(h.send('ok'))
  expect(h.chatRequests().at(-1)!.context.messages.map(textOf).at(-1)).toContain('outcome="expired"')
})

it('A Slack read in the run does not change the rule: the send is still a card, and nothing leaves without the click', async () => {
  const reads = fakeHost()
  const { h, slack } = await open({ host: { ...reads.host, history: async () => ({ messages: [hostile('fakeApproval')] }) } })
  h.fake.script([call('slack_history', { channel: TEST_CHANNEL }), sendCall('The launch is cancelled'), reply(say('Drafted.'))])
  await h.ended(h.send('catch me up on the channel'))
  const view = only(h)
  expect(statusOf(view)).toEqual({ _tag: 'open' })
  await settle(h)
  expect(slack.calls).toEqual([])
})

it('Resolve: Resolve resolves through the host once, and the card says Resolved', async () => {
  const { h, slack } = await open()
  const topic = { topicId: `t:${TEST_CHANNEL}:1760400000.000100`, title: 'Deploy', where: '#test', tint: 'public' as const }
  const runId = 'run-resolve'
  h.turns.actions.propose({ runId, callId: 'resolve-1', payload: resolveCard(h.turns.store, { account: 'A_TEST', topics: [topic] }) })
  const view = only(h)
  expect(view.card._tag).toBe('resolve')
  click(h, view)
  await settle(h)
  expect(slack.resolved()).toEqual([topic.topicId])
  expect(statusOf(only(h))).toEqual({ _tag: 'done', line: 'Resolved 1' })
})

it('Proposed task: after a Slack read, delegate proposes a card with a Because line; Start starts the job once and grants it', async () => {
  const reads = fakeHost()
  const { h } = await open({ host: reads.host, subagent: { provider: 'openrouter', modelId: 'anthropic/claude-haiku-5.5' } })
  h.fake.script([call('slack_search', { query: 'flake' }), call('delegate', { title: 'Find the flake', task: 'Look at the sidebar test.' }), reply(say('Want me to start it?'))])
  await h.ended(h.send('look into the sidebar flake'))
  const view = only(h)
  expect(view.card).toMatchObject({ _tag: 'proposedTask', kind: 'subagent', title: 'Find the flake', because: 'Juno read Slack or a report in this reply', status: { _tag: 'open' } })
  expect(h.turns.jobs.list()).toEqual([])

  click(h, view)
  await settle(h)
  const [job] = h.turns.jobs.list()
  expect(job).toMatchObject({ kind: 'subagent', title: 'Find the flake', task: 'Look at the sidebar test.' })
  expect(statusOf(only(h))).toEqual({ _tag: 'done', line: 'Started' })
  expect(liveGrant(h.turns.store, 'job', job!.id)).toMatchObject({ authority: 'click', target: job!.id })
  // The job's Stop revokes the grant.
  await h.turns.jobs.stop(job!.id)
  expect(liveGrant(h.turns.store, 'job', job!.id)).toBeUndefined()
})

it('Proposed task: in a clean owner run delegate starts the job with no card, under a grant that Pause revokes', async () => {
  const { h } = await open({ subagent: { provider: 'openrouter', modelId: 'anthropic/claude-haiku-5.5' } })
  h.fake.script([call('delegate', { title: 'Summarize', task: 'Summarize my notes.' }), reply(say('Started.'))])
  await h.ended(h.send('summarize my notes in the background'))
  expect(cards(h)).toEqual([])
  const [job] = h.turns.jobs.list()
  expect(liveGrant(h.turns.store, 'job', job!.id)).toMatchObject({ authority: 'cleanRun' })
  h.turns.setMode('paused')
  expect(liveGrant(h.turns.store, 'job', job!.id)).toBeUndefined()
  h.turns.setMode('on')
  // Resume does not restore it, and the authority that minted it cannot mint it again (a replayed call).
  expect(liveGrant(h.turns.store, 'job', job!.id)).toBeUndefined()
  const again = mintGrant(h.turns.store, { opClass: 'job', target: job!.id, authority: { _tag: 'cleanRun', run: { origin: 'owner', clean: true }, sourceInRun: true }, sourceOp: job!.originOp })
  expect(again).toEqual({ _tag: 'refused' })
  expect(liveGrant(h.turns.store, 'job', job!.id)).toBeUndefined()
})

it('Question: an option is prepared into the payload, and the click hands the answer to Juno as a click run', async () => {
  const { h } = await open()
  h.turns.actions.propose({ runId: 'run-q', callId: 'q-1', payload: question(h.turns.store, { prompt: 'Which slot?', options: ['Monday', 'Tuesday'], freeText: false }) })
  const view = only(h)
  if (view.card._tag !== 'question') throw new Error('expected a question card')
  const prepared = h.turns.actions.prepare(view.binding!.identity, { _tag: 'answer', answer: { _tag: 'option', optionId: view.card.options[1]!.id } })
  if ('_tag' in prepared) throw new Error(`prepare refused: ${prepared.reason}`)
  h.fake.script([reply(say('Tuesday it is.'))])
  expect(h.turns.actions.approve('click-q', prepared.identity, prepared.children)).toEqual({ _tag: 'accepted' })
  await settle(h)
  const run = await h.next((e): e is Extract<typeof e, { _tag: 'started' }> => e._tag === 'started' && e.origin === 'click')
  await h.ended(run.opId)
  expect(statusOf(only(h))).toEqual({ _tag: 'done', line: 'You chose Tuesday' })
  expect(h.chatRequests().at(-1)!.context.messages.map(textOf).at(-1)).toMatch(/<card-answer card="[^"]+" option="true">o2<\/card-answer>$/)
})

it('Change: Apply runs the registered executor once with exactly the stored payload', async () => {
  const runs: unknown[] = []
  const write: Executor = {
    tool: 'fake_write', tier: 3, deduped: false,
    run: async (c) => (runs.push(c.payload.args), { _tag: 'done', receipt: { open: { _tag: 'url', url: 'https://notion.invalid/page', label: 'Page' } } }),
  }
  const { h } = await open({ actions: { executors: [write] } })
  const payload = {
    _tag: 'change', server: 'Notion', target: 'Roadmap',
    action: {
      id: ActionId.make('0199f0a0-0000-7000-8000-000000000001'), rev: Revision.make(1), tier: 3, deduped: false, source: SourceGeneration.make(0),
      payload: {
        connection_id: ConnectionId.make('notion'), account_id: AccountId.make('acct'), destination_ids: [], tool: 'fake_write',
        schema_hash: Digest.make('0'.repeat(64)), args: { title: 'Q4' }, preconditions: {}, ops: [],
      },
    },
  } as CardPayload
  h.turns.actions.propose({ runId: 'run-c', callId: 'c-1', payload })
  const view = only(h)
  expect(view.card).toMatchObject({ _tag: 'change', fields: [{ name: 'title', after: '"Q4"' }] })
  click(h, view)
  await settle(h)
  expect(runs).toEqual([{ title: 'Q4' }])
  expect(statusOf(only(h))).toEqual({ _tag: 'done', line: 'Applied', open: { _tag: 'url', url: 'https://notion.invalid/page', label: 'Page' } })
})

it('Change: a tool with no executor fails on the click and nothing runs', async () => {
  const { h } = await open()
  const payload = {
    _tag: 'change', server: 'Notion', target: 'Roadmap',
    action: {
      id: ActionId.make('0199f0a0-0000-7000-8000-000000000002'), rev: Revision.make(1), tier: 3, deduped: false, source: SourceGeneration.make(0),
      payload: {
        connection_id: ConnectionId.make('notion'), account_id: AccountId.make('acct'), destination_ids: [], tool: 'notion-update-page',
        schema_hash: Digest.make('0'.repeat(64)), args: {}, preconditions: {}, ops: [],
      },
    },
  } as CardPayload
  h.turns.actions.propose({ runId: 'run-c', callId: 'c-2', payload })
  click(h, only(h))
  await settle(h)
  expect(statusOf(only(h))).toEqual({ _tag: 'failed', line: 'Failed' })
  expect(h.turns.store.db.prepare('SELECT count(*) AS n FROM authorizations').get()).toEqual({ n: 0 })
})

it('Budget: a run the cap blocks brings the Budget card; Allow raises today by one dollar, once', async () => {
  const reads = fakeHost()
  const { h } = await open({ host: reads.host })
  h.fake.script([reply({ type: 'toolCall', id: 'call-budget', name: 'slack_topics', arguments: {} }, { usage: { input: 1_000_000, output: 10 } })])
  const op = h.send('what topics are open?')
  expect((await h.ended(op)).ending).toEqual({ _tag: 'blocked', reason: 'budget' })
  const view = only(h)
  expect(view.card).toMatchObject({ _tag: 'budget', capUsd: 2, status: { _tag: 'open' } })
  expect(click(h, view, 'allow-once')).toEqual({ _tag: 'accepted' })
  await settle(h)
  expect(h.turns.guard.spend.snapshot().raises).toBe(1_000_000_000)
  expect(statusOf(only(h))).toEqual({ _tag: 'done', line: 'Allowed until midnight' })
  // The same click again raises nothing more.
  expect(click(h, view, 'allow-once')).toEqual({ _tag: 'accepted' })
  await settle(h)
  expect(h.turns.guard.spend.snapshot().raises).toBe(1_000_000_000)
})
