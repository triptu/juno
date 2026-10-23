import { expect, it } from 'bun:test'
import fc from 'fast-check'
import { BubbleId, CardId, JobId, OpId } from '@juno/agent-contract'
import { createChatCache, invalidateChatCaches, windowOf } from '../../src/serve/chat'
import { chatItems } from './full-rebuild'
import { chatFixture } from './cache-fixture'

it('cached pages equal full rebuilds after arbitrary edits, reactions, read marks and archive changes', () => {
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
          case 6: source = { ...source, live: { runId: `run-${event.row}`, opId: `op-${event.row}`, origin: 'owner', bubbles: [{ id: `run-${event.row}:live`, text: `Live ${seq}`, body: [{ text: `Live ${seq}` }] }], status: { text: `Working ${seq}` } } }; break
        }
        const cached = cache.items(source)
        const full = chatItems(source)
        expect(cached).toEqual(full)
        for (const window of [
          { _tag: 'latest', limit: 5 }, { _tag: 'unread', limit: 5 },
          { _tag: 'around', anchor: BubbleId.make(`run-${event.row}:0`), before: 2, limit: 5 },
          { _tag: 'above', anchor: OpId.make(`op-${event.row}`), limit: 5 }, { _tag: 'below', anchor: OpId.make(`op-${event.row}`), limit: 5 },
        ] as const) expect(windowOf(cached, window)).toEqual(windowOf(full, window))
      }
    } finally { cache.close(); fixture.close() }
  }), { numRuns: 30, seed: 130013 })
})

it('keeps untouched finished rows and clears every attached cache on redaction', () => {
  const fixture = chatFixture(20)
  let changes = 0
  const cache = createChatCache(fixture.source.store, () => changes++)
  try {
    const before = cache.items(fixture.source)
    fixture.source.store.db.prepare("INSERT INTO reactions (op_id, target_kind, target_id, by, emoji, at) VALUES ('reaction', 'bubble', 'run-9:0', 'owner', '👍', 0)").run()
    const after = cache.items(fixture.source)
    expect(after.find((item) => item._tag === 'juno' && item.id === 'run-0:0')).toBe(before.find((item) => item._tag === 'juno' && item.id === 'run-0:0'))
    invalidateChatCaches(fixture.source.store)
    expect(changes).toBe(1)
    expect(cache.items(fixture.source)).toEqual(chatItems(fixture.source))
  } finally { cache.close(); fixture.close() }
})
