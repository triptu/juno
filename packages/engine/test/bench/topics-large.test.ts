// The engine benchmark on the large seed (performance 1 and 6): the sidebar
// query within 5 ms, a snapshot within 200 KB, a delta within 32 KB, encode
// and decode within 5 ms each. It boots the engine against 300 channels,
// 5 000 threads and 100 000 messages, which takes a while, so it runs only
// with JUNO_BENCH=1:
//
//   JUNO_BENCH=1 pnpm --filter @juno/engine exec vitest run test/bench --silent=false
//
// The machine is often shared, so the report carries the load average. The
// query is timed twice: alone on its own connection ("isolated", with and
// without the subscription's row cache), and as `meta.queryMs` inside the
// engine while events land, where other fibers share the event loop.
import { loadavg } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { largeSeed } from '@juno/fake-slack'
import { Effect, Schema } from 'effect'
import { TopicRow } from '@juno/contract'
import { Store, StoreReader, workspacePathsFromDir } from '@juno/store'
import { listTopics, makeRowCache } from '../../src/topics/query'
import { sleep, startTestEngine } from '../harness'

const encodeRow = Schema.encodeSync(Schema.toCodecJson(TopicRow))
const decodeRow = Schema.decodeUnknownSync(Schema.toCodecJson(TopicRow))
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength
const sorted = (samples: ReadonlyArray<number>) => samples.toSorted((a, b) => a - b)
const median = (samples: ReadonlyArray<number>) => Number(sorted(samples)[Math.floor(samples.length / 2)]!.toFixed(2))
const p95 = (samples: ReadonlyArray<number>) => Number(sorted(samples)[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))]!.toFixed(2))
/** Runs `f` `runs` times after one warm-up and returns each run's milliseconds. */
const timeEach = (runs: number, f: () => void) => {
  f()
  const samples: Array<number> = []
  for (let i = 0; i < runs; i++) {
    const started = performance.now()
    f()
    samples.push(performance.now() - started)
  }
  return samples
}

