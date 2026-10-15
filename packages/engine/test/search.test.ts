import { Effect } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'
import { prefsSet, searchCommand, searchQuery, searchSlack, type SearchResult } from '@juno/contract'
import { liveQuery, runCommand } from '@juno/state'
import { Store, StoreWriter, transaction, workspacePaths } from '@juno/store'
import { startTestEngine, waitFor, type RunningEngine } from './harness'

let engine: RunningEngine | undefined
afterEach(async () => { await engine?.stop(); engine = undefined })

async function boot() {
  engine = await startTestEngine({ initial: (fake) => fake.signIn(), fakeOptions: { seed: (workspace) => {
    workspace.addUser({ id: workspace.selfId, name: 'self' })
    workspace.addUser({ id: 'U0MAYA', name: 'maya', profile: { display_name: 'Maya Chen' } })
    for (const [id, name, member] of [['C0SEARCH', 'rollout', true], ['C0IGNORE', 'rollout-alerts', true], ['C0OUTSIDE', 'rollout-public', false]] satisfies ReadonlyArray<readonly [string, string, boolean]>) {
      workspace.addConversation({ id, name, kind: 'public', members: new Set(member ? [workspace.selfId, 'U0MAYA'] : ['U0MAYA']), created: workspace.clock.now(), topic: '', purpose: '', isOpen: true, archived: false })
      const root = workspace.post({ channel: id, user: 'U0MAYA', text: 'Rollout checklist', at: workspace.clock.now() - 60_000, silent: true })
      workspace.post({ channel: id, user: 'U0MAYA', text: 'Rollout checklist rollout checklist', at: workspace.clock.now() - 30_000, silent: true })
      workspace.post({ channel: id, user: 'U0MAYA', text: 'Ready for review', threadTs: root.ts, at: workspace.clock.now() - 5_000, silent: true })
    }
  } } })
  await engine.phase('live')
  await Effect.runPromise(Effect.gen(function* () {
    const sql = yield* StoreWriter
    yield* transaction(sql`INSERT INTO ignored_channels (channel, ignored_at) VALUES ('C0IGNORE', '1700000000.000000')`)
    // A cached non-member row also stays excluded, even if it remains after leaving.
    yield* transaction(sql`INSERT INTO messages (channel, ts, text) VALUES ('C0OUTSIDE', '1700000000.000000', 'rollout checklist')`)
  }).pipe(Effect.provide(Store.layer(workspacePaths(engine.userData, engine.fake.teamId))), Effect.scoped))
  return engine
}

async function search(e: RunningEngine, query: string): Promise<ReadonlyArray<SearchResult>> {
  const atom = liveQuery(searchQuery)({ query, limit: 50 })
  const unmount = e.registry.mount(atom)
  try {
    return await waitFor(() => {
      const value = e.registry.get(atom)
      return value._tag === 'Success' ? value.value : undefined
    }, undefined, `search ${query}`)
  } finally { unmount() }
}

const channelOf = (result: SearchResult): string => (result.kind === 'channel' ? result.id : result.kind === 'person' ? '' : result.place.id)

describe('local search through the engine', () => {
  it('matches a word and a prefix: places first, then titles, then better message matches first', async () => {
    const e = await boot()
    for (const query of ['rollout', 'roll']) {
      const results = await search(e, query)
      expect(results[0]).toMatchObject({ kind: 'channel', id: 'C0SEARCH', place: { label: '#rollout' }, mainId: 'm:C0SEARCH' })
      expect(results[1]).toMatchObject({ kind: 'topic', title: 'Rollout checklist', place: { id: 'C0SEARCH', name: 'rollout' } })
      const messages = results.filter((result) => result.kind === 'message')
      expect(messages.map((result) => [result.text, result.sender, result.stored])).toEqual([
        ['Rollout checklist rollout checklist', 'Maya Chen', true],
        ['Rollout checklist', 'Maya Chen', true],
      ])
      expect(messages[1]).toMatchObject({ title: 'Rollout checklist', topicId: expect.stringMatching(/^t:C0SEARCH:/) })
      expect(messages[0]).toMatchObject({ title: '#rollout · Main', topicId: 'm:C0SEARCH' })
    }
    expect(await search(e, 'May')).toContainEqual(expect.objectContaining({ kind: 'person', id: 'U0MAYA', person: expect.objectContaining({ name: 'Maya Chen' }) }))
  })

  it('breaks equal message ranks by channel and timestamp, independent of insertion order', async () => {
    const e = await boot()
    await Effect.runPromise(Effect.gen(function* () {
      const sql = yield* StoreWriter
      yield* transaction(Effect.gen(function* () {
        yield* sql`INSERT INTO conversations (id, kind, name, is_member) VALUES ('C0TIE', 'public', 'tie', 1)`
        for (const [channel, ts] of [['C0TIE', '1700000002.000000'], ['C0SEARCH', '1700000003.000000'], ['C0SEARCH', '1700000001.000000']]) {
          yield* sql`INSERT INTO messages (channel, ts, text) VALUES (${channel}, ${ts}, 'equalrank')`
        }
      }))
    }).pipe(Effect.provide(Store.layer(workspacePaths(e.userData, e.fake.teamId))), Effect.scoped))
    expect((await search(e, 'equalrank')).map((result) => result.id)).toEqual([
      'C0SEARCH:1700000001.000000',
      'C0SEARCH:1700000003.000000',
      'C0TIE:1700000002.000000',
    ])
  })

  it('excludes ignored channels and cached non-member channels', async () => {
    const e = await boot()
    const results = await search(e, 'rollout')
    expect(results.length).toBeGreaterThan(0)
    expect(results.filter((result) => result.kind !== 'person').every((result) => channelOf(result) === 'C0SEARCH')).toBe(true)
  })

  it('returns recent visible topics for an empty query', async () => {
    const e = await boot()
    const results = await search(e, '   ')
    expect(results).toHaveLength(2)
    expect(results.every((result) => result.kind === 'topic' && result.place.id === 'C0SEARCH')).toBe(true)
    expect(results).toContainEqual(expect.objectContaining({ kind: 'topic', id: 'm:C0SEARCH', title: '#rollout · Main' }))
  })
})

