// Juno's memory of the owner and its person files (SPEC 13.8), on the turn engine with the scripted fake
// provider and a fake Slack: writes with no card and their marks, Undo, removal, where the outline and the
// files sit in a request, the learning pass behind a proactive ask, who gets a file, the sensitive-detail
// rule, the owner's relationship, the split of the older People doc and the background update.
import { afterEach, expect, it } from 'bun:test'
import { reply } from '@juno/agent-testing'
import type { HostReads } from '../src/index'
import type { HostInteraction } from '../src/router/host-tools'
import { asks, offerConnection, offerSetup } from '../src/memory-docs/asks'
import { deletePerson, people, person, setRelationship } from '../src/memory-docs/people'
import { entries, undoRun, writeEntry } from '../src/memory-docs/store'
import { docNotes, docsPage } from '../src/memory-docs/views'
import { DOLLAR } from '../src/spend'
import { say, textOf, toolCall, turnsHarness } from './turns-harness'
import { searchPage } from './fixtures/search'

let h: Awaited<ReturnType<typeof turnsHarness>> | undefined
afterEach(async () => {
  await h?.close()
  h = undefined
})

const DAY = 24 * 60 * 60 * 1000
const names: Record<string, string> = { U0MAYA: 'Maya Chen', U0SAM: 'Sam Okafor', U0PRIYA: 'Priya Raman' }
const ownMessages = [
  { channelId: 'C0ENG', channelName: '#eng', ts: '1.000001', senderId: 'U0ME', senderName: 'Sam Rivera', text: 'hey, pushed the backfill fix, can you review? 🙏' },
  { channelId: 'D0MAYA', ts: '1.000002', senderId: 'U0ME', senderName: 'Sam Rivera', text: 'sgtm, will do after standup' },
]

/** Fake Slack: search finds the owner's own messages, a DM's history has one from Maya, and `counts` is who the owner exchanges messages with. */
function slack(counts: () => ReadonlyArray<HostInteraction> = () => []): HostReads & { readonly reads: string[] } {
  const reads: string[] = []
  return {
    reads,
    search: async (query) => (reads.push(`search ${query}`), searchPage(ownMessages)),
    history: async (channel) => (reads.push(`history ${channel}`), { messages: [{ channelId: channel, ts: '1.000003', senderId: 'U0MAYA', senderName: 'Maya Chen', text: 'can you send the one-liner?' }] as never }),
    replies: async () => ({ messages: [] }),
    topics: async () => ({ topics: [] }),
    person: async (id) => ({ id, name: names[id] ?? id, displayName: (names[id] ?? id).split(' ')[0]! }),
    people: async () => counts(),
    members: async (asked) => asked.map((name) => ({ name, ids: Object.entries(names).filter(([, full]) => full.toLowerCase() === name.toLowerCase() || full.split(' ')[0]!.toLowerCase() === name.toLowerCase()).map(([id, full]) => ({ id, name: full })) })),
  }
}

/** Maya and the owner exchange plenty; Sam only said hello. */
const exchanges = (now: number): ReadonlyArray<HostInteraction> => [
  { id: 'U0MAYA', name: 'Maya Chen', owner: 5, them: 7, lastAt: now - DAY / 4, dm: 'D0MAYA' },
  { id: 'U0SAM', name: 'Sam Okafor', owner: 1, them: 1, lastAt: now - DAY, dm: 'D0SAM' },
]

const write = (id: string, args: Record<string, unknown>) => reply({ type: 'toolCall', id, name: 'memory_write', arguments: args as never })
const call = (id: string, name: string, args: Record<string, unknown>) => reply({ type: 'toolCall', id, name, arguments: args as never })

type Request = { readonly context: { readonly messages: ReadonlyArray<unknown> } }
/** A request's system message, where pi puts the system text and the tools. */
const systemOf = (request: Request) => request.context.messages.find((m) => (m as { role: string }).role === 'system') as { readonly content: string; readonly toolsAdded?: ReadonlyArray<{ readonly name: string }> } | undefined
/** The memory message of a request: the first user message, which holds `<remembered>`. */
const memoryOf = (request: Request) => request.context.messages.map(textOf).find((text) => text.startsWith('<remembered>')) ?? ''
const outlineOf = (memory: string) => /<about-owner[\s\S]*?<\/about-owner>/.exec(memory)?.[0] ?? ''
const peopleNowOf = (memory: string) => /<people-now>[\s\S]*?<\/people-now>/.exec(memory)?.[0] ?? ''
/** The run's conversation (its archive, attachments and summaries) and its step log, which removal clears on its own. */
const conversation = ['messages', 'attachments', 'nodes', 'run_steps']
/** Every table outside the conversation that holds `word`: memory, its write history, files, notes. */
const holding = (word: string) => {
  const { db } = h!.turns.store
  return (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>)
    .map((row) => row.name)
    .filter((table) => !conversation.includes(table) && JSON.stringify(db.prepare(`SELECT * FROM "${table}"`).all()).includes(word))
}

