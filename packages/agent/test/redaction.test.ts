// Removing a message (plan v3 §4.5, §14.4; SPEC 13.8): the removal reaches every place the words lived (the
// archive, the inbox, attachments, summaries, pins, cards, grants, Codex thread files, the pi journal and the
// backup), work that read the old generation is discarded, and a removal Juno proposes runs once on the
// owner's click. In-process, on the real engine, with the scripted model, the fake host and a fake backup.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { fakeActionHost, reply, TEST_CHANNEL } from '@juno/agent-testing'
import type { Card, CardBinding, ChatItem, ChatPage, OpId, ChatMessageId } from '@juno/agent-contract'
import { liveGrant, mintGrant, type RemovalBackup, type Turns } from '../src/index'
import { ONLINE, run, served } from './serve-harness'
import { deferred, HAIKU, say, turnsHarness } from './turns-harness'

/** A made-up marker for the words the owner removes. */
const SECRET = 'ZEBRA-4417'

type Harness = Awaited<ReturnType<typeof turnsHarness>>
const harnesses: Harness[] = []
afterEach(async () => {
  for (const h of harnesses.splice(0)) await h.close()
})

let calls = 0
const call = (name: string, args: Record<string, unknown>) => reply({ type: 'toolCall', id: `call-${name}-${++calls}`, name, arguments: args as never })

/** Every table and row of agent.sqlite that still holds the marker. */
function leaks(turns: Turns): ReadonlyArray<string> {
  const { db } = turns.store
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>
  return tables.flatMap(({ name }) =>
    (db.prepare(`SELECT * FROM "${name}"`).all() as unknown[]).filter((row) => JSON.stringify(row).includes(SECRET)).map((row) => `${name}: ${JSON.stringify(row)}`),
  )
}

/** Files under the agent directory, other than agent.sqlite, whose bytes hold the marker. */
async function fileLeaks(dir: string): Promise<ReadonlyArray<string>> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })
  const found: string[] = []
  for (const entry of entries) {
    if (!entry.isFile() || entry.name.startsWith('agent.sqlite')) continue
    const path = join(entry.parentPath, entry.name)
    if ((await readFile(path)).includes(SECRET)) found.push(path)
  }
  return found
}

/** A backup that records the order of its calls and what a regenerated generation would hold. */
function fakeBackup(turns: () => Turns) {
  const calls: Array<{ readonly call: 'raise' | 'regenerate'; readonly gen: number; readonly headGen: number; readonly leaks?: ReadonlyArray<string> }> = []
  const headGen = () => (turns().store.db.prepare('SELECT gen FROM memory_head').get() as { gen: number }).gen
  const backup: RemovalBackup = {
    raiseDeletion: async (gen) => void calls.push({ call: 'raise', gen, headGen: headGen() }),
    regenerate: async (gen) => void calls.push({ call: 'regenerate', gen, headGen: headGen(), leaks: leaks(turns()) }),
  }
  return { backup, calls }
}

const ownerMessageId = (turns: Turns, opId: string) =>
  (turns.store.db.prepare("SELECT min(id) AS id FROM messages WHERE kind = 'user' AND origin_op = ?").get(opId) as { id: number }).id

type View = { readonly card: Card; readonly binding?: typeof CardBinding.Type }
const statusOf = (view: View | undefined) => (view !== undefined && 'status' in view.card ? view.card.status : undefined)