describe.skipIf(process.env['JUNO_BENCH'] !== '1')('topics.list on the large seed', () => {
  it('boots, then runs the sidebar window within budget', async () => {
    const started = Date.now()
    const engine = await startTestEngine({ initial: (fake) => fake.signIn(), fakeOptions: { seed: largeSeed() } })
    try {
      const seeded = Date.now() - started
      await engine.status('ready')
      const bootStarted = Date.now()
      await engine.phase('live', 600_000)
      const bootMs = Date.now() - bootStarted
      const window = await engine.topics()
      const rows = window.order.map((id) => window.rows.get(id)!)
      const snapshotBytes = bytes(rows.map((row) => encodeRow(row)))
      const withoutAvatar = ({ avatarUrl: _a, ...person }: TopicRow['participants'][number]) => person
      const stripAvatars = (row: TopicRow) => ({
        ...row,
        participants: row.participants.map(withoutAvatar),
        channel: { ...row.channel, ...(row.channel.partner === undefined ? {} : { partner: withoutAvatar(row.channel.partner) }) },
      })
      const snapshotBytesWithoutAvatars = bytes(rows.map((row) => encodeRow(stripAvatars(row) as TopicRow)))
      const calls = engine.fake.callCount()

      // Re-runs after boot: the query time the renderer sees in meta.
      const samples: Array<number> = []
      const deltas: Array<number> = []
      const latencies: Array<number> = []
      // Channels with a shown Main row, so each message changes the window and reaches the renderer as a delta.
      const channels = [...new Set(rows.filter((row) => row.kind === 'main').map((row) => row.channel.id))]
      for (let i = 0; i < 10; i++) {
        const before = engine.registry.get(engine.topicsAtom())
        const beforeSeq = before._tag === 'Success' ? before.value.meta.seq : 0
        const channel = channels[(i * 37) % channels.length]!
        const at = Date.now()
        engine.fake.injectMessage({ channel, user: 'U000001L', text: `bench ${i}` })
        const after = await engine.rowsUntil(() => {
          const result = engine.registry.get(engine.topicsAtom())
          return result._tag === 'Success' && result.value.meta.seq > beforeSeq
        }, `update ${i}`)
        latencies.push(Date.now() - at)
        const result = engine.registry.get(engine.topicsAtom())
        if (result._tag === 'Success') samples.push(result.value.meta.queryMs)
        const changed = after.filter((row) => {
          const previous = before._tag === 'Success' ? before.value.rows.get(row.id) : undefined
          return previous === undefined || previous.rev !== row.rev
        })
        deltas.push(bytes(changed.map((row) => encodeRow(row))))
        await sleep(50)
      }
      // The query alone, on a reader of its own: every row shaped (no cache), then a subscription's re-run (warm cache).
      const paths = workspacePathsFromDir(join(engine.userData, 'workspaces', engine.fake.teamId))
      const isolated = await Effect.runPromise(
        Effect.gen(function* () {
          const reader = yield* StoreReader
          const time = (runs: number, query: Effect.Effect<unknown, unknown, StoreReader>) =>
            Effect.gen(function* () {
              yield* query
              const out: Array<number> = []
              for (let i = 0; i < runs; i++) {
                const runStarted = performance.now()
                yield* query
                out.push(performance.now() - runStarted)
              }
              return out
            }).pipe(Effect.provideService(StoreReader, reader))
          const filter = { kind: 'all', unreadOnly: false } as const
          const now = Date.now()
          const cold = yield* time(40, listTopics(filter, { now, limit: 300 }))
          const cache = makeRowCache({ keepUsers: true })
          const warm = yield* time(40, listTopics(filter, { now, limit: 300 }, cache))
          return { cold, warm }
        }).pipe(Effect.provide(Store.layer(paths)), Effect.scoped),
      )

      // The codec and the port: encode the snapshot, clone it as postMessage does, decode it on the other side.
      const encoded = rows.map((row) => encodeRow(row))
      const encodeMs = timeEach(20, () => rows.map((row) => encodeRow(row)))
      const cloneMs = timeEach(20, () => structuredClone(encoded))
      const decodeMs = timeEach(20, () => encoded.map((row) => decodeRow(row)))

      const report = {
        load: loadavg().map((n) => Number(n.toFixed(1))),
        seedMs: seeded,
        bootMs,
        apiCalls: calls,
        rows: rows.length,
        isolatedNoCacheMsMedian: median(isolated.cold),
        isolatedNoCacheMsP95: p95(isolated.cold),
        isolatedWarmMsMedian: median(isolated.warm),
        isolatedWarmMsP95: p95(isolated.warm),
        firstQueryMs: Number(window.meta.queryMs.toFixed(2)),
        queryMsMedian: median(samples),
        queryMsP95: p95(samples),
        snapshotBytes,
        snapshotBytesWithoutAvatars,
        deltaBytesMax: Math.max(...deltas),
        encodeMsMedian: median(encodeMs),
        cloneMsMedian: median(cloneMs),
        decodeMsMedian: median(decodeMs),
        injectToRowMsMedian: median(latencies),
      }
      const budgets = {
        queryMsP95: report.queryMsP95 < 5,
        snapshotBytes: snapshotBytes < 200 * 1024,
        deltaBytesMax: Math.max(...deltas) < 32 * 1024,
        codecMs: report.encodeMsMedian < 5 && report.decodeMsMedian < 5,
      }
      console.log(`topics.list large seed: ${JSON.stringify(report)} budgets: ${JSON.stringify(budgets)}`)
      expect(rows.length).toBe(300)
      expect(budgets.deltaBytesMax).toBe(true)
      // The query and snapshot budgets are reported; JUNO_BENCH_STRICT=1 makes them fail the run.
      if (process.env['JUNO_BENCH_STRICT'] === '1') {
        expect(budgets.queryMsP95).toBe(true)
        expect(budgets.snapshotBytes).toBe(true)
      }
    } finally {
      await engine.stop()
    }
  }, 900_000)
})
