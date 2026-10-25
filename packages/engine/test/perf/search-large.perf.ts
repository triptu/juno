import { searchSessions } from '../../src/search/session'
import { serveLiveValue } from '../../src/protocol/live'
import { SyncLink } from '../../src/syncLink'
import type { OpenWorkspace, StoreServices } from '../../src/workspace'
import { NotSignedIn, SEARCH_WINDOW, SearchUpdate } from '@juno/contract'
import { mkdtemp, rm } from 'node:fs/promises'
import { loadavg, tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect, Fiber, Queue, Schema, Stream } from 'effect'
import { describe, expect, it } from 'bun:test'
import { largeSeed, startFakeSlack } from '@juno/fake-slack'
import { inBatches, Store, StoreReader, StoreWriter, transaction, workspacePathsFromDir } from '@juno/store'
import { parseSearchQuery } from '@juno/domain'
import { compileSearchSql } from '../../src/searchCompiler'
import { querySearch } from '../../src/searchQuery'
import { perfBudget } from '@juno/testing/perf-budget'

const encode = Schema.encodeSync(Schema.toCodecJson(SearchUpdate))
const decode = Schema.decodeUnknownSync(Schema.toCodecJson(SearchUpdate))

describe('local FTS on 100 k messages', () => {
  it('stays within 20 ms while a backfill writes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'juno-search-bench-'))
    const fake = await startFakeSlack({ seed: largeSeed() })
    try {
      const report = await Effect.runPromise(Effect.gen(function* () {
        const sql = yield* StoreWriter
        const reader = yield* StoreReader
        const seeded = yield* seedStore(fake)
        const committed = yield* Queue.unbounded<number>()
        const resume = yield* Queue.unbounded<void>()
        const backfill = yield* Effect.forkChild(Effect.gen(function* () {
          for (let batch = 0; batch < 50; batch++) {
            const rows = Array.from({ length: 200 }, (_, i) => ({ channel: 'C00000L', user_id: 'U000001L', ts: `1900000000.${String(batch * 200 + i).padStart(6, '0')}`, text: 'Backfill rollout checklist https://example.test/check — The migration is ready for review. Please check the staged rollout, rollback procedure, customer support notes and the dashboard links before the next deployment window. The owner will confirm each step in this thread.' }))
            yield* transaction(sql`INSERT INTO messages ${sql.insert(rows)}`)
            yield* Queue.offer(committed, rows.length)
            yield* Queue.take(resume)
          }
        }))
        const samples: number[] = []
        const byQuery = new Map<string, number[]>()
        const filteredSamples: number[] = []
        const sessionSamples: number[] = []
        const encodeSamples: number[] = []
        const decodeSamples: number[] = []
        const sessions = searchSessions({ api: Effect.fail(new NotSignedIn()), workspaceUrl: Effect.fail(new NotSignedIn()) }, yield* SyncLink)
        const open = { id: fake.teamId, paths: workspacePathsFromDir(dir), context: yield* Effect.context<StoreServices>() }
        let sessionBytes = 0
        const filtered = compileSearchSql({ query: parseSearchQuery('rollout in:C00000L after:2000-01-01 has:link', { timeZone: 'UTC' }), timeZone: 'UTC', identities: new Map([[8, [{ id: 'C00000L', slack: '<#C00000L>' }]]]) })
        let messageSearches = 0
        let writes = 0
        for (let run = 0; run < 50; run++) {
          writes += yield* Queue.take(committed)
          // Let the next transaction overlap the read on the separate WAL connection.
          yield* Queue.offer(resume, undefined)
          const started = performance.now()
          const query = ['roll', 'deploy', 'index missing hotfix rollout'][run % 3] ?? 'deploy'
          const results = yield* querySearch(query)
          const elapsed = performance.now() - started
          samples.push(elapsed)
          byQuery.set(query, [...(byQuery.get(query) ?? []), elapsed])
          if (results.some((result) => result.kind === 'message')) messageSearches++
          expect(results.length).toBeGreaterThan(0)
          const session = yield* measureSession(sessions, open, run)
          sessionSamples.push(session.queryMs)
          encodeSamples.push(session.encodeMs)
          decodeSamples.push(session.decodeMs)
          sessionBytes = Math.max(sessionBytes, session.bytes)
          const filteredStart = performance.now()
          const filteredRows = yield* reader.unsafe<{ ts: string }>(`SELECT m.ts FROM ${filtered.source} WHERE ${filtered.where} ORDER BY ${filtered.order} LIMIT 50`, filtered.params)
          filteredSamples.push(performance.now() - filteredStart)
          expect(filteredRows.length).toBeGreaterThan(0)
        }
        yield* Fiber.join(backfill)
        const sorted = samples.toSorted((a, b) => a - b)
        const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? Infinity
        return { ...seeded, backfillMessages: writes, messageSearches, runs: samples.length, minMs: sorted[0], medianMs: sorted[25], maxMs: sorted.at(-1), p95Ms: p95, queryMaxMs: Object.fromEntries([...byQuery].map(([query, values]) => [query, Math.max(...values)])), filteredP95Ms: filteredSamples.toSorted((a, b) => a - b)[47], sessionP95Ms: sessionSamples.toSorted((a, b) => a - b)[47], sessionBytes, encodeP95Ms: encodeSamples.toSorted((a, b) => a - b)[47], decodeP95Ms: decodeSamples.toSorted((a, b) => a - b)[47], load: loadavg() }
      }).pipe(Effect.provide(Store.layer(workspacePathsFromDir(dir))), Effect.provide(SyncLink.layer), Effect.scoped))
      console.log(`search.query large seed: ${JSON.stringify(report)}`)
      expect(report.backfillMessages).toBe(10_000)
      expect(report.messageSearches).toBeGreaterThan(0)
      perfBudget('search.query: p95 while a backfill writes', report.p95Ms, 20)
      perfBudget('search.query: session p95', report.sessionP95Ms ?? Number.POSITIVE_INFINITY, 20)
      perfBudget('search.query: encode p95', report.encodeP95Ms ?? Number.POSITIVE_INFINITY, 5)
      perfBudget('search.query: decode p95', report.decodeP95Ms ?? Number.POSITIVE_INFINITY, 5)
      expect(report.sessionBytes).toBeLessThanOrEqual(200 * 1024)
      perfBudget('search.query: filtered p95', report.filteredP95Ms ?? Number.POSITIVE_INFINITY, 20)
    } finally {
      await fake.close()
      await rm(dir, { recursive: true, force: true })
    }
  }, 180_000)
})

