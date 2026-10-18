// Juno's person files (SPEC 13.8) on the turn engine, with the scripted fake provider: who gets a
// file, the sensitive-detail refusal, the owner's relationship, the file in a DM run's request after
// the recent messages, the outline that names people but not their notes, the split of the older
// People doc, the background update, and a deleted file.
import { afterEach, expect, it } from 'vitest'
import { reply } from '@juno/agent-testing'
import type { HostReads } from '../src/index'
import type { HostInteraction } from '../src/router/host-tools'
import { deletePerson, people, person, setRelationship } from '../src/memory-docs/people'
import { entries, writeEntry } from '../src/memory-docs/store'
import { docsPage } from '../src/memory-docs/views'
import { DOLLAR } from '../src/spend'
import { say, textOf, turnsHarness } from './turns-harness'

let h: Awaited<ReturnType<typeof turnsHarness>> | undefined
afterEach(async () => {
  await h?.close()
  h = undefined
})

const DAY = 24 * 60 * 60 * 1000
const names: Record<string, string> = { U0MAYA: 'Maya Chen', U0SAM: 'Sam Okafor', U0PRIYA: 'Priya Raman' }

/** Maya and the owner exchange plenty; Sam only said hello. */
function slack(counts: () => ReadonlyArray<HostInteraction>): HostReads & { readonly reads: string[] } {
  const reads: string[] = []
  return {
    reads,
    search: async (query) => (reads.push(`search ${query}`), { messages: [] }),
    history: async (channel) => (reads.push(`history ${channel}`), { messages: [{ channelId: channel, ts: '1.000001', senderId: 'U0MAYA', senderName: 'Maya Chen', text: 'can you send the one-liner?' }] as never }),
    replies: async () => ({ messages: [] }),
    topics: async () => ({ topics: [] }),
    person: async (id) => ({ id, name: names[id] ?? id, displayName: (names[id] ?? id).split(' ')[0]! }),
    people: async () => counts(),
    members: async (asked) => asked.map((name) => ({ name, ids: Object.entries(names).filter(([, full]) => full.toLowerCase() === name.toLowerCase() || full.split(' ')[0]!.toLowerCase() === name.toLowerCase()).map(([id, full]) => ({ id, name: full })) })),
  }
}

const exchanges = (now: number): ReadonlyArray<HostInteraction> => [
  { id: 'U0MAYA', name: 'Maya Chen', owner: 5, them: 7, lastAt: now - DAY / 4, dm: 'D0MAYA' },
  { id: 'U0SAM', name: 'Sam Okafor', owner: 1, them: 1, lastAt: now - DAY, dm: 'D0SAM' },
]

const write = (id: string, args: Record<string, unknown>) => reply({ type: 'toolCall', id, name: 'memory_write', arguments: args as never })
const call = (id: string, name: string, args: Record<string, unknown>) => reply({ type: 'toolCall', id, name, arguments: args as never })
const memoryOf = (request: { readonly context: { readonly messages: ReadonlyArray<unknown> } }) =>
  request.context.messages.map(textOf).find((text) => text.startsWith('<remembered>')) ?? ''
const outlineOf = (memory: string) => /<about-owner[\s\S]*?<\/about-owner>/.exec(memory)?.[0] ?? ''
const toolResults = () => h!.chatRequests().at(-1)!.context.messages.filter((m) => m.role === 'toolResult').map(textOf)

it('keeps a file only on people the owner exchanges messages with, or asks about, and never a sensitive detail they did not say', async () => {
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
  const [sam, maya, sick, relation] = toolResults().slice(-4)
  expect(sam).toMatch(/only on people the owner exchanges messages with/)
  expect(maya).toMatch(/^Added e\d+ to Maya Chen, How you talk with them\./)
  expect(sick).toMatch(/sensitive detail/)
  expect(relation).toBe('Maya Chen is now manager.')
  expect(people(h.turns.store).map((p) => [p.id, p.name, p.reason, p.relationship, p.relationshipBy])).toEqual([['U0MAYA', 'Maya Chen', 'interaction', 'manager', 'juno']])
  expect(entries(h.turns.store)).toMatchObject([{ doc: 'people', person: 'U0MAYA', section: 'talk', source: 'slack', tainted: true }])

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
  expect(toolResults().at(-1)).toMatch(/the owner set this relationship/)
  expect(person(h.turns.store, 'U0PRIYA')?.relationship).toBe('peer')

  // The page lists the files, most in touch first, with the relationship and who set it.
  const page = docsPage(h.turns.store).page
  expect(page.people.map((p) => [p.name, p.relationship, p.relationshipBy, p.entries.map((e) => e.section)])).toEqual([
    ['Maya Chen', 'manager', 'juno', ['talk']],
    ['Priya Raman', 'peer', 'owner', ['notes']],
  ])
  expect(page.docs.find((doc) => doc.doc === 'people')?.entries).toEqual([])
})