it('a removal reaches every place the words lived, and Juno never sees them again', async () => {
  const slack = fakeActionHost()
  let opened: Harness | undefined
  const backup = fakeBackup(() => opened!.turns)
  const h = (opened = await turnsHarness({ actions: { host: slack.host }, backup: backup.backup }))
  harnesses.push(h)

  // The owner says it, Juno pins it and repeats it.
  h.fake.script([call('remember', { quote: `the gate code is ${SECRET}` }), reply(say(`Saved: ${SECRET}.`))])
  const said = h.send(`Remember this: the gate code is ${SECRET}.`)
  await h.ended(said)
  // A later run proposes a message: an open card from a run that saw it.
  h.fake.script([call('send_message', { messages: [{ topic: `m:${TEST_CHANNEL}`, text: 'Gate is open.' }] }), reply(say('Drafted.'))])
  await h.ended(h.send('tell the channel the gate is open'))
  await h.turns.compaction.idle()
  // A live grant, a Codex turn with its thread file, and the journal all hold or depend on it.
  expect(mintGrant(h.turns.store, { opClass: 'job', target: 'job-1', authority: { _tag: 'click', current: true }, sourceOp: 'op-x' })._tag).toBe('minted')
  const home = join(h.dir, 'codex')
  const threadFile = join(home, 'sessions', '2026', '10', '15', 'rollout-1-thread-abc.jsonl')
  await mkdir(join(threadFile, '..'), { recursive: true })
  await writeFile(threadFile, JSON.stringify({ text: SECRET }))
  h.turns.store.db.prepare("INSERT INTO codex_turns (id, day, thread_id, home) VALUES ('turn-1', '2026-10-15', 'thread-abc', ?)").run(home)
  const before = leaks(h.turns)
  for (const table of ['messages', 'inbox', 'attachments', 'nodes', 'pins']) expect(before.some((row) => row.startsWith(`${table}:`)), table).toBe(true)
  const pinRev = h.turns.pins.active().revision
  const oldJournal = h.turns.incarnation()
  expect(statusOf(h.turns.actions.views()[0])).toEqual({ _tag: 'open' })

  const removed = await h.turns.redaction.remove({ opId: 'remove-1', messageIds: [ownerMessageId(h.turns, said)], alsoRemoveReply: true })
  expect(removed).toMatchObject({ _tag: 'removed', gen: 1 })
  // From the commit on: pins, the card, the grant and the view.
  expect(h.turns.pins.active()).toEqual({ revision: pinRev + 1, active: [] })
  expect(statusOf(h.turns.actions.views()[0])).toEqual({ _tag: 'expired' })
  expect(liveGrant(h.turns.store, 'job', 'job-1')).toBeUndefined()
  expect(h.turns.memory().gen).toBe(1)

  await h.turns.redaction.idle()
  await h.turns.compaction.idle()
  expect(h.turns.redaction.pending()).toEqual([])
  expect(leaks(h.turns)).toEqual([])
  // The journal rotated, the old file is gone, and no file under the agent directory holds the words.
  expect(h.turns.incarnation()).not.toBe(oldJournal)
  expect(await fileLeaks(h.dir)).toEqual([])
  // The backup's record was raised before the commit, and the new generation is sanitized.
  expect(backup.calls.map(({ call, gen, headGen }) => [call, gen, headGen])).toEqual([['raise', 1, 0], ['regenerate', 1, 1]])
  expect(backup.calls[1]!.leaks).toEqual([])
  // Memory is rebuilt without them.
  expect(h.turns.memory().lines.every((line) => line.kind === 'node')).toBe(true)

  // The next request carries none of it.
  h.fake.script([reply(say('Hello.'))])
  await h.ended(h.send('hello'))
  expect(JSON.stringify(h.chatRequests().at(-1)!.context)).not.toContain(SECRET)
  // The same op again is the same removal.
  expect(await h.turns.redaction.remove({ opId: 'remove-1', messageIds: [ownerMessageId(h.turns, said)], alsoRemoveReply: true })).toEqual(removed)
  expect(backup.calls).toHaveLength(2)
})

it('a compaction job that read the message before the removal is discarded, and the summary is rebuilt without it', async () => {
  const hold = deferred()
  let held = 0
  const h = await turnsHarness({
    transport: (fake) => ({
      getProviders: () => fake.models.getProviders(),
      getModel: (provider: string, id: string) => fake.models.getModel(provider, id),
      streamSimple: (model: { id: string }, context: unknown, options: unknown) => {
        const inner = () => fake.models.streamSimple(model as never, context as never, options as never)
        if (model.id !== HAIKU.modelId) return inner()
        return { async *[Symbol.asyncIterator]() { held += 1; await hold.promise; yield* inner() } }
      },
    }) as never,
  })
  harnesses.push(h)
  // Over the 512-byte node target, so its summary needs the model.
  h.fake.script([reply(say('Noted.'))])
  const said = h.send(`The gate code is ${SECRET}. ${'We agreed to repaint the gate before the spring. '.repeat(20)}`)
  await h.ended(said)
  await waitUntil(() => held > 0)
  expect(h.turns.compaction.state()).toBe('running')

  await h.turns.redaction.remove({ opId: 'remove-1', messageIds: [ownerMessageId(h.turns, said)], alsoRemoveReply: false })
  hold.resolve()
  await h.turns.compaction.idle()
  await h.turns.redaction.idle()
  expect(leaks(h.turns)).toEqual([])
  // The removed message's line is rebuilt from nothing; Juno's reply stays.
  const lines = h.turns.memory().lines
  expect(lines.every((line) => line.kind === 'node')).toBe(true)
  expect(lines.map((line) => (line.kind === 'node' ? line.node.text : '')).join('\n')).toContain('Noted.')
})

it('work that saw the removed message is refused: a waiting click, a pin edit, and the next card', async () => {
  const slack = fakeActionHost()
  const h = await turnsHarness({ compaction: false, actions: { host: slack.host } })
  harnesses.push(h)
  h.fake.script([call('remember', { quote: SECRET }), call('send_message', { messages: [{ topic: `m:${TEST_CHANNEL}`, text: SECRET }] }), reply(say('Drafted.'))])
  const said = h.send(`Remember ${SECRET} and send it to the channel.`)
  await h.ended(said)
  const pin = h.turns.pins.active().active[0]!
  const view = h.turns.actions.views()[0]!
  // The owner clicks while paused: the click waits.
  h.turns.setMode('paused')
  expect(h.turns.actions.approve('click-1', view.binding!.identity, view.binding!.children)).toEqual({ _tag: 'accepted' })

  await h.turns.redaction.remove({ opId: 'remove-1', messageIds: [ownerMessageId(h.turns, said)], alsoRemoveReply: false })
  h.turns.setMode('on')
  await h.turns.actions.idle()
  expect(slack.calls).toEqual([])
  expect(h.turns.store.db.prepare('SELECT refused FROM approvals').all()).toEqual([{ refused: 'sourceChanged' }])
  expect(statusOf(h.turns.actions.views()[0])).toEqual({ _tag: 'expired' })
  // An edit of the pin from before is refused: its source is gone.
  expect(h.turns.pins.edit({ id: pin.id, version: pin.version }, 'something else')).toEqual({ _tag: 'refused', reason: 'conflict' })
  // "Remember this" on the removed message is refused too.
  expect(h.turns.pins.pinMessage({ messageId: ownerMessageId(h.turns, said) })).toMatchObject({ _tag: 'refused' })
})

