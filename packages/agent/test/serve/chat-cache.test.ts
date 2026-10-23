// The chat cache keeps one page and updates it in place. After any change, the warm cache must give the same
// rows as a cache built cold on the same store; a redaction clears every cache on the database.
import { expect, it } from 'bun:test'
import fc from 'fast-check'
import { CardId, JobId } from '@juno/agent-contract'
import { createChatCache, invalidateChatCaches, windowOf, type ChatSource } from '../../src/serve/chat'
import { chatFixture } from './cache-fixture'

/** The rows a fresh cache builds from the store as it is now. */
function cold(source: ChatSource) {
  const cache = createChatCache(source.store)
  try {
    return cache.items(source)
  } finally {
    cache.close()
  }
}

it('after edits, reactions, read marks, live runs, cards and rolled-back writes, the warm cache equals a cold build', () => {
  fc.assert(fc.property(fc.array(fc.record({ kind: fc.integer({ min: 0, max: 12 }), row: fc.integer({ min: 0, max: 9 }) }), { minLength: 1, maxLength: 40 }), (events) => {
    const fixture = chatFixture(20)
    const cache = createChatCache(fixture.source.store)
    let source = fixture.source
    const { db } = source.store
    try {
      cache.items(source)
      for (const [seq, event] of events.entries()) {
        switch (event.kind) {
          case 0:
            db.prepare("INSERT INTO reactions (op_id, target_kind, target_id, by, emoji, at) VALUES (?, 'bubble', ?, 'owner', ?, 0)").run(`react-${seq}`, `run-${event.row}:0`, seq % 2 ? '👍' : null)
            break
          case 1: source = { ...source, readAt: source.store.now() + event.row * 1000 }; break
          case 2: db.prepare('UPDATE messages SET text = ?, version = version + 1 WHERE id = ?').run(`<say>Edited ${seq}</say>`, event.row * 2 + 1); break
          case 3: db.prepare('UPDATE messages SET redacted_gen = 1 WHERE id = ?').run(event.row * 2 + 1); invalidateChatCaches(source.store); break
          case 4: db.prepare('UPDATE inbox SET text = ? WHERE op_id = ?').run(`Changed ${seq}`, `op-${event.row}`); break
          case 5: db.prepare('DELETE FROM messages WHERE id = ?').run(event.row * 2 + 1); break
          case 6: source = { ...source, live: { runId: `run-${event.row}`, opId: `op-${event.row}`, origin: 'owner', bubbles: [{ id: `run-${event.row}:live`, text: `Live ${seq}`, body: [{ text: `Live ${seq}` }] }], status: { text: `Working ${seq}` } } }; break
          case 7:
            source = { ...source, cards: [{ at: source.store.now(), runId: 'run-0', card: { _tag: 'task', id: CardId.make('task-0'), jobId: JobId.make('job-0'), kind: 'subagent', title: `Task ${seq}`, where: 'Juno', phase: seq % 2 ? 'done' : 'running' } }] }
            break
          case 8:
            db.prepare('UPDATE inbox SET data = ? WHERE op_id = ?').run(JSON.stringify({ replyTo: { _tag: 'bubble', id: `run-${event.row}:0` } }), 'op-9')
            db.prepare('UPDATE messages SET text = ? WHERE id = 1').run('<say reply-to="n001">Quoted</say>')
            break
          case 9:
            db.prepare("INSERT INTO sources VALUES (?, 'm1', 'C_TEST', '1.0', ?) ON CONFLICT (run_id, handle) DO UPDATE SET place = excluded.place").run(`run-${event.row}`, `Place ${seq}`)
            db.prepare('UPDATE messages SET text = ? WHERE id = ?').run('<say><src m="m1">Source</src></say>', event.row * 2 + 1)
            break
          case 10:
            db.exec('BEGIN')
            db.prepare('DELETE FROM messages WHERE id = ?').run(event.row * 2 + 1)
            db.exec('ROLLBACK')
            break
          case 11:
            db.prepare("UPDATE run_inputs SET run_id = ? WHERE op_id = 'op-0'").run(`run-${event.row}`)
            break
          case 12:
            db.prepare("INSERT INTO inbox (op_id, kind, text, data, at, state) VALUES (?, 'retry', 'Retry', ?, 0, 'done')").run(`retry-${seq}`, JSON.stringify({ retryOf: 'op-0' }))
            db.prepare("INSERT INTO reactions (op_id, target_kind, target_id, by, emoji, at) VALUES (?, 'owner', ?, 'juno', '👍', 0)").run(`react-${seq}`, `retry-${seq}`)
            break
        }
        // The warm cache reads first, so the bubble times it stores are the ones the cold build reads.
        const warm = cache.items(source)
        expect(warm).toEqual(cold(source))
      }
    } finally { cache.close(); fixture.close() }
  }), { numRuns: 30, seed: 130013 })
})

it('keeps untouched finished rows as they were, and a redaction clears every cache on the database', () => {
  const fixture = chatFixture(20)
  let changes = 0
  const cache = createChatCache(fixture.source.store, () => changes++)
  try {
    const before = cache.items(fixture.source)
    fixture.source.store.db.prepare("INSERT INTO reactions (op_id, target_kind, target_id, by, emoji, at) VALUES ('reaction', 'bubble', 'run-9:0', 'owner', '👍', 0)").run()
    const after = cache.items(fixture.source)
    expect(after.find((item) => item._tag === 'juno' && item.id === 'run-0:0')).toBe(before.find((item) => item._tag === 'juno' && item.id === 'run-0:0'))
    // A removal changes the words in place, which change tracking alone does not see.
    fixture.source.store.db.prepare("UPDATE messages SET redacted_gen = 1 WHERE id = 1").run()
    invalidateChatCaches(fixture.source.store)
    expect(changes).toBe(1)
    expect(cache.items(fixture.source)).toEqual(cold(fixture.source))
  } finally { cache.close(); fixture.close() }
})

it('a read mark in the middle of an answer moves the "New" divider but keeps the answer one group', () => {
  const fixture = chatFixture(2)
  const { db } = fixture.source.store
  const at = fixture.source.store.now()
  // One answer of three bubbles, each shown a second after the one before.
  db.prepare("UPDATE messages SET text = '<say>One.</say><say>Two.</say><say>Three.</say>' WHERE id = 1").run()
  db.prepare('DELETE FROM chat_bubbles').run()
  for (let n = 0; n < 3; n++) db.prepare('INSERT INTO chat_bubbles VALUES (?, ?)').run(`run-0:${n}`, at + 1 + n * 1000)
  const cache = createChatCache(fixture.source.store)
  try {
    const rows = (items: ReturnType<typeof cache.items>) => items.flatMap((item) => (item._tag === 'juno' ? [item.group] : item._tag === 'newDivider' ? ['new'] : []))
    expect(rows(cache.items(fixture.source))).toEqual(['new', 'first', 'middle', 'last'])
    // The first bubble read: the divider moves under it, and no bubble changes its place in the group.
    expect(rows(cache.items({ ...fixture.source, readAt: at + 1 }))).toEqual(['first', 'new', 'middle', 'last'])
  } finally {
    cache.close()
    fixture.close()
  }
})

it('the latest window of a 5,000-message chat fits the 200 KB payload budget', () => {
  const fixture = chatFixture(5000)
  const cache = createChatCache(fixture.source.store)
  try {
    const page = windowOf(cache.items(fixture.source), { _tag: 'latest', limit: 40 })
    expect(page.items).toHaveLength(40)
    expect(page.moreAbove).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(200_000)
  } finally {
    cache.close()
    fixture.close()
  }
})
