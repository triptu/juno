import { Effect } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'
import { searchQuery, type SearchResult } from '@juno/contract'
import { liveQuery } from '@juno/state'
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

describe('local search through the engine', () => {
  it('matches a word and a prefix, ranking navigation before messages and better message matches first', async () => {
    const e = await boot()
    for (const query of ['rollout', 'roll']) {
      const results = await search(e, query)
      expect(results[0]).toMatchObject({ kind: 'topic', channelId: 'C0SEARCH', title: 'Rollout checklist' })
      expect(results.findIndex((result) => result.kind === 'channel')).toBeLessThan(results.findIndex((result) => result.kind === 'message'))
      const messages = results.filter((result) => result.kind === 'message')
      expect(messages.map((result) => result.text)).toEqual(['Rollout checklist rollout checklist', 'Rollout checklist'])
    }
    expect(await search(e, 'May')).toContainEqual({ kind: 'person', id: 'U0MAYA', name: 'Maya Chen' })
  })

  it('excludes ignored channels and cached non-member channels', async () => {
    const e = await boot()
    const results = await search(e, 'rollout')
    expect(results.length).toBeGreaterThan(0)
    expect(results.every((result) => result.kind === 'person' || (result.kind === 'channel' ? result.id : result.channelId) === 'C0SEARCH')).toBe(true)
  })

  it('returns recent visible topics for an empty query', async () => {
    const e = await boot()
    const results = await search(e, '   ')
    expect(results).toHaveLength(2)
    expect(results.every((result) => result.kind === 'topic' && result.channelId === 'C0SEARCH')).toBe(true)
    expect(results).toContainEqual({ kind: 'topic', id: 'm:C0SEARCH', channelId: 'C0SEARCH', title: '#rollout · Main' })
  })
})
