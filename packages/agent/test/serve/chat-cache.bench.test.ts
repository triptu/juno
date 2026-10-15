import { expect, it } from 'vitest'
import { chatItems, createChatCache, windowOf } from '../../src/serve/chat'
import { chatFixture } from './cache-fixture'

it('5,000 messages: event to encoded window stays within the live-update budget', () => {
  const fixture = chatFixture(5000)
  const cache = createChatCache(fixture.source.store)
  const { source } = fixture
  const write = source.store.db.prepare("INSERT INTO reactions (op_id, target_kind, target_id, by, emoji, at) VALUES (?, 'bubble', 'run-2499:0', 'owner', ?, 0)")
  const window = { _tag: 'latest', limit: 40 } as const
  let seq = 0
  const measure = (cached: boolean) => {
    const times: number[] = []
    const heap = process.memoryUsage().heapUsed
    let bytes = 0
    for (let n = 0; n < 35; n++) {
      const start = performance.now()
      write.run(`bench-${seq++}`, n % 2 ? '👍' : null)
      const page = windowOf(cached ? cache.items(source) : chatItems(source), window)
      const encoded = JSON.stringify(page)
      const elapsed = performance.now() - start
      if (n >= 5) times.push(elapsed)
      bytes = Buffer.byteLength(encoded)
      expect(page.items).toHaveLength(40)
      expect(page.moreAbove).toBe(true)
      expect(page.items.at(-1)).toMatchObject({ _tag: 'juno', reactions: n % 2 ? [{ by: 'owner', emoji: '👍' }] : [] })
    }
    times.sort((a, b) => a - b)
    return { p50: times[Math.floor(times.length / 2)]!, p95: times[Math.floor(times.length * .95)]!, heapDelta: process.memoryUsage().heapUsed - heap, rss: process.memoryUsage().rss, bytes }
  }
  try {
    cache.items(source)
    const before = []
    const after = []
    for (let n = 0; n < 5; n++) { before.push(measure(false)); after.push(measure(true)) }
    console.log(JSON.stringify({ messages: 5000, window: 40, before, after }))
    expect(Math.max(...after.map((run) => run.p95))).toBeLessThan(50)
    expect(Math.max(...after.map((run) => run.bytes))).toBeLessThan(200_000)
    expect(windowOf(cache.items(source), window)).toEqual(windowOf(chatItems(source), window))
  } finally { cache.close(); fixture.close() }
})