it('writes with no card: the owner\'s words in a clean run, marked after a Slack read, never a secret; Undo puts back one run', async () => {
  h = await turnsHarness({ compaction: false, host: slack() })
  h.fake.script([write('w1', { doc: 'you', text: 'Leads the sync team', source: 'owner' }), reply(say('Noted.'))])
  const first = h.send('I lead the sync team now')
  const run1 = await h.started(first)
  await h.ended(first)
  expect(entries(h.turns.store)).toMatchObject([{ doc: 'you', text: 'Leads the sync team', source: 'owner', tainted: false }])
  expect(h.events.find((e) => e._tag === 'memoryUpdated')).toMatchObject({ runId: run1.runId, doc: 'you' })
  // The chat's note names the doc and offers Undo, which no card stands in for.
  expect(docNotes(h.turns.store)).toMatchObject([{ item: { _tag: 'note', kind: 'memoryUpdated', docs: ['you'], run: run1.runId, undo: true } }])

  // A run that read Slack: the entry is marked as written after reading outside content.
  h.fake.script([
    call('s1', 'slack_search', { query: 'from:me' }),
    write('w2', { doc: 'people', text: 'Maya Chen reviews the backfill', source: 'owner' }),
    reply(say('Added Maya.')),
  ])
  const second = h.send('who reviews my backfill PRs?')
  const run2 = await h.started(second)
  await h.ended(second)
  expect(entries(h.turns.store).find((entry) => entry.doc === 'people')).toMatchObject({ tainted: true, source: 'owner' })

  // A key is refused, and nothing anywhere holds it.
  const key = 'sk-or-v1-0123456789abcdef0123456789'
  h.fake.script([write('w3', { doc: 'preferences', text: `my OpenRouter key is ${key}`, source: 'owner' }), reply(say('I will not keep that.'))])
  await h.ended(h.send('remember my key, it is in the settings'))
  expect(entries(h.turns.store).map((entry) => entry.doc)).toEqual(['you', 'people'])
  expect(holding(key)).toEqual([])

  // Undo on the second run's note takes back its change and nothing else.
  expect(undoRun(h.turns.store, run2.runId)).toBe(1)
  expect(entries(h.turns.store).map((entry) => entry.text)).toEqual(['Leads the sync team'])
  expect(docNotes(h.turns.store).map((note) => note.item._tag === 'note' && note.item.run)).toEqual([run1.runId])
  // A second Undo finds nothing left to put back.
  expect(undoRun(h.turns.store, run2.runId)).toBe(0)
})

it('sends the outline after the summary and before recent messages, read once per run so a write leaves the run\'s later requests as they were', async () => {
  h = await turnsHarness({ compaction: false })
  h.fake.script([write('w1', { doc: 'style', text: 'Short messages, lowercase, no sign-off' }), reply(say('Noted.'))])
  await h.ended(h.send('I write short lowercase messages'))
  const [before, after] = h.chatRequests().map(memoryOf)
  expect(outlineOf(before!)).not.toContain('Short messages, lowercase')
  // The same run's second request carries the same memory message, so the provider's cached prefix holds.
  expect(after).toBe(before)

  h.fake.script([reply(say('Sure.'))])
  await h.ended(h.send('draft a reply to Maya'))
  const next = memoryOf(h.chatRequests().at(-1)!)
  expect(outlineOf(next)).toContain('Short messages, lowercase, no sign-off')
  const at = (mark: string) => next.indexOf(mark)
  expect(at('</memory>')).toBeLessThan(at('<about-owner'))
  expect(at('</about-owner>')).toBeLessThan(at('<recent>'))
})

