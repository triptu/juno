/**
 * The Reactions view's rows (SPEC 5, "Reactions"): one per message of the
 * user's that someone else reacted to, with the headline Slack's Activity
 * shows (who, which emoji, when), in `reaction_feed`.
 *
 * - `readReactionFeed`: one `activity.feed` page (research
 *   `activity-feed.md`), each entry stored unless its row is as new. The
 *   engine reads it when the view opens and when the socket connects again
 *   while it is open; nothing polls.
 * - `noteFeedReaction`: a `reaction_added` on the user's message by someone
 *   else, while Juno runs, replaces the row's headline.
 * - `fetchFeedMessage`: a row's message the store lacks, one
 *   `conversations.replies`, which answers for a reply (with its thread's
 *   root) and a top-level message alike. A message Slack no longer has
 *   takes its row with it.
 *
 * The reactions themselves stay on the message (`reactions`): a removal
 * changes "+N" through the message and never the headline.
 */
import { tsToMillis, type Ts } from '@juno/domain'
import { SlackApi } from '@juno/slack'
import type { ReactionEvent } from '@juno/slack-schema'
import { StoreWriter, transaction, type SqlError } from '@juno/store'
import { Effect } from 'effect'
import type { SyncContext } from './context'
import { nowTs, type OpenError, type OpenServices } from './openShared'
import { applyPage } from './pages'
import { invalidate, type Writer } from './write/shared'

/** The most entries one `activity.feed` page takes (research `activity-feed.md`). */
const FEED_PAGE = 50

const FEED_KEYS = ['reaction_feed']

interface FeedEntry {
  readonly channel: string
  readonly ts: string
  /** When the latest reaction came, epoch milliseconds. */
  readonly at: number
  readonly user: string
  readonly name: string
}

/**
 * Stores an entry as its message's headline unless the row is as new.
 * `known`: the stored reactions already include it. Returns whether it was
 * new.
 */
const storeEntry = (entry: FeedEntry, known: boolean): Effect.Effect<boolean, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const rows = yield* sql<{ at: number }>`SELECT at FROM reaction_feed WHERE channel = ${entry.channel} AND ts = ${entry.ts}`
    const stored = rows[0]?.at
    if (stored !== undefined && stored >= entry.at) return false
    yield* sql`INSERT INTO reaction_feed (channel, ts, at, user_id, name, known) VALUES (${entry.channel}, ${entry.ts}, ${entry.at}, ${entry.user}, ${entry.name}, ${known ? 1 : 0})
      ON CONFLICT (channel, ts) DO UPDATE SET at = excluded.at, user_id = excluded.user_id, name = excluded.name, known = excluded.known`
    return true
  })

/** Whether the stored message lists `user` among those who reacted with `name`. */
const storedReaction = (entry: FeedEntry): Effect.Effect<boolean, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const rows = yield* sql<{ user_ids_json: string | null }>`SELECT user_ids_json FROM reactions WHERE channel = ${entry.channel} AND ts = ${entry.ts} AND name = ${entry.name}`
    return rows[0]?.user_ids_json?.includes(`"${entry.user}"`) === true
  })

/**
 * A reaction added live. It counts when someone else added it to the
 * user's message: `item_user` says whose message it is, else the stored
 * message does. Runs inside the event's transaction.
 */
export const noteFeedReaction = (ctx: SyncContext, frame: ReactionEvent): Writer =>
  Effect.gen(function* () {
    const self = ctx.me.userId
    if (frame.type !== 'reaction_added' || frame.item.type !== 'message' || frame.user === self) return
    const { channel, ts } = frame.item
    let owner = frame.item_user
    if (owner === undefined) {
      const sql = yield* StoreWriter
      owner = (yield* sql<{ user_id: string | null }>`SELECT user_id FROM messages WHERE channel = ${channel} AND ts = ${ts}`)[0]?.user_id ?? undefined
    }
    if (owner !== self) return
    // The event has just written the reaction to the message, so the stored reactions include it.
    if (yield* storeEntry({ channel, ts, at: tsToMillis(frame.event_ts), user: frame.user, name: frame.reaction }, true)) yield* invalidate(FEED_KEYS)
  })

/**
 * Reads the newest page of the feed and stores each entry newer than its
 * row. Every entry is checked, not only those above the first stored one: a
 * live reaction may have stored a newer row while older ones were missed.
 * Returns how many were new.
 */
export const readReactionFeed = (_ctx: SyncContext): Effect.Effect<number, OpenError, OpenServices> =>
  Effect.gen(function* () {
    const api = yield* SlackApi
    const page = yield* api.call(
      'activity.feed',
      { mode: 'chrono_v1', types: 'message_reaction', limit: FEED_PAGE, archive_only: false, unread_only: false, priority_only: false },
      { lane: 'background', reason: 'reactions' },
    )
    const entries: Array<FeedEntry> = []
    for (const item of page.items) {
      const { message, reaction } = item.item
      const at = Math.round(Number(item.feed_ts) * 1000)
      if (item.item.type !== 'message_reaction' || message === undefined || reaction === undefined || !Number.isFinite(at)) continue
      entries.push({ channel: message.channel, ts: message.ts, at, user: reaction.user, name: reaction.name })
    }
    return yield* transaction(
      Effect.gen(function* () {
        let added = 0
        for (const entry of entries) if (yield* storeEntry(entry, yield* storedReaction(entry))) added += 1
        if (added > 0) yield* invalidate(FEED_KEYS)
        return added
      }),
    )
  })

/** Errors that say Slack no longer has the message for the user. Anything else may pass, so the row stays. */
const GONE = new Set(['thread_not_found', 'message_not_found', 'channel_not_found', 'not_in_channel'])

/**
 * Stores a feed row's message, one `conversations.replies` with the
 * message's ts as both bounds: Slack answers with the thread's root first
 * for a reply, and with the message alone otherwise. Both are stored, so a
 * reply needs no second lookup for its root. A message Slack no longer has
 * drops its row; another failure fails this call and leaves the row.
 */
export const fetchFeedMessage = (ctx: SyncContext, channel: string, ts: string): Effect.Effect<void, OpenError, OpenServices> =>
  Effect.gen(function* () {
    const api = yield* SlackApi
    const requestedAt = yield* nowTs
    const page = yield* api
      .call('conversations.replies', { channel, ts: ts as Ts, oldest: ts, latest: ts, inclusive: true, limit: 2 }, { lane: 'background', reason: 'reactions' })
      .pipe(Effect.catchTag('SlackRejected', (error) => (GONE.has(error.error) ? Effect.succeed(undefined) : Effect.fail(error))))
    const messages = page?.messages ?? []
    yield* transaction(
      Effect.gen(function* () {
        const sql = yield* StoreWriter
        if (messages.length > 0) yield* applyPage(ctx, channel, messages, { kind: 'page', requestedAt })
        if (!messages.some((each) => each.ts === ts)) yield* sql`DELETE FROM reaction_feed WHERE channel = ${channel} AND ts = ${ts}`
        // The answer holds every reaction made before the request.
        else yield* sql`UPDATE reaction_feed SET known = 1 WHERE channel = ${channel} AND ts = ${ts} AND at <= ${tsToMillis(requestedAt)}`
        yield* invalidate(FEED_KEYS)
      }),
    )
  })
