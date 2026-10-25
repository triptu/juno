// The topic view's benchmark on the large seed (performance 1, 3.4 and 6):
// a `messages.list` run within 5 ms at p95, a 300-row snapshot within
// 200 KB, deltas within 32 KB, encode and decode within 5 ms each, and the
// `topics.list` snapshot within 200 KB now that people and channels travel
// as refs. It also times opening a 300-message thread the store does not
// have (`topics.open` to the rows in the window) and a cached open (a new
// subscription to its first snapshot). Like the sidebar benchmark it boots
// against 100 000 messages, so it runs only in `bun run perf --unit`. It
// boots on its own: on the sidebar benchmark's shared boot
// (largeSeedEngine.ts) its topic list did not answer after that benchmark's
// injected messages (10-26).
//
// The thread mirrors the M4 gate's fixture (performance 3.4): 300 messages,
// 20 % with an image (dimensions included), 10 % with a code block, a few
// reactions, several senders.
import { loadavg } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import { largeSeed } from '@juno/fake-slack'
import { Effect, Schema } from 'effect'
import { ChannelRef, MessageView, Person, TopicListRow } from '@juno/contract'
import { messagesAtom, openTopic } from '@juno/state'
import { Store, StoreReader, workspacePathsFromDir } from '@juno/store'
import { listMessages, makeMessageCache } from '../../src/messages/query'
import { listTopics, makeRowCache } from '../../src/topics/query'
import { sleep, startTestEngine, waitFor } from '../harness'
import { perfBudget } from '@juno/testing/perf-budget'

const encodeRow = Schema.encodeSync(Schema.toCodecJson(MessageView))
const decodeRow = Schema.decodeUnknownSync(Schema.toCodecJson(MessageView))
const encodeTopic = Schema.encodeSync(Schema.toCodecJson(TopicListRow))
const encodePerson = Schema.encodeSync(Schema.toCodecJson(Person))
const encodeChannel = Schema.encodeSync(Schema.toCodecJson(ChannelRef))
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength
const sorted = (samples: ReadonlyArray<number>) => samples.toSorted((a, b) => a - b)
const median = (samples: ReadonlyArray<number>) => Number(sorted(samples)[Math.floor(samples.length / 2)]!.toFixed(2))
const p95 = (samples: ReadonlyArray<number>) => Number(sorted(samples)[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))]!.toFixed(2))
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