it('a run with a person carries their file after the recent messages; the outline names people, never their notes', async () => {
  h = await turnsHarness({ compaction: false, host: slack() })
  const store = h.turns.store
  const add = (id: string, who: string, section: 'talk' | 'work', text: string) =>
    writeEntry(store, { id, runId: null, by: 'juno', person: who, section, text, source: 'slack', tainted: true, create: { name: names[who]!, reason: 'interaction' } })
  add('a1', 'U0MAYA', 'talk', 'Short and lowercase; skips greetings')
  add('a2', 'U0MAYA', 'work', 'Owns the Postgres 16 migration plan')
  add('a3', 'U0SAM', 'work', 'Runs the platform team')
  setRelationship(store, { person: 'U0MAYA', relationship: 'manager', by: 'owner' })

  // A DM with Maya.
  const dm = { _tag: 'topic' as const, topicId: 'm:D0MAYA', title: 'Maya Chen · Main', kind: 'main' as const, place: { channelId: 'D0MAYA', name: 'Maya Chen', kindLabel: 'Direct message', tint: 'dm' as const }, person: 'U0MAYA' }
  h.fake.script([reply(say('Here is a draft.'))])
  await h.ended(h.send('draft a reply saying yes', { context: dm }))
  const first = memoryOf(h.chatRequests().at(-1)!)
  expect(first.indexOf('</recent>')).toBeLessThan(first.indexOf('<people-now>'))
  expect(peopleNowOf(first)).toContain('Short and lowercase; skips greetings')
  expect(peopleNowOf(first)).toMatch(/manager/i)
  expect(peopleNowOf(first)).not.toContain('Runs the platform team')
  expect(outlineOf(first)).toContain('Maya Chen')
  expect(outlineOf(first)).not.toContain('lowercase')

  // An update to her file changes nothing before the recent messages: the outline is the same.
  add('a4', 'U0MAYA', 'work', 'Also runs the planning offsite')
  h.fake.script([reply(say('Morning.'))])
  await h.ended(h.send('morning'))
  const second = memoryOf(h.chatRequests().at(-1)!)
  expect(outlineOf(second)).toBe(outlineOf(first))
  // A run that involves nobody carries no files.
  expect(second).not.toContain('<people-now>')
  // Naming her is enough to bring her file.
  h.fake.script([reply(say('Sure.'))])
  await h.ended(h.send('what does Maya care about?'))
  expect(memoryOf(h.chatRequests().at(-1)!)).toContain('Also runs the planning offsite')

  // Tagged people bring their files, once each; a tag with no file brings nothing.
  h.fake.script([reply(say('I will ask them.'))])
  await h.ended(h.send('ask these people for an update', {
    mentions: [
      { kind: 'person', id: 'U0MAYA', name: 'Maya Chen' },
      { kind: 'channel', id: 'C0ENG', name: 'eng' },
      { kind: 'person', id: 'U0PRIYA', name: 'Priya Raman' },
      { kind: 'person', id: 'U0SAM', name: 'Sam Okafor' },
      { kind: 'person', id: 'U0MAYA', name: 'Maya Chen' },
    ],
  }))
  const tagged = peopleNowOf(memoryOf(h.chatRequests().at(-1)!))
  expect(tagged.split('Owns the Postgres 16 migration plan')).toHaveLength(2)
  expect(tagged).toContain('Runs the platform team')
  expect(tagged).not.toContain('Priya')
  expect(people(store)).toHaveLength(2)
})

it('takes back what a removed message\'s run wrote, with its text', async () => {
  h = await turnsHarness({ compaction: false })
  h.fake.script([write('w1', { doc: 'you', text: 'Is moving to Porto in March' }), reply(say('Noted.'))])
  const op = h.send('I am moving to Porto in March')
  await h.ended(op)
  h.fake.script([write('w2', { doc: 'preferences', text: 'Likes short answers' }), reply(say('Noted.'))])
  await h.ended(h.send('keep answers short'))
  const message = h.turns.messages().find((m) => m.opId === op && m.kind === 'user')!
  await h.turns.redaction.remove({ opId: 'rm-1', messageIds: [message.id], alsoRemoveReply: false })
  expect(entries(h.turns.store).map((entry) => entry.text)).toEqual(['Likes short answers'])
  expect(holding('Porto')).toEqual([])
})

