/**
 * Names for the people the mirror shows, from the edge `users/info` in
 * chunks of 100 (architecture 5.2 step 6).
 *
 * A row should never show a raw user id, so names come early and on the
 * interactive lane:
 *
 * - right after `client.counts`, the other side of every DM and group DM
 *   the user is in, plus anyone the store already references (`fillUsers`);
 * - before a boot page lands, the senders, mentions and repliers on it that
 *   the store lacks (`nameFirst`), so the rows it makes have their names;
 * - anyone else as soon as they appear (an event, a page the sync did not
 *   name first, a preview that asked): `wantUsers` wakes `nameUsers`, a
 *   fiber that fetches them in small batches.
 *
 * The end of every boot and catch-up runs `fillUsers` again as a sweep.
 * Live, the edge answers every id it is asked about, Slack Connect users
 * included (research section 10, "Users").
 */
import { SlackEdge, type SlackApiError, type SlackAuthRequired } from '@juno/slack'
import type { Message } from '@juno/slack-schema'
import { Invalidation, StoreWriter, transaction, type SqlError } from '@juno/store'
import { Effect, Queue } from 'effect'
import { reindexOptions, wantUsers, type SyncContext } from './context'
import { reindexTopics } from './reindex'
import { upsertUsers } from './write'

export { wantUsers } from './context'

type Lane = 'interactive' | 'background'
type UsersServices = SlackEdge | StoreWriter | Invalidation

const USER_ID = /^[UW][A-Z0-9]+$/
const MENTION = /<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g

/** Every user a message shows: its sender, the people it mentions and the people who replied to it. */
export const referencedUserIds = (messages: ReadonlyArray<Message>): ReadonlySet<string> => {
  const ids = new Set<string>()
  for (const message of messages) {
    if (message.user !== undefined) ids.add(message.user)
    for (const id of message.reply_users ?? []) ids.add(id)
    for (const match of (message.text ?? '').matchAll(MENTION)) ids.add(match[1]!)
  }
  for (const id of ids) if (!USER_ID.test(id)) ids.delete(id)
  return ids
}

/** The ids among `ids` with no `users` row. */
const unstored = (ids: Iterable<string>): Effect.Effect<ReadonlyArray<string>, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const all = [...ids]
    if (all.length === 0) return []
    const sql = yield* StoreWriter
    const known = new Set<string>()
    for (let i = 0; i < all.length; i += 500) {
      for (const row of yield* sql<{ id: string }>`SELECT id FROM users WHERE id IN ${sql.in(all.slice(i, i + 500))}`) known.add(row.id)
    }
    return all.filter((id) => !known.has(id))
  })

/**
 * Ids the store references and has no `users` row for: senders, the other
 * side of a DM, the members of the group DMs the user is in, the people who
 * replied to a thread, and mentions.
 */
export const unknownUserIds = (): Effect.Effect<ReadonlyArray<string>, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const ids = new Set<string>()
    const rows = yield* sql<{ id: string }>`
      SELECT DISTINCT m.user_id AS id FROM messages m LEFT JOIN users u ON u.id = m.user_id
        WHERE m.user_id IS NOT NULL AND u.id IS NULL
      UNION
      SELECT DISTINCT c.user_id AS id FROM conversations c LEFT JOIN users u ON u.id = c.user_id
        WHERE c.user_id IS NOT NULL AND u.id IS NULL
      UNION
      SELECT DISTINCT member.value AS id FROM conversations c, json_each(c.member_ids_json) member
        LEFT JOIN users u ON u.id = member.value
        WHERE c.kind = 'mpim' AND c.is_member = 1 AND u.id IS NULL
      UNION
      SELECT DISTINCT r.value AS id FROM messages m, json_each(m.reply_users_json) r
        LEFT JOIN users u ON u.id = r.value
        WHERE m.reply_users_json IS NOT NULL AND u.id IS NULL`
    for (const row of rows) ids.add(row.id)
    // Mentions live inside the text; only messages that have one are read.
    const mentioning = yield* sql<{ text: string }>`SELECT text FROM messages WHERE text LIKE '%<@%'`
    for (const row of mentioning) for (const match of row.text.matchAll(MENTION)) ids.add(match[1]!)
    return yield* unstored([...ids].filter((id) => USER_ID.test(id)))
  })

/** Fetches `ids` in chunks on `lane`, stores them and re-indexes the topics that were waiting for a name. */
export const fetchUsers = (
  ctx: SyncContext,
  ids: ReadonlyArray<string>,
  lane: Lane = 'background',
): Effect.Effect<void, SlackApiError | SqlError, UsersServices> =>
  Effect.gen(function* () {
    if (ids.length === 0) return
    const edge = yield* SlackEdge
    for (let i = 0; i < ids.length; i += ctx.config.usersChunk) {
      const chunk = ids.slice(i, i + ctx.config.usersChunk)
      const answer = yield* edge.usersInfo(chunk, { lane })
      // Ids the edge does not know stay unknown; asking again every sweep would never answer differently.
      for (const id of answer.failed_ids ?? []) ctx.unknownUsers.add(id)
      yield* transaction(
        Effect.gen(function* () {
          yield* upsertUsers(answer.results)
          // Taken inside the transaction: a re-index that asked for one of these names has either run already or runs after it.
          yield* reindexTopics(takeWaiting(ctx, [...answer.results.map((user) => user.id), ...(answer.failed_ids ?? [])]), reindexOptions(ctx))
        }),
      )
      yield* Effect.yieldNow
    }
  })