it("a removal Juno proposes: the card names the message and offers Juno's reply, and one click removes both", async () => {
  const h = await turnsHarness({ compaction: false })
  harnesses.push(h)
  h.fake.script([reply(say(`Got it, ${SECRET}.`))])
  const said = h.send(`The gate code is ${SECRET}.`)
  await h.ended(said)
  h.fake.script([call('remove_messages', { messages: ['n1'] }), reply(say('Here it is.'))])
  await h.ended(h.send('forget the gate code'))
  const view = h.turns.actions.views()[0]!
  if (view.card._tag !== 'remove') throw new Error('expected a Remove card')
  const id = String(ownerMessageId(h.turns, said))
  expect(view.card.messages).toEqual([expect.objectContaining({ messageId: id, preview: `The gate code is ${SECRET}.` })])
  expect(view.card.offerReply).toBeDefined()
  // Proposing removed nothing.
  expect(leaks(h.turns).length).toBeGreaterThan(0)

  // "Also remove Juno's reply" is the card's choice, written before the click.
  const prepared = h.turns.actions.prepare(view.binding!.identity, { _tag: 'remove', alsoRemoveReply: true })
  if (!('identity' in prepared)) throw new Error(`prepare refused: ${JSON.stringify(prepared)}`)
  expect(h.turns.actions.approve('click-1', prepared.identity, prepared.children)).toEqual({ _tag: 'accepted' })
  await h.turns.actions.idle()
  await h.turns.redaction.idle()
  expect(statusOf(h.turns.actions.views()[0])).toEqual({ _tag: 'done', line: 'Removed 1 message' })
  // The card keeps no copy of the words it removed, and Juno's reply went with them.
  expect(leaks(h.turns)).toEqual([])
  const done = h.turns.actions.views()[0]!
  if (done.card._tag !== 'remove') throw new Error('expected a Remove card')
  expect(done.card.messages[0]!.preview).toBe('')
  expect(h.turns.messages().filter((m) => m.kind === 'juno').map((m) => m.text)).not.toContain(say(`Got it, ${SECRET}.`))
  // A name that is not an owner message proposes nothing.
  h.fake.script([call('remove_messages', { messages: ['n99'] }), reply(say('No.'))])
  await h.ended(h.send('forget something else'))
  expect(h.turns.actions.views()).toHaveLength(1)
})

it('the owner removes a message from the sheet with AI assist off, and the chat shows Removed in its place', async () => {
  const { h, client, pageWhere, setPresence } = await served()
  h.fake.script([reply(say(`Noted, ${SECRET}.`))])
  const said = h.send(`The gate code is ${SECRET}.`)
  await h.ended(said)
  h.fake.script([reply(say('Sure.'))])
  await h.ended(h.send('and the shed is blue', { replyTo: { _tag: 'owner', opId: said as OpId } }))
  await setPresence({ ...ONLINE, aiEnabled: false })

  const messageId = String(ownerMessageId(h.turns, said)) as ChatMessageId
  const result = await run(client['agent.chat.remove']({ opId: 'remove-1' as OpId, messageId, alsoRemoveReply: true }))
  expect(result).toMatchObject({ _tag: 'Success', success: { opId: 'remove-1' } })
  const of = <T extends ChatItem['_tag']>(page: ChatPage, tag: T) => page.items.filter((item): item is Extract<ChatItem, { _tag: T }> => item._tag === tag)
  const page = await pageWhere((p) => of(p, 'note').length === 1, 'the Removed note')
  expect(of(page, 'note')[0]).toEqual({ _tag: 'note', id: messageId, kind: 'removed' })
  expect(of(page, 'owner').map((o) => o.text)).toEqual(['and the shed is blue'])
  // The reply that quoted it now reads Removed, and Juno's reply to it is gone.
  expect(of(page, 'owner')[0]!.replyTo).toMatchObject({ removed: true })
  expect(of(page, 'juno').map((j) => j.body.map((b) => ('text' in b ? b.text : '')).join(''))).toEqual(['Sure.'])
  expect(JSON.stringify(page)).not.toContain(SECRET)
  // A message that is not in the chat.
  const missing = await run(client['agent.chat.remove']({ opId: 'remove-2' as OpId, messageId: '999' as ChatMessageId, alsoRemoveReply: false }))
  expect(missing).toMatchObject({ _tag: 'Failure', failure: { reason: 'stale' } })
})

async function waitUntil(test: () => boolean, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (!test()) {
    if (Date.now() > deadline) throw new Error('timed out')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