it('learns from the owner\'s own messages in the background once they accept, with reads and memory only, and marks every note it wrote as read from Slack', async () => {
  const host = slack()
  h = await turnsHarness({ compaction: false, host })
  // A setup ask still open covers a context connection, so none is offered beside it.
  expect(offerSetup(h.turns.store, ['notion'])).toBe(true)
  expect(offerSetup(h.turns.store, [])).toBe(false)
  expect(offerConnection(h.turns.store, 'notion')).toBe(false)
  const [offered] = asks(h.turns.store)
  expect(offered).toMatchObject({ reason: 'setup', state: 'open' })

  h.fake.script([
    call('l1', 'slack_search', { query: 'from:me' }),
    write('l2', { doc: 'style', text: 'Short and lowercase; opens DMs with "hey"; one 🙏 at most', source: 'slack' }),
    write('l3', { doc: 'people', text: 'Maya Chen: reviews backfill PRs', source: 'slack' }),
    reply('Learned your style and one colleague.'),
  ])
  expect(h.turns.learning.start(offered!.id)).toBe(true)
  // Starting again while it runs does nothing.
  expect(h.turns.learning.start(offered!.id)).toBe(false)
  await h.turns.learning.idle()

  expect(asks(h.turns.store)[0]).toMatchObject({ state: 'done', result: { written: 2 } })
  expect(host.reads).toEqual(['search from:me'])
  expect(entries(h.turns.store)).toMatchObject([
    { doc: 'style', source: 'slack', tainted: true },
    { doc: 'people', source: 'slack', tainted: true },
  ])
  // Its requests offer only reads and memory: nothing it reads can make it act.
  const allowed = new Set(['slack_search', 'slack_history', 'slack_replies', 'slack_person', 'memory_read', 'memory_write'])
  expect(h.fake.requests.length).toBeGreaterThan(0)
  for (const request of h.fake.requests) expect(systemOf(request)?.toolsAdded?.map((tool) => tool.name).filter((name) => !allowed.has(name))).toEqual([])
  // No chat run started for it: the owner's chat never waited on it.
  expect(h.events.filter((e) => e._tag === 'started')).toHaveLength(0)
  expect(docNotes(h.turns.store)).toMatchObject([{ item: { kind: 'memoryUpdated', docs: ['people', 'style'], run: `learn:${offered!.id}` } }])

  // Once the setup ask is done, a connection that holds the owner's context gets its own ask, once.
  expect(offerConnection(h.turns.store, 'littlebird')).toBe(true)
  expect(offerConnection(h.turns.store, 'littlebird')).toBe(false)
  expect(asks(h.turns.store).map((ask) => [ask.reason, ask.connection, ask.state])).toEqual([['setup', '', 'done'], ['connection', 'littlebird', 'open']])
})

it('stops a learning pass at Pause and at today\'s AI limit, keeping what it wrote', async () => {
  h = await turnsHarness({ compaction: false, host: slack() })
  offerSetup(h.turns.store, [])
  const [offered] = asks(h.turns.store)
  // The owner pauses Juno while the pass waits on the model.
  h.fake.script([write('l1', { doc: 'you', text: 'Works on the sync engine', source: 'slack' }), reply(async () => {
    h!.turns.setMode('paused')
    return toolCall('memory_read', {})()
  })])
  h.turns.learning.start(offered!.id)
  await h.turns.learning.idle()
  expect(asks(h.turns.store)[0]).toMatchObject({ state: 'stopped', result: { written: 1 } })
  expect(entries(h.turns.store)).toHaveLength(1)

  // Try again after Resume, with today's limit used up: the pass ends at once and says so.
  h.turns.setMode('on')
  h.turns.guard.spend.setCap(0)
  expect(h.turns.learning.start(offered!.id)).toBe(true)
  await h.turns.learning.idle()
  expect(asks(h.turns.store)[0]).toMatchObject({ state: 'failed', result: { ended: 'budget' } })
})

