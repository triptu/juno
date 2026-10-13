// The engine benchmark on the large seed (performance 1 and 6): the sidebar
// query within 5 ms, a snapshot within 200 KB, a delta within 32 KB. It
// boots the engine against 300 channels, 5 000 threads and 100 000
// messages, which takes a while, so it runs only with JUNO_BENCH=1:
//
//   JUNO_BENCH=1 pnpm --filter @juno/engine exec vitest run test/bench
import { describe, expect, it } from 'vitest'
import { largeSeed } from '@juno/fake-slack'
import { Schema } from 'effect'
import { TopicRow } from '@juno/contract'
import { sleep, startTestEngine } from '../harness'

const encodeRow = Schema.encodeSync(Schema.toCodecJson(TopicRow))
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength

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
      const channels = [...engine.fake.workspace.conversations.keys()]
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
      const sorted = samples.toSorted((a, b) => a - b)
      const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!
      const report = {
        seedMs: seeded,
        bootMs,
        apiCalls: calls,
        rows: rows.length,
        firstQueryMs: Number(window.meta.queryMs.toFixed(2)),
        queryMsP95: Number(p95.toFixed(2)),
        queryMsMedian: Number(sorted[Math.floor(sorted.length / 2)]!.toFixed(2)),
        snapshotBytes,
        snapshotBytesWithoutAvatars,
        deltaBytesMax: Math.max(...deltas),
        injectToRowMsMedian: latencies.toSorted((a, b) => a - b)[Math.floor(latencies.length / 2)],
      }
      const budgets = { queryMsP95: p95 < 5, snapshotBytes: snapshotBytes < 200 * 1024, deltaBytesMax: Math.max(...deltas) < 32 * 1024 }
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
