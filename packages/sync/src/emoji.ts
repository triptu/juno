import { SlackEdge } from '@juno/slack'
import { EdgeEmojisListOk, customEmojiRow, type CustomEmoji, type EmojiChangedEvent } from '@juno/slack-schema'
import { Invalidation, StoreWriter, transaction, type SqlError } from '@juno/store'
import { Effect } from 'effect'

/** Refresh beside the boot (`run/boot.ts`). Keep the old table until every edge page has arrived. */
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

/** An `emoji_changed` frame: one emoji added, renamed or removed while the app runs. Call inside a transaction. */
export const applyEmojiChange = (frame: EmojiChangedEvent): Effect.Effect<void, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const invalidation = yield* Invalidation
    const removed = frame.subtype === 'remove' ? (frame.names ?? []) : frame.subtype === 'rename' && frame.old_name !== undefined ? [frame.old_name] : []
    const name = frame.subtype === 'add' ? frame.name : frame.subtype === 'rename' ? frame.new_name : undefined
    if (removed.length > 0) yield* sql`DELETE FROM emoji WHERE name IN ${sql.in(removed)}`
    if (name !== undefined && frame.value !== undefined) {
      const row = customEmojiRow({ name, value: frame.value })
      yield* sql`INSERT INTO emoji ${sql.insert(row)} ON CONFLICT (name) DO UPDATE SET url = excluded.url, alias_for = excluded.alias_for`
    }
    if (removed.length > 0 || name !== undefined) yield* invalidation.invalidate(['emoji'])
  })

/** `refresh`, unless one is already running: a socket that drops again while the list pages through starts no second read. */
export const oneAtATime = <E, R>(refresh: Effect.Effect<boolean, E, R>): Effect.Effect<boolean, E, R> => {
  let running = false
  return Effect.suspend(() => {
    if (running) return Effect.succeed(true)
    running = true
    return refresh.pipe(Effect.ensuring(Effect.sync(() => { running = false })))
  })
}