it('keeps a file only on people the owner exchanges messages with, or asks about, never a sensitive detail they did not say, and never overrides the owner\'s relationship', async () => {
  let now = 0
  h = await turnsHarness({ compaction: false, host: slack(() => exchanges(now)) })
  now = h.turns.store.now()
  // The counts come from the host; with AI off nothing calls the model.
  await h.turns.people.tick()

  h.fake.script([
    call('s1', 'slack_search', { query: 'from:me' }),
    write('w1', { person: 'U0SAM', section: 'work', text: 'Runs the platform team', source: 'slack' }),
    write('w2', { person: 'U0MAYA', section: 'talk', text: 'Short, lowercase, no greeting; she replies within minutes', source: 'slack' }),
    write('w3', { person: 'U0MAYA', section: 'notes', text: 'On sick leave until March', source: 'slack' }),
    write('w4', { person: 'U0MAYA', relationship: 'manager', source: 'slack' }),
    reply(say('Noted.')),
  ])
  await h.ended(h.send('who do I talk to most?'))
  // Sam barely talks with the owner, and the sick leave came from Slack, not from the owner.
  expect(people(h.turns.store).map((p) => [p.id, p.reason, p.relationship, p.relationshipBy])).toEqual([['U0MAYA', 'interaction', 'manager', 'juno']])
  expect(entries(h.turns.store)).toMatchObject([{ doc: 'people', person: 'U0MAYA', section: 'talk', source: 'slack', tainted: true }])
  expect(holding('sick leave')).toEqual([])

  // The owner asks in a clean run: a file on someone they barely message, with their own words, even a sensitive one.
  h.fake.script([
    write('w5', { person: 'U0PRIYA', section: 'notes', text: 'On parental leave until March', source: 'owner' }),
    write('w6', { person: 'U0PRIYA', relationship: 'peer', source: 'owner' }),
    reply(say('Noted.')),
  ])
  await h.ended(h.send('remember that Priya is my peer and on parental leave until March'))
  expect(person(h.turns.store, 'U0PRIYA')).toMatchObject({ name: 'Priya Raman', reason: 'asked', relationship: 'peer', relationshipBy: 'owner' })

  // Juno's guess never replaces a relationship the owner set.
  h.fake.script([call('s2', 'slack_search', { query: 'priya' }), write('w7', { person: 'U0PRIYA', relationship: 'manager', source: 'slack' }), reply(say('Ok.'))])
  await h.ended(h.send('anything new from priya?'))
  expect(person(h.turns.store, 'U0PRIYA')?.relationship).toBe('peer')

  // The page lists the files, most in touch first, with the relationship and who set it.
  const page = docsPage(h.turns.store).page
  expect(page.people.map((p) => [p.name, p.relationship, p.relationshipBy, p.entries.map((e) => e.section)])).toEqual([
    ['Maya Chen', 'manager', 'juno', ['talk']],
    ['Priya Raman', 'peer', 'owner', ['notes']],
  ])
})

it('splits the older People doc once, updates a file at most daily and inside the AI limit, and never restarts a deleted file', async () => {
  let now = 0
  const host = slack(() => exchanges(now))
  let ai = false
  h = await turnsHarness({ compaction: false, host, aiEnabled: () => ai })
  const store = h.turns.store
  now = store.now()
  const general = (id: string, text: string) => writeEntry(store, { id, runId: null, by: 'juno', doc: 'people', text, source: 'slack', tainted: true })
  general('g1', 'Maya Chen: owns the migration plan')
  general('g2', 'Lee: runs the platform team')
  general('g3', 'The design team meets on Thursdays')

  // AI off: counts and the split, no model call. Only a name Slack knows becomes a file.
  await h.turns.people.tick()
  expect(h.fake.requests).toHaveLength(0)
  expect(entries(store).map((e) => [e.person, e.text])).toEqual([
    ['U0MAYA', 'owns the migration plan'],
    [null, 'Lee: runs the platform team'],
    [null, 'The design team meets on Thursdays'],
  ])
  expect(person(store, 'U0MAYA')).toMatchObject({ reason: 'split', ownerCount: 5, themCount: 7 })
  // A second tick does not split again.
  await h.turns.people.tick()
  expect(entries(store)).toHaveLength(3)

  // AI on with today's limit used up: nothing is sent and her file stays due.
  ai = true
  h.turns.guard.spend.setCap(0)
  await h.turns.people.tick()
  expect(h.fake.requests).toHaveLength(0)

  // Room again: Maya is due (no update yet); Sam does not qualify. One short update, reading her DM.
  h.turns.guard.spend.setCap(5 * DOLLAR)
  h.fake.script([
    call('r1', 'slack_history', { channel: 'D0MAYA' }),
    write('r2', { section: 'talk', text: 'Brief and direct; replies fast' }),
    reply('Updated.'),
  ])
  await h.turns.people.tick()
  expect(host.reads).toEqual(['history D0MAYA'])
  expect(entries(store).filter((e) => e.person === 'U0MAYA').map((e) => [e.section, e.tainted])).toEqual([['work', true], ['talk', true]])
  // It has no chat run.
  expect(h.events.filter((e) => e._tag === 'started')).toHaveLength(0)

  // The same day: nothing is due.
  const before = h.fake.requests.length
  await h.turns.people.tick()
  expect(h.fake.requests.length).toBe(before)

  // The owner deletes her file: every note goes, and Juno does not start it again on its own.
  expect(deletePerson(store, { person: 'U0MAYA' })).toBe(true)
  expect(holding('Brief and direct')).toEqual([])
  expect(holding('owns the migration plan')).toEqual([])
  await h.turns.people.tick()
  expect(h.fake.requests.length).toBe(before)
  expect(people(store)).toEqual([])
})
