/** Reproduce with JUNO_BENCH=1. Alternates the forced and planner-chosen scoped count on one populated store. */
import { expect, it } from 'vitest'
import { Effect } from 'effect'
import { availableParallelism, loadavg } from 'node:os'
import { defaultNotificationSettings } from '@juno/domain'
import { StoreReader, StoreWriter } from '@juno/store'
import { freshStore } from '../../../store/test/helpers'
import { countsStatement } from '../../src/sidebarUnread'
import { badgePolicy, badgeStatement } from '../../src/dockBadge'

const stats = (values: number[]) => {
  const ordered = values.toSorted((a, b) => a - b)
  return { median: ordered[Math.floor(ordered.length / 2)], p95: ordered[Math.floor(ordered.length * 0.95)]!, min: ordered[0], max: ordered.at(-1) }
}

it.skipIf(process.env.JUNO_BENCH !== '1')('compares scoped counts and probes the badge on 5k topics and 100k messages', async () => {
  await Effect.runPromise(Effect.gen(function* () {
    const writer = yield* StoreWriter
    const reader = yield* StoreReader
    yield* writer`WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL SELECT x + 1 FROM n WHERE x < 299)
      INSERT INTO conversations (id, kind, is_member) SELECT 'C' || x, 'im', 1 FROM n`
    yield* writer`WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL SELECT x + 1 FROM n WHERE x < 4999)
      INSERT INTO topic_index (topic_id, channel, kind, root_ts, last_activity_ts, message_count, unread_count, mentions_me)
      SELECT 't:C' || (x % 300) || ':' || printf('%d.000000', 1700000000 + x * 100), 'C' || (x % 300), 'thread',
        printf('%d.000000', 1700000000 + x * 100), printf('%d.000000', 1700000019 + x * 100), 20, CASE WHEN x % 5 = 0 THEN 1 ELSE 0 END, 0 FROM n`
    yield* writer`INSERT INTO thread_subs (channel, thread_ts, subscribed, slack_last_read)
      SELECT channel, root_ts, 1, printf('%d.000000', CAST(root_ts AS INTEGER) + 18) FROM topic_index`
    yield* writer`INSERT INTO topic_reads (topic_id, last_read_ts, observed_at)
      SELECT topic_id, printf('%d.000000', CAST(root_ts AS INTEGER) + 18), '1' FROM topic_index`
    yield* writer`WITH RECURSIVE seq(x) AS (VALUES(0) UNION ALL SELECT x + 1 FROM seq WHERE x < 19)
      INSERT INTO messages (channel, ts, thread_ts, user_id, text, attention)
      SELECT i.channel, printf('%d.000000', CAST(i.root_ts AS INTEGER) + seq.x), i.root_ts, 'OTHER', 'Unread benchmark message', 0 FROM topic_index i CROSS JOIN seq`
    const totals = yield* reader<{ n: number }>`SELECT count(*) AS n FROM messages`
    expect(totals[0]?.n).toBe(100_000)
    const chosen = countsStatement('C15')
    const forced = { ...chosen, sql: chosen.sql.replace('FROM topic_index i\n', 'FROM topic_index i INDEXED BY topic_index_unread\n') }
    expect(forced.sql).not.toBe(chosen.sql)
    const reference = yield* reader.unsafe(chosen.sql, chosen.params)
    expect(reference).toHaveLength(1)
    const samples = { forced: [] as number[], chosen: [] as number[] }
    let queries = 0
    for (let round = 0; round < 5; round++) {
      for (const side of (round % 2 === 0 ? ['forced', 'chosen'] : ['chosen', 'forced']) as ReadonlyArray<'forced' | 'chosen'>) {
        const statement = side === 'forced' ? forced : chosen
        yield* reader.unsafe(statement.sql, statement.params)
        let elapsed = 0
        for (let repeat = 0; repeat < 100; repeat++) {
          const start = performance.now()
          const rows = yield* reader.unsafe(statement.sql, statement.params)
          elapsed += performance.now() - start
          expect(rows).toEqual(reference)
          queries += 1
        }
        samples[side].push(elapsed / 100)
      }
    }
    const badge = badgeStatement(badgePolicy(defaultNotificationSettings, { aiAssist: false, at: { weekday: 1, minutes: 600 } }), 'SELF')
    const badgeTimes: number[] = []
    for (let repeat = 0; repeat < 100; repeat++) {
      const start = performance.now()
      const result = yield* reader.unsafe<{ active: number }>(badge.sql, badge.params)
      badgeTimes.push(performance.now() - start)
      expect(result).toEqual([{ active: 1 }])
    }
    for (const [name, statement] of [['forced', forced], ['chosen', chosen], ['badge', badge]] as const) {
      const plan = yield* reader.unsafe<{ detail: string }>(`EXPLAIN QUERY PLAN ${statement.sql}`, statement.params)
      console.log(name, plan.map((row) => row.detail))
      if (name === 'badge') expect(plan.filter((row) => /^SCAN (i|m|o)\b/.test(row.detail))).toEqual([])
    }
    expect(stats(badgeTimes).p95).toBeLessThan(5)
    console.log('badge query evidence', { topics: 5000, messages: 100000, queries, rounds: 5, millisecondsPerQuery: { forced: stats(samples.forced), chosen: stats(samples.chosen), badge: stats(badgeTimes) }, cores: availableParallelism(), load: loadavg() })
  }).pipe(Effect.provide(freshStore)))
})