const measureSession = (sessions: ReturnType<typeof searchSessions>, open: OpenWorkspace, run: number) => Effect.gen(function* () {
  const [first] = yield* serveLiveValue(sessions.stream(open, { sessionId: `bench-${run}`, generation: run, query: parseSearchQuery('rollout') })).pipe(Stream.take(1), Stream.runCollect)
  if (first === undefined) throw new Error('Search session did not publish')
  expect(first.value.groups.flatMap((group) => group.messages)).toHaveLength(SEARCH_WINDOW)
  const encodeStart = performance.now()
  const wire = encode(first.value)
  const encodeMs = performance.now() - encodeStart
  const decodeStart = performance.now()
  decode(wire)
  return { queryMs: first.meta.queryMs, encodeMs, decodeMs: performance.now() - decodeStart, bytes: Buffer.byteLength(JSON.stringify(wire)) }
})

const seedStore = (fake: Awaited<ReturnType<typeof startFakeSlack>>) => Effect.gen(function* () {
  const sql = yield* StoreWriter
  const reader = yield* StoreReader
  const messages = [...fake.workspace.messages].flatMap(([channel, rows]) => rows.map((message) => ({ channel, ts: message.ts, thread_ts: message.thread_ts ?? null, user_id: message.user ?? null, text: message.text ?? '' })))
  expect(messages).toHaveLength(100_000)
  yield* transaction(sql`INSERT INTO conversations ${sql.insert([...fake.workspace.conversations.values()].map((c) => ({ id: c.id, name: c.name, kind: c.kind, is_member: 1 })))}`)
  yield* transaction(sql`INSERT INTO users ${sql.insert([...fake.workspace.users.values()].map((u) => ({ id: u.id, name: u.name ?? '', display_name: `${u.profile?.display_name ?? u.real_name ?? u.name} · Platform engineering and product delivery`, real_name: u.real_name ?? '' })))}`)
  yield* inBatches(messages, (chunk) => sql`INSERT INTO messages ${sql.insert(chunk)}`)
  const topics = [...fake.workspace.messages].flatMap(([channel, rows]) => rows.filter((message) => (message.reply_count ?? 0) > 0).map((message) => ({ topic_id: `t:${channel}:${message.ts}`, channel, kind: 'thread', root_ts: message.ts, last_activity_ts: message.latest_reply ?? message.ts, preview_json: JSON.stringify({ rootText: message.text }) })))
  yield* inBatches(topics, (chunk) => sql`INSERT INTO topic_index ${sql.insert(chunk)}`)
  expect(topics.length).toBeGreaterThan(4_000)
  const count = yield* reader<{ count: number }>`SELECT count(*) AS count FROM messages`
  expect(count[0]?.count).toBe(100_000)
  return { initialMessages: count[0]?.count, topicCount: topics.length }
})