/** Removes `ids` from the wanted list and returns the topics that were waiting for them. */
const takeWaiting = (ctx: SyncContext, ids: ReadonlyArray<string>): ReadonlySet<string> => {
  const topics = new Set<string>()
  for (const id of ids) {
    for (const topic of ctx.missingUsers.get(id) ?? []) topics.add(topic)
    ctx.missingUsers.delete(id)
  }
  return topics
}

/**
 * Fetches on the interactive lane and never fails but for an expired
 * session: when Slack holds the interactive lane back the ids go to
 * `nameUsers`, which asks on the background lane; any other failure is
 * logged and left to the next sweep.
 */
const fetchSoon = (ctx: SyncContext, ids: ReadonlyArray<string>): Effect.Effect<void, SlackAuthRequired | SqlError, UsersServices> =>
  fetchUsers(ctx, ids, 'interactive').pipe(
    Effect.catchTag('SlackRateLimited', () => Effect.sync(() => wantUsers(ctx, ids, true))),
    Effect.catchTags({
      SlackRejected: (error) => Effect.logWarning('sync: users not named', { tag: error._tag }),
      SlackTransportError: (error) => Effect.logWarning('sync: users not named', { tag: error._tag }),
      SlackDecodeError: (error) => Effect.logWarning('sync: users not named', { tag: error._tag }),
    }),
  )

/**
 * Names the people on a page before it lands, so the rows it makes have
 * them at their first paint. Only ids the store lacks cost a call; after the
 * DM and group DM members most pages bring none.
 */
export const nameFirst = (ctx: SyncContext, messages: ReadonlyArray<Message>): Effect.Effect<void, SlackAuthRequired | SqlError, UsersServices> =>
  Effect.gen(function* () {
    const ids = (yield* unstored(referencedUserIds(messages))).filter((id) => !ctx.unknownUsers.has(id))
    if (ids.length > 0) yield* fetchSoon(ctx, ids)
  })

/**
 * The users step: whatever the store references and lacks plus whatever a
 * preview asked for. Interactive right after `client.counts`, so DM and
 * group DM rows have their names; background as the sweep at the end.
 */
export const fillUsers = (ctx: SyncContext, lane: Lane = 'background'): Effect.Effect<void, SlackApiError | SqlError, UsersServices> =>
  Effect.gen(function* () {
    const ids = new Set(yield* unknownUserIds())
    // Every message that lands wants its people; most are stored already and only need their waiting topics re-indexed.
    const wanted = [...ctx.missingUsers.keys()]
    const missing = new Set(yield* unstored(wanted))
    const stored = wanted.filter((id) => !missing.has(id))
    if (stored.length > 0) yield* transaction(reindexTopics(takeWaiting(ctx, stored), reindexOptions(ctx)))
    for (const id of missing) ids.add(id)
    for (const id of ctx.unknownUsers) ids.delete(id)
    if (lane === 'interactive') yield* fetchSoon(ctx, [...ids])
    else yield* fetchUsers(ctx, [...ids], lane)
  })

/**
 * The fiber that names people as soon as they appear. It wakes when
 * `wantUsers` (or a re-index missing a name) asks, waits
 * `usersBatchMillis` so one call carries everyone a burst of events or
 * pages brought, and fetches the ids the store still lacks. Ids whose
 * topics were re-indexed before their name landed are re-indexed again.
 */
export const nameUsers = (ctx: SyncContext): Effect.Effect<never, SlackAuthRequired, UsersServices> =>
  Effect.forever(
    Effect.gen(function* () {
      yield* Queue.take(ctx.usersWanted)
      yield* Effect.sleep(ctx.config.usersBatchMillis)
      const background = ctx.usersOnBackground
      ctx.usersOnBackground = false
      const wanted = [...ctx.missingUsers.keys()].filter((id) => !ctx.unknownUsers.has(id) && USER_ID.test(id))
      const missing = new Set(yield* unstored(wanted))
      // Stored meanwhile (a page named them first): only their waiting topics need the name.
      const stored = wanted.filter((id) => !missing.has(id))
      if (stored.length > 0) yield* transaction(reindexTopics(takeWaiting(ctx, stored), reindexOptions(ctx)))
      if (missing.size === 0) return
      if (!background) return yield* fetchSoon(ctx, [...missing])
      yield* fetchUsers(ctx, [...missing], 'background').pipe(
        Effect.catchIf(
          (error) => error._tag !== 'SlackAuthRequired' && error._tag !== 'SqlError',
          (error) => Effect.logWarning('sync: users not named', { tag: error._tag }),
        ),
      )
    }).pipe(Effect.catchTag('SqlError', (cause) => Effect.logError('sync: users not stored', { cause }))),
  )