it('a DM run carries that person\'s file after the recent messages; the outline names people, never their notes', async () => {
  h = await turnsHarness({ compaction: false })
  const store = h.turns.store
  const add = (id: string, section: 'talk' | 'work', text: string) =>
    writeEntry(store, { id, runId: null, by: 'juno', person: 'U0MAYA', section, text, source: 'slack', tainted: true, create: { name: 'Maya Chen', reason: 'interaction' } })
  add('a1', 'talk', 'Short and lowercase; skips greetings')
  add('a2', 'work', 'Owns the Postgres 16 migration plan')
  setRelationship(store, { person: 'U0MAYA', relationship: 'manager', by: 'owner' })

  const dm = { _tag: 'topic' as const, topicId: 'm:D0MAYA', title: 'Maya Chen · Main', kind: 'main' as const, place: { channelId: 'D0MAYA', name: 'Maya Chen', kindLabel: 'Direct message', tint: 'dm' as const }, person: 'U0MAYA' }
  h.fake.script([reply(say('Here is a draft.'))])
  await h.ended(h.send('draft a reply saying yes', { context: dm }))
  const first = memoryOf(h.chatRequests().at(-1)!)
  const at = (mark: string) => first.indexOf(mark)
  expect(at('</recent>')).toBeLessThan(at('<people-now>'))
  expect(first).toContain('## Maya Chen (U0MAYA)\nRelationship: Manager (set by the owner)')
  expect(first).toContain('How you talk with them (talk):\n- [e1] Short and lowercase; skips greetings')
  expect(outlineOf(first)).toContain('People: 1 file, most in touch: Maya Chen (manager).')
  expect(outlineOf(first)).not.toContain('lowercase')

  // An update to her file changes nothing before the recent messages: the outline is the same.
  add('a3', 'work', 'Also runs the planning offsite')
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
})

it('a tagged person with a file is included in the model input', async () => {
  h = await turnsHarness({ compaction: false, host: slack(() => []) })
  const store = h.turns.store
  writeEntry(store, { id: 'maya', runId: null, by: 'juno', person: 'U0MAYA', section: 'work', text: 'Owns the migration plan', source: 'slack', tainted: true, create: { name: 'Maya Chen', reason: 'interaction' } })
  writeEntry(store, { id: 'sam', runId: null, by: 'juno', person: 'U0SAM', section: 'work', text: 'Runs the platform team', source: 'slack', tainted: true, create: { name: 'Sam Okafor', reason: 'interaction' } })

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

  const memory = memoryOf(h.chatRequests().at(-1)!)
  expect(memory.indexOf('</recent>')).toBeLessThan(memory.indexOf('<people-now>'))
  expect(memory).toContain('## Maya Chen (U0MAYA)\n')
  expect(memory).toContain('Owns the migration plan')
  expect(memory).toContain('## Sam Okafor (U0SAM)\n')
  expect(memory).toContain('Runs the platform team')
  expect(memory).not.toContain('Priya Raman')
  expect(memory.match(/## Maya Chen \(U0MAYA\)/g)).toHaveLength(1)
  expect(people(store)).toHaveLength(2)
})

it('splits the older People doc once, keeps background updates daily and inside the AI limit, and never restarts a deleted file', async () => {
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

  // AI off: counts and the split, no model call.
  await h.turns.people.tick()
  expect(h.fake.requests).toHaveLength(0)
  expect(entries(store).map((e) => [e.person, e.section, e.text])).toEqual([
    ['U0MAYA', 'work', 'owns the migration plan'],
    [null, null, 'Lee: runs the platform team'],
    [null, null, 'The design team meets on Thursdays'],
  ])
  expect(person(store, 'U0MAYA')).toMatchObject({ reason: 'split', ownerCount: 5, themCount: 7 })

  // AI on: Maya is due (no update yet); Sam does not qualify. One short update, reading her DM.
  ai = true
  h.fake.script([
    call('r1', 'slack_history', { channel: 'D0MAYA' }),
    write('r2', { section: 'talk', text: 'Brief and direct; replies fast' }),
    reply('Updated.'),
  ])
  await h.turns.people.tick()
  expect(host.reads).toEqual(['history D0MAYA'])
  expect(entries(store).filter((e) => e.person === 'U0MAYA').map((e) => [e.section, e.tainted])).toEqual([['work', true], ['talk', true]])
  const update = h.fake.requests.filter((request) => textOf(request.context.messages.find((m) => (m as { role: string }).role === 'system')).includes('short file on each person'))
  expect(update.length).toBeGreaterThan(0)
  // It runs on the subagent path and has no chat run or chat note.
  expect(h.events.filter((e) => e._tag === 'started')).toHaveLength(0)

  // The same day: nothing is due.
  const before = h.fake.requests.length
  await h.turns.people.tick()
  expect(h.fake.requests.length).toBe(before)

  // The owner deletes her file: every note goes, and Juno does not start it again on its own.
  expect(deletePerson(store, { person: 'U0MAYA' })).toBe(true)
  expect(entries(store).filter((e) => e.person === 'U0MAYA')).toEqual([])
  expect(store.db.prepare("SELECT count(*) AS n FROM memory_writes WHERE person = 'U0MAYA' AND (after_text IS NOT NULL OR before_text IS NOT NULL)").get()).toEqual({ n: 0 })
  await h.turns.people.tick()
  expect(h.fake.requests.length).toBe(before)
  expect(people(store)).toEqual([])
})

it('a background update stops at today\'s AI limit and leaves the file due', async () => {
  let now = 0
  h = await turnsHarness({ compaction: false, host: slack(() => exchanges(now)), aiEnabled: () => true })
  now = h.turns.store.now()
  h.turns.guard.spend.setCap(0)
  await h.turns.people.tick()
  expect(people(h.turns.store)).toEqual([])
  // Room again: the next tick carries on.
  h.turns.guard.spend.setCap(5 * DOLLAR)
  h.fake.script([write('r1', { section: 'work', text: 'Owns the migration plan' }), reply('Updated.')])
  await h.turns.people.tick()
  expect(people(h.turns.store).map((p) => p.id)).toEqual(['U0MAYA'])
})
