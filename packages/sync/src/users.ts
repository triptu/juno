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
 * The end of every boot and catch-up runs `fillUsers` again as a sweep. The
 * sweep also asks, once a session, for stored users that have no photo.
 *
 * Slack Connect people the edge has only a profile for (other team,
 * `is_stranger`) need the flags Slack's client sends: without them the edge
 * lists them in `failed_ids` every time, and they showed as "Someone". With
 * them they come back in `pending_ids` first and in `results` about half a
 * second later, so `chunks` asks again as Slack's client does. Ids in
 * `failed_ids` or `invalid_ids` are not asked for again in the session
 * (research section 10, "Users").
 */
import { SlackEdge, type SlackApiError, type SlackAuthRequired } from '@juno/slack'
import type { Message } from '@juno/slack-schema'
import { Invalidation, StoreWriter, transaction, type SqlError } from '@juno/store'
import { Deferred, Effect, Queue } from 'effect'
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

/**
 * Stored users without a photo, not yet asked about in this session. Rows
 * written before photos were built from `avatar_hash` have none; the
 * background sweep asks for them once, so they fill in without a re-sync.
 */
const photolessUserIds = (ctx: SyncContext): Effect.Effect<ReadonlyArray<string>, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const rows = yield* sql<{ id: string }>`SELECT id FROM users WHERE avatar_url IS NULL`
    const ids = rows.map((row) => row.id).filter((id) => !ctx.photoless.has(id) && !ctx.unknownUsers.has(id) && USER_ID.test(id))
    for (const id of ids) ctx.photoless.add(id)
    return ids
  })

/**
 * Fetches `ids` in chunks on `lane`, stores them and re-indexes the topics
 * that were waiting for a name. An id another call is already asking for is
 * not asked again: this waits for that answer to be stored (or to fail), so
 * two pages landing side by side cost one call. An interactive caller does
 * not wait behind a background call, which can be seconds away.
 */
export const fetchUsers = (
  ctx: SyncContext,
  requested: ReadonlyArray<string>,
  lane: Lane = 'background',
): Effect.Effect<void, SlackApiError | SqlError, UsersServices> =>
  Effect.gen(function* () {
    const joinable = (id: string) => {
      const out = ctx.usersInFlight.get(id)
      return out !== undefined && (out.lane === 'interactive' || lane === 'background') ? out : undefined
    }
    const others = new Set(requested.flatMap((id) => joinable(id)?.stored ?? []))
    const ids = requested.filter((id) => joinable(id) === undefined)
    if (ids.length > 0) yield* fetchChunks(ctx, ids, lane)
    for (const answer of others) yield* Deferred.await(answer)
  })

const fetchChunks = (ctx: SyncContext, ids: ReadonlyArray<string>, lane: Lane): Effect.Effect<void, SlackApiError | SqlError, UsersServices> =>
  Effect.gen(function* () {
    const out = { lane, stored: yield* Deferred.make<void>() }
    for (const id of ids) ctx.usersInFlight.set(id, out)
    yield* chunks(ctx, ids, lane).pipe(
      Effect.ensuring(Effect.andThen(Effect.sync(() => {
        for (const id of ids) if (ctx.usersInFlight.get(id) === out) ctx.usersInFlight.delete(id)
      }), Deferred.succeed(out.stored, undefined))),
    )
  })

const chunks = (ctx: SyncContext, ids: ReadonlyArray<string>, lane: Lane): Effect.Effect<void, SlackApiError | SqlError, UsersServices> =>
  Effect.gen(function* () {
    const edge = yield* SlackEdge
    for (let i = 0; i < ids.length; i += ctx.config.usersChunk) {
      let asking = ids.slice(i, i + ctx.config.usersChunk)
      // Slack Connect people come back in `pending_ids` while the edge fetches them from their own
      // team. As Slack's client does, they are asked again up to three times, 0.5, 1 and 1.5 s apart;
      // any still pending are left for the next sweep.
      for (let round = 1; asking.length > 0; round++) {
        const answer = yield* edge.usersInfo(asking, { lane })
        // Ids the edge does not know stay unknown; asking again every sweep would never answer differently.
        const unknown = [...(answer.failed_ids ?? []), ...(answer.invalid_ids ?? [])]
        for (const id of unknown) ctx.unknownUsers.add(id)
        yield* transaction(
          Effect.gen(function* () {
            yield* upsertUsers(answer.results)
            // Taken inside the transaction: a re-index that asked for one of these names has either run already or runs after it.
            yield* reindexTopics(takeWaiting(ctx, [...answer.results.map((user) => user.id), ...unknown]), reindexOptions(ctx))
          }),
        )
        asking = round > 3 ? [] : [...(answer.pending_ids ?? [])]
        if (asking.length > 0) yield* Effect.sleep(500 * round)
      }
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
 * Fetches on the selected lane (interactive by default) and fails only for an expired
 * session: when Slack holds the interactive lane back the ids go to
 * `nameUsers`, which asks on the background lane; any other failure is
 * logged and left to the next sweep.
 */
const fetchSoon = (ctx: SyncContext, ids: ReadonlyArray<string>, lane: Lane = 'interactive'): Effect.Effect<void, SlackAuthRequired | SqlError, UsersServices> =>
  fetchUsers(ctx, ids, lane).pipe(
    Effect.catchTag('SlackRateLimited', () => Effect.sync(() => wantUsers(ctx, ids, true))),
    Effect.catchTags({
      SlackRejected: (error) => Effect.logWarning('sync: users not named', { cause: error }),
      SlackTransportError: (error) => Effect.logWarning('sync: users not named', { cause: error }),
      SlackDecodeError: (error) => Effect.logWarning('sync: users not named', { cause: error }),
    }),
  )

/**
 * Names the people on a page before it lands, so the rows it makes have
 * them at their first paint. Only ids the store lacks cost a call; after the
 * DM and group DM members most pages bring none.
 */
export const nameFirst = (ctx: SyncContext, messages: ReadonlyArray<Message>, lane: Lane = 'interactive'): Effect.Effect<void, SlackAuthRequired | SqlError, UsersServices> =>
  Effect.gen(function* () {
    const ids = (yield* unstored(referencedUserIds(messages))).filter((id) => !ctx.unknownUsers.has(id))
    if (ids.length > 0) yield* fetchSoon(ctx, ids, lane)
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
    if (lane === 'interactive') return yield* fetchSoon(ctx, [...ids])
    for (const id of yield* photolessUserIds(ctx)) ids.add(id)
    yield* fetchUsers(ctx, [...ids], lane)
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
          (error) => Effect.logWarning('sync: users not named', { cause: error }),
        ),
      )
    }).pipe(Effect.catchTag('SqlError', (cause) => Effect.logError('sync: users not stored', { cause }))),
  )
