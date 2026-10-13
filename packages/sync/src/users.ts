/**
 * Users the mirror lacks: the edge `users/info` call in chunks of 100 on the
 * background lane (architecture 5.2 step 6), then a re-index of the topics
 * whose preview was waiting for a name.
 */
import { SlackEdge, type SlackApiError } from '@juno/slack'
import { Invalidation, StoreWriter, transaction, type SqlError } from '@juno/store'
import { Effect } from 'effect'
import { reindexOptions, type SyncContext } from './context'
import { reindexTopics } from './reindex'
import { upsertUsers } from './write'

/** Ids referenced by messages and conversations that have no `users` row. */
export const unknownUserIds = (): Effect.Effect<ReadonlyArray<string>, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const rows = yield* sql<{ id: string }>`
      SELECT DISTINCT m.user_id AS id FROM messages m LEFT JOIN users u ON u.id = m.user_id
        WHERE m.user_id IS NOT NULL AND u.id IS NULL
      UNION
      SELECT DISTINCT c.user_id AS id FROM conversations c LEFT JOIN users u ON u.id = c.user_id
        WHERE c.user_id IS NOT NULL AND u.id IS NULL`
    return rows.map((r) => r.id).filter((id) => /^[UW][A-Z0-9]+$/.test(id))
  })

/** Fetches `ids` in chunks, stores them and re-indexes the topics that were waiting for a name. */
export const fetchUsers = (
  ctx: SyncContext,
  ids: ReadonlyArray<string>,
): Effect.Effect<void, SlackApiError | SqlError, SlackEdge | StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    if (ids.length === 0) return
    const edge = yield* SlackEdge
    for (let i = 0; i < ids.length; i += ctx.config.usersChunk) {
      const chunk = ids.slice(i, i + ctx.config.usersChunk)
      const answer = yield* edge.usersInfo(chunk, { lane: 'background' })
      const topics = new Set<string>()
      for (const user of answer.results) {
        for (const topic of ctx.missingUsers.get(user.id) ?? []) topics.add(topic)
        ctx.missingUsers.delete(user.id)
      }
      // Ids the edge does not know stay unknown; asking again every sweep would never answer differently.
      for (const id of answer.failed_ids ?? []) {
        ctx.unknownUsers.add(id)
        ctx.missingUsers.delete(id)
      }
      yield* transaction(
        Effect.gen(function* () {
          yield* upsertUsers(answer.results)
          yield* reindexTopics(topics, reindexOptions(ctx))
        }),
      )
      yield* Effect.yieldNow
    }
  })

/** The users step: whatever is unknown in the mirror plus whatever a preview asked for. */
export const fillUsers = (ctx: SyncContext): Effect.Effect<void, SlackApiError | SqlError, SlackEdge | StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const ids = new Set(yield* unknownUserIds())
    for (const id of ctx.missingUsers.keys()) ids.add(id)
    for (const id of ctx.unknownUsers) ids.delete(id)
    yield* fetchUsers(ctx, [...ids])
  })