describe('palette text from Slack', () => {
  it('names the people a title or snippet mentions and decodes Slack escaping', async () => {
    engine = await startTestEngine({ initial: (fake) => fake.signIn(), fakeOptions: { seed: (workspace) => {
      workspace.addUser({ id: workspace.selfId, name: 'self' })
      workspace.addUser({ id: 'U0MAYA', name: 'maya', profile: { display_name: 'Maya Chen' } })
      workspace.addConversation({ id: 'C0SEARCH', name: 'rollout', kind: 'public', members: new Set([workspace.selfId, 'U0MAYA']), created: workspace.clock.now(), topic: '', purpose: '', isOpen: true, archived: false })
      // Stored as Slack stores it: `<@U0MAYA> canary -&gt; prod`.
      const root = workspace.post({ channel: 'C0SEARCH', user: 'U0MAYA', text: '<@U0MAYA> canary -> prod', at: workspace.clock.now() - 60_000, silent: true })
      workspace.post({ channel: 'C0SEARCH', user: 'U0MAYA', text: 'Done', threadTs: root.ts, at: workspace.clock.now() - 5_000, silent: true })
    } } })
    await engine.phase('live')
    const results = await search(engine, 'canary')
    expect(results).toContainEqual(expect.objectContaining({ kind: 'topic', title: '@Maya Chen canary -> prod' }))
    expect(results).toContainEqual(expect.objectContaining({ kind: 'message', title: '@Maya Chen canary -> prod', text: '@Maya Chen canary -> prod' }))
  })
})

describe("Slack's search through the engine", () => {
  it('finds a message the store lacks in its thread, and drops channels the user is not in or ignores', async () => {
    const e = await boot()
    const root = e.fake.workspace.post({ channel: 'C0SEARCH', user: 'U0MAYA', text: 'Quarterly budget review', at: e.fake.workspace.clock.now() - 2_000, silent: true })
    e.fake.workspace.post({ channel: 'C0SEARCH', user: 'U0MAYA', text: 'The budget spreadsheet is final', threadTs: root.ts, at: e.fake.workspace.clock.now() - 1_000, silent: true })
    e.fake.workspace.post({ channel: 'C0IGNORE', user: 'U0MAYA', text: 'budget spreadsheet', at: e.fake.workspace.clock.now() - 1_000, silent: true })
    const exit = await runCommand(e.registry, searchSlack, { query: 'spreadsheet' })
    expect(exit._tag).toBe('Success')
    if (exit._tag !== 'Success') return
    expect(exit.value).toEqual([
      expect.objectContaining({ kind: 'message', text: 'The budget spreadsheet is final', topicId: `t:C0SEARCH:${root.ts}`, stored: false, sender: 'Maya Chen', place: expect.objectContaining({ label: '#rollout' }) }),
    ])
  })
})

describe('palette commands through the engine', () => {
  it('reads "tell maya …" as a send to her, and nothing while AI assist is off', async () => {
    const e = await boot()
    const command = async (text: string) => {
      const exit = await runCommand(e.registry, searchCommand, { text })
      if (exit._tag !== 'Success') throw new Error(`search.command failed for ${text}`)
      return exit.value
    }
    expect(await command('tell maya the slot works')).toMatchObject({ kind: 'send-dm', userId: 'U0MAYA', text: 'the slot works', place: 'Maya Chen', label: 'Send to Maya Chen', hint: '↵ Send' })
    expect(await command('post in rollout ship it')).toMatchObject({ kind: 'post', channelId: 'C0SEARCH', place: '#rollout', label: 'Post in #rollout' })
    expect(await command('rollout')).toBeNull()
    await runCommand(e.registry, prefsSet, { key: 'aiAssist', value: false })
    expect(await command('tell maya the slot works')).toBeNull()
  })
})
