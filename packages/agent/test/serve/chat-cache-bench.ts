/** Run by the benchmark (chat-cache.perf.ts) in its own process, under Bun so GC can be forced. */
import assert from 'node:assert/strict'
import { Session } from 'node:inspector/promises'
import { writeFileSync } from 'node:fs'
import { CardId, JobId } from '@juno/agent-contract'
import { createChatCache, windowOf } from '../../src/serve/chat'
import { chatFixture } from './cache-fixture'

const percentile = (values: number[], p: number) => values.toSorted((a, b) => a - b)[Math.floor(values.length * p)]!

const fixture = chatFixture(5000)
let source = fixture.source
source.store.db.prepare("INSERT INTO runs (id, op_id, origin, h, clean, started_at) VALUES ('live', 'live', 'owner', 0, 1, ?)").run(source.store.now() + 3_000_000)
source = { ...source, live: { runId: 'live', opId: 'live', origin: 'owner', bubbles: [], status: {} },
  cards: [{ runId: 'live', at: source.store.now() + 3_000_000, card: { _tag: 'task', id: CardId.make('bench-card'), jobId: JobId.make('bench-job'), kind: 'subagent', title: 'Task', where: 'Juno', phase: 'running' } }] }

const gc = () => (globalThis as unknown as { readonly Bun: { readonly gc: (force: boolean) => void } }).Bun.gc(true)
gc()
const initialHeap = process.memoryUsage().heapUsed
const cache = createChatCache(source.store)
const build = () => windowOf(cache.items(source), { _tag: 'latest', limit: 40 })
const write = source.store.db.prepare("INSERT INTO reactions (op_id, target_kind, target_id, by, emoji, at) VALUES (?, 'bubble', 'run-2499:0', 'owner', ?, 0)")
let page = build()
gc()
const warmHeap = process.memoryUsage().heapUsed
const eventMs: number[] = []
const queryMs: number[] = []
const structuralMs: number[] = []
let bytes = 0
const profile = process.env.JUNO_CHAT_PROFILE
const session = profile === undefined ? undefined : new Session()
if (session) {
  session.connect()
  await session.post('Profiler.enable')
  await session.post('Profiler.setSamplingInterval', { interval: 100 })
  await session.post('Profiler.start')
}
try {
  for (let n = 0; n < 110; n++) {
    const start = performance.now()
    const kind = n % 5
    if (kind === 0) write.run(`bench-${n}`, n % 2 ? '👍' : null)
    else if (kind === 1 && source.live) source = { ...source, live: { ...source.live, status: { text: `Working ${n}` } } }
    else if (kind === 2) source = { ...source, cards: source.cards.map((view) => ({ ...view, card: { ...view.card, title: `Task ${n}` } })) }
    else if (kind === 3 && source.live) {
      const id = `live:${n}`
      source.store.db.prepare('INSERT INTO chat_bubbles VALUES (?, ?)').run(id, source.store.now() + 3_000_000 + n)
      source = { ...source, live: { ...source.live, bubbles: [...source.live.bubbles, { id, text: `Bubble ${n}`, body: [{ text: `Bubble ${n}` }] }] } }
    } else {
      source = { ...source, readAt: source.store.now() + 3_000_000 + n }
      source.store.db.prepare('INSERT INTO chat_read VALUES (1, ?) ON CONFLICT (singleton) DO UPDATE SET through_at = excluded.through_at').run(source.readAt)
    }

    const queryStart = performance.now()
    page = build()
    const queryEnd = performance.now()
    const encoded = JSON.stringify(page)
    const end = performance.now()
    bytes = Buffer.byteLength(encoded)
    assert.equal(page.items.length, 40)
    assert.equal(page.moreAbove, true)
    if (kind === 0) {
      const bubble = page.items.find((item) => item._tag === 'juno' && item.id === 'run-2499:0')
      assert(bubble?._tag === 'juno')
      assert.deepEqual(bubble.reactions, n % 2 ? [{ by: 'owner', emoji: '👍' }] : [])
    } else if (kind === 1) assert(encoded.includes(`Working ${n}`))
    else if (kind === 2) assert(encoded.includes(`Task ${n}`))
    else if (kind === 3) assert(encoded.includes(`Bubble ${n}`))
    else assert(page.items.filter((item) => item._tag === 'juno').every((item) => !item.unread))
    if (n >= 10) {
      eventMs.push(end - start)
      if (kind < 3) queryMs.push(queryEnd - queryStart)
      else structuralMs.push(end - start)
    }
  }
  if (session) {
    const result = await session.post('Profiler.stop')
    writeFileSync(`${profile}/cached-${process.pid}.cpuprofile`, JSON.stringify(result.profile))
    session.disconnect()
  }
  gc()
  const retainedHeap = process.memoryUsage().heapUsed - initialHeap
  console.log(JSON.stringify({
    p50: percentile(eventMs, .5), p95: percentile(eventMs, .95), queryP95: percentile(queryMs, .95), structuralP95: percentile(structuralMs, .95),
    warmHeap: warmHeap - initialHeap, retainedHeap, rss: process.memoryUsage().rss, peakRss: process.resourceUsage().maxRSS * 1024,
    bytes, events: eventMs.length, eventMs, queryMs,
  }))
} finally { cache.close(); fixture.close() }