describe('messages.list on the large seed', () => {
  it('opens a 300-message thread and serves its window within budget', async () => {
    const engine = await startTestEngine({ initial: (fake) => fake.signIn(), fakeOptions: { seed: largeSeed() } })
    try {
      await engine.status('ready')
      await engine.phase('live', 600_000)
      const sidebar = await engine.topics()
      const channel = sidebar.rows.get(sidebar.order.find((id) => id.startsWith('m:C'))!)!.channel.id

      // The gate's thread, posted with no events: the store has none of it.
      const fake = engine.fake
      const members = [...fake.workspace.conversation(channel)!.members]
      const start = fake.now() - 2 * 60 * 60 * 1000
      const root = fake.workspace.post({ channel, user: members[0]!, text: 'Benchmark thread: the cutover checklist and what we saw', at: start, silent: true })
      for (let i = 0; i < 299; i++) {
        const user = members[(i * 7) % Math.min(members.length, 6)]!
        const code = i % 10 === 3
        const image = i % 5 === 1
        const w = 800 + ((i * 37) % 1200)
        const h = 400 + ((i * 53) % 900)
        const url = `${fake.url}/files/FB${i}/image.png`
        fake.workspace.post({
          channel,
          user,
          threadTs: root.ts,
          text: code ? `Step ${i} output:\n\`\`\`\nconst lag = ${i * 3}\nawait cutover()\n\`\`\`` : `Step ${i}: replication lag is ${i % 17} seconds, <@${members[1]}> please check the dashboard`,
          at: start + (i + 1) * 20_000,
          silent: true,
          ...(image
            ? { files: [{ id: `FB${i}`, name: 'image.png', title: 'image.png', mimetype: 'image/png', size: w * h, url_private: url, thumb_360: url, thumb_360_w: 360, thumb_360_h: Math.round((h * 360) / w), original_w: w, original_h: h }] }
            : {}),
        })
      }
      const id = `t:${channel}:${root.ts}`
      const atom = messagesAtom(id, { limit: 300 })
      const unmount = engine.registry.mount(atom)
      const window = () => {
        const result = engine.registry.get(atom)
        return result._tag === 'Success' && result.value.meta.seq > 0 ? result.value : undefined
      }
      await waitFor(window, 45_000, 'the empty window')

      // Uncached open: the command, three replies pages over HTTP, the transaction, the query, the port.
      const openStarted = performance.now()
      const opened = await openTopic(engine.registry, id)
      const openCommandMs = performance.now() - openStarted
      const full = await waitFor(() => (window()?.order.length === 300 ? window() : undefined), 45_000, '300 rows')
      const openToRowsMs = performance.now() - openStarted
      expect(opened._tag).toBe('Success')
      const rows = full.order.map((key) => full.rows.get(key)!)

      // Cached open: a new subscription (another window size) to its first snapshot.
      const cachedStarted = performance.now()
      const second = messagesAtom(id, { limit: 299 })
      const unmountSecond = engine.registry.mount(second)
      await waitFor(() => {
        const result = engine.registry.get(second)
        return result._tag === 'Success' && result.value.meta.seq > 0 ? true : undefined
      }, 45_000, 'the cached window')
      const cachedOpenMs = performance.now() - cachedStarted
      unmountSecond()

      // Deltas: replies from another client while the window is open.
      const deltas: Array<number> = []
      const queryMs: Array<number> = []
      const latencies: Array<number> = []
      for (let i = 0; i < 10; i++) {
        const before = window()!
        const at = performance.now()
        fake.injectMessage({ channel, user: members[2]!, threadTs: root.ts, text: `live reply ${i}` })
        const after = await waitFor(() => {
          const current = window()
          return current !== undefined && current.meta.seq > before.meta.seq && current.order !== before.order ? current : undefined
        }, 45_000, `delta ${i}`)
        latencies.push(performance.now() - at)
        queryMs.push(after.meta.queryMs)
        const changed = after.order.filter((key) => before.rows.get(key) !== after.rows.get(key)).map((key) => after.rows.get(key)!)
        deltas.push(bytes(changed.map((row) => encodeRow(row))))
        await sleep(50)
      }
      unmount()

      // The query alone on its own reader: a first run (every body parsed) and a subscription's re-run.
      await engine.handle.stop()
      const paths = workspacePathsFromDir(join(engine.userData, 'workspaces', engine.fake.teamId))
      const isolated = await Effect.runPromise(
        Effect.gen(function* () {
          const reader = yield* StoreReader
          const target = { kind: 'thread', channel, threadTs: root.ts } as const
          const range = { before: 50, limit: 300 }
          const time = (runs: number, query: () => Effect.Effect<unknown, unknown, StoreReader>) =>
            Effect.gen(function* () {
              yield* query()
              const out: Array<number> = []
              for (let i = 0; i < runs; i++) {
                const runStarted = performance.now()
                yield* query()
                out.push(performance.now() - runStarted)
              }
              return out
            }).pipe(Effect.provideService(StoreReader, reader))
          const cold = yield* time(40, () => listMessages(target, range, makeMessageCache()))
          const cache = makeMessageCache()
          const warm = yield* time(40, () => listMessages(target, range, cache))
          const snapshot = yield* listMessages(target, range, makeMessageCache()).pipe(Effect.provideService(StoreReader, reader))
          const mainTarget = { kind: 'main', channel } as const
          const mainCold = yield* time(40, () => listMessages(mainTarget, range, makeMessageCache()))
          const mainCache = makeMessageCache()
          const mainWarm = yield* time(40, () => listMessages(mainTarget, range, mainCache))
          const main = yield* listMessages(mainTarget, range, mainCache)
          expect(main.rows.find(row => row.id === root.ts)?.thread?.preview).toContain('Step 0: replication lag is 0 seconds')
          const topicsRun = yield* listTopics({ kind: 'all', unreadOnly: false }, { now: Date.now(), limit: 300 }, makeRowCache()).pipe(Effect.provideService(StoreReader, reader))
          return { cold, warm, snapshot, topicsRun, mainCold, mainWarm }
        }).pipe(Effect.provide(Store.layer(paths)), Effect.scoped),
      )

      const encoded = rows.map((row) => encodeRow(row))
      const encodeMs = timeEach(20, () => rows.map((row) => encodeRow(row)))
      const decodeMs = timeEach(20, () => encoded.map((row) => decodeRow(row)))
      const snapshotBytes = bytes(encoded)
      const snapshotRefsBytes = bytes((isolated.snapshot.refs?.people ?? []).map((person) => encodePerson(person)))
      const topicsRowsBytes = bytes(isolated.topicsRun.rows.map((row) => encodeTopic(row)))
      const topicsRefsBytes = bytes({
        people: (isolated.topicsRun.refs?.people ?? []).map((person) => encodePerson(person)),
        channels: (isolated.topicsRun.refs?.channels ?? []).map((channel) => encodeChannel(channel)),
      })

      const report = {
        load: loadavg().map((n) => Number(n.toFixed(1))),
        rows: rows.length,
        images: rows.filter((row) => row.files.some((file) => file.thumb !== undefined)).length,
        openCommandMs: Number(openCommandMs.toFixed(1)),
        openToRowsMs: Number(openToRowsMs.toFixed(1)),
        cachedOpenMs: Number(cachedOpenMs.toFixed(1)),
        firstQueryMs: Number(full.meta.queryMs.toFixed(2)),
        isolatedFirstRunMsMedian: median(isolated.cold),
        isolatedFirstRunMsP95: p95(isolated.cold),
        isolatedRerunMsMedian: median(isolated.warm),
        isolatedRerunMsP95: p95(isolated.warm),
        mainFirstRunMsMedian: median(isolated.mainCold),
        mainFirstRunMsP95: p95(isolated.mainCold),
        mainRerunMsMedian: median(isolated.mainWarm),
        mainRerunMsP95: p95(isolated.mainWarm),
        liveQueryMsMedian: median(queryMs),
        liveQueryMsP95: p95(queryMs),
        injectToRowsMsMedian: median(latencies),
        snapshotBytes,
        snapshotRefsBytes,
        deltaBytesMax: Math.max(...deltas),
        encodeMsMedian: median(encodeMs),
        decodeMsMedian: median(decodeMs),
        topicsRowsBytes,
        topicsRefsBytes,
      }
      const budgets = {
        rerunP95: report.isolatedRerunMsP95 <= 5,
        mainRerunP95: report.mainRerunMsP95 <= 5,
        liveQueryP95: report.liveQueryMsP95 <= 5,
        snapshot: snapshotBytes <= 200 * 1024,
        delta: report.deltaBytesMax <= 32 * 1024,
        codec: report.encodeMsMedian <= 5 && report.decodeMsMedian <= 5,
        topicsSnapshot: topicsRowsBytes <= 200 * 1024,
      }
      console.log(`messages.list large seed: ${JSON.stringify(report)} budgets: ${JSON.stringify(budgets)}`)
      expect(rows.length).toBe(300)
      expect(budgets.snapshot).toBe(true)
      expect(budgets.delta).toBe(true)
      expect(budgets.topicsSnapshot).toBe(true)
      perfBudget('messages.list: thread rerun p95', report.isolatedRerunMsP95, 5)
      perfBudget('messages.list: Main rerun p95', report.mainRerunMsP95, 5)
      perfBudget('messages.list: live query p95', report.liveQueryMsP95, 5)
      perfBudget('messages.list: encode median', report.encodeMsMedian, 5)
      perfBudget('messages.list: decode median', report.decodeMsMedian, 5)
    } finally {
      await engine.stop()
    }
  }, 900_000)
})
