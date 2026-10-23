import { expect, it } from 'bun:test'
import { createChatCache } from '../../src/serve/chat'
import { chatFixture } from './cache-fixture'

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
    const bubbles = (items: ReturnType<typeof cache.items>) => items.flatMap((item) => (item._tag === 'juno' ? [item.group] : []))
    const unread = cache.items(fixture.source)
    expect(unread.map((item) => item._tag)).toEqual(['day', 'owner', 'newDivider', 'juno', 'juno', 'juno'])
    expect(bubbles(unread)).toEqual(['first', 'middle', 'last'])

    // The first bubble read: the divider moves under it, and no bubble changes its place in the group.
    const read = cache.items({ ...fixture.source, readAt: at + 1 })
    expect(read.map((item) => item._tag)).toEqual(['day', 'owner', 'juno', 'newDivider', 'juno', 'juno'])
    expect(bubbles(read)).toEqual(['first', 'middle', 'last'])
  } finally {
    cache.close()
    fixture.close()
  }
})
