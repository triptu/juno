import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { Session } from 'node:inspector/promises'
import { loadavg, tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect, Fiber, Queue } from 'effect'
import { describe, expect, it } from 'vitest'
import { largeSeed, startFakeSlack } from '@juno/fake-slack'
import { inBatches, Store, StoreReader, StoreWriter, transaction, workspacePathsFromDir } from '@juno/store'
import { querySearch, searchStatements } from '../../src/search/query'

describe.skipIf(process.env['JUNO_SEARCH_BENCH'] !== '1' && process.env['JUNO_BENCH'] !== '1')('local FTS on 100 k messages', () => {
  it('stays within 20 ms while a backfill writes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'juno-search-bench-'))
    const fake = await startFakeSlack({ seed: largeSeed() })
    try {
      const report = await Effect.runPromise(Effect.gen(function* () {
        const sql = yield* StoreWriter
        const reader = yield* StoreReader
        const messages = [...fake.workspace.messages].flatMap(([channel, rows]) => rows.map((message) => ({ channel, ts: message.ts, thread_ts: message.thread_ts ?? null, text: message.text ?? '' })))
        expect(messages).toHaveLength(100_000)
        yield* transaction(sql`INSERT INTO conversations ${sql.insert([...fake.workspace.conversations.values()].map((c) => ({ id: c.id, name: c.name, kind: c.kind, is_member: 1 })))}`)
        yield* transaction(sql`INSERT INTO users ${sql.insert([...fake.workspace.users.values()].map((u) => ({ id: u.id, name: u.name ?? '', display_name: u.profile?.display_name ?? '', real_name: u.real_name ?? '' })))}`)
        yield* inBatches(messages, (chunk) => sql`INSERT INTO messages ${sql.insert(chunk)}`)
        const topics = [...fake.workspace.messages].flatMap(([channel, rows]) => rows.filter((message) => (message.reply_count ?? 0) > 0).map((message) => ({ topic_id: `t:${channel}:${message.ts}`, channel, kind: 'thread', root_ts: message.ts, last_activity_ts: message.latest_reply ?? message.ts, preview_json: JSON.stringify({ rootText: message.text }) })))
        yield* inBatches(topics, (chunk) => sql`INSERT INTO topic_index ${sql.insert(chunk)}`)
        expect(topics.length).toBeGreaterThan(4_000)
        const count = yield* reader<{ count: number }>`SELECT count(*) AS count FROM messages`
        expect(count[0]?.count).toBe(100_000)

        if (process.env['JUNO_SEARCH_PROFILE'] === '1') {
          for (const [name, statement] of Object.entries(searchStatements(reader, '"deploy"*', 50))) {
            const [query, params] = statement.compile()
            const plan = yield* reader.unsafe<{ detail: string }>(`EXPLAIN QUERY PLAN ${query}`, params)
            const started = performance.now()
            yield* statement
            console.log(`search profile ${name}: ${performance.now() - started} ms, ${JSON.stringify(plan.map((row) => row.detail))}`)
          }
          const profiler = new Session()
          profiler.connect()
          try {
            yield* Effect.promise(() => profiler.post('Profiler.enable'))
            yield* Effect.promise(() => profiler.post('Profiler.start'))
            for (let run = 0; run < 10; run++) yield* querySearch('deploy')
            const { profile } = yield* Effect.promise(() => profiler.post('Profiler.stop'))
            yield* Effect.promise(() => writeFile(join(tmpdir(), 'juno-wp2-search.cpuprofile'), JSON.stringify(profile)))
          } finally { profiler.disconnect() }
        }

        const committed = yield* Queue.unbounded<number>()
        const resume = yield* Queue.unbounded<void>()
        const backfill = yield* Effect.forkChild(Effect.gen(function* () {
          for (let batch = 0; batch < 50; batch++) {
            const rows = Array.from({ length: 200 }, (_, i) => ({ channel: 'C00000L', ts: `1900000000.${String(batch * 200 + i).padStart(6, '0')}`, text: 'Backfill rollout checklist' }))
            yield* transaction(sql`INSERT INTO messages ${sql.insert(rows)}`)
            yield* Queue.offer(committed, rows.length)
            yield* Queue.take(resume)
          }
        }))
        const samples: number[] = []
        let messageSearches = 0
        let writes = 0
        for (let run = 0; run < 50; run++) {
          writes += yield* Queue.take(committed)
          // Let the next transaction overlap the read on the separate WAL connection.
          yield* Queue.offer(resume, undefined)
          const started = performance.now()
          const query = ['roll', 'deploy', 'index missing hotfix rollout'][run % 3] ?? 'deploy'
          const results = yield* querySearch(query)
          samples.push(performance.now() - started)
          if (results.some((result) => result.kind === 'message')) messageSearches++
          expect(results.length).toBeGreaterThan(0)
        }
        yield* Fiber.join(backfill)
        const sorted = samples.toSorted((a, b) => a - b)
        const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? Infinity
        return { initialMessages: count[0]?.count, topicCount: topics.length, backfillMessages: writes, messageSearches, runs: samples.length, minMs: sorted[0], medianMs: sorted[25], maxMs: sorted.at(-1), p95Ms: p95, load: loadavg() }
      }).pipe(Effect.provide(Store.layer(workspacePathsFromDir(dir))), Effect.scoped))
      console.log(`search.query large seed: ${JSON.stringify(report)}`)
      expect(report.backfillMessages).toBe(10_000)
      expect(report.messageSearches).toBeGreaterThan(0)
      expect(report.p95Ms).toBeLessThanOrEqual(20)
    } finally {
      await fake.close()
      await rm(dir, { recursive: true, force: true })
    }
  }, 180_000)
})
