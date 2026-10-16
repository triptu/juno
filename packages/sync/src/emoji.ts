import { SlackEdge } from '@juno/slack'
import { EdgeEmojisListOk, customEmojiRow, type CustomEmoji } from '@juno/slack-schema'
import { Invalidation, StoreWriter, transaction } from '@juno/store'
import { Effect } from 'effect'

/** Refresh after boot's message work. Keep the old table until every edge page has arrived. */
export const syncEmoji = Effect.fn('sync.emoji')(function* () {
  const edge = yield* SlackEdge
  const sql = yield* StoreWriter
  const invalidation = yield* Invalidation
  const emojis: CustomEmoji[] = []
  const seen = new Set<string>()
  let marker: string | undefined
  do {
    const answer = yield* edge.call('emojis/list', marker === undefined ? {} : { marker }, EdgeEmojisListOk, { lane: 'background' })
    emojis.push(...answer.results)
    marker = answer.next_marker || undefined
    if (marker !== undefined && seen.has(marker)) return
    if (marker !== undefined) seen.add(marker)
  } while (marker !== undefined)
  yield* transaction(Effect.gen(function* () {
    yield* sql`DELETE FROM emoji`
    const unique = [...new Map(emojis.map((emoji) => [emoji.name, emoji])).values()]
    for (let offset = 0; offset < unique.length; offset += 200) {
      const rows = unique.slice(offset, offset + 200).map(customEmojiRow)
      yield* sql`INSERT INTO emoji ${sql.insert(rows)}`
      yield* Effect.yieldNow
    }
    yield* invalidation.invalidate(['emoji'])
  }))
})
