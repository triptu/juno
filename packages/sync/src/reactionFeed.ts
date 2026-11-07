/**
 * The Reactions view's rows (SPEC 5, "Reactions"): which of the user's
 * messages someone else reacted to, and when the latest of those reactions
 * came, in `reaction_feed`.
 *
 * - `readReactionFeed`: one `activity.feed` page (research
 *   `activity-feed.md`), newest first, stored until the first entry the
 *   table already has. The engine reads it when the view opens and when
 *   the socket connects again while it is open; nothing polls.
 * - `noteFeedReaction`: a `reaction_added` on the user's message by someone
 *   else, while Juno runs.
 * - `fetchFeedMessages`: the messages of rows the store lacks, or whose
 *   stored reactions may be older than the row (`fetched_at`), one
 *   `conversations.replies` each, which answers for a reply and a top-level
 *   message alike. A message Slack no longer has takes its row with it.
 *
 * The reactions themselves stay on the message (`reactions`), so a removal
 * changes the row through the message, and the row's time stays the latest
 * add the feed or the socket reported.
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
 * Stores an entry unless the table has the same message at the same time or
 * later. `known`: the stored reactions already include it. Returns whether
 * it was new.
 */
const storeEntry = (entry: FeedEntry, known: boolean): Effect.Effect<boolean, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const rows = yield* sql<{ at: number }>`SELECT at FROM reaction_feed WHERE channel = ${entry.channel} AND ts = ${entry.ts}`
    const stored = rows[0]?.at
    if (stored !== undefined && stored >= entry.at) return false
    const fetched = known ? entry.at : null
    yield* sql`INSERT INTO reaction_feed (channel, ts, at, user_id, name, fetched_at) VALUES (${entry.channel}, ${entry.ts}, ${entry.at}, ${entry.user}, ${entry.name}, ${fetched})
      ON CONFLICT (channel, ts) DO UPDATE SET at = excluded.at, user_id = excluded.user_id, name = excluded.name, fetched_at = COALESCE(excluded.fetched_at, reaction_feed.fetched_at)`
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

/** Reads the newest page of the feed and stores it up to the first entry already stored. Returns how many were new. */
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
        for (const entry of entries) {
          if (!(yield* storeEntry(entry, yield* storedReaction(entry)))) break
          added += 1
        }
        if (added > 0) yield* invalidate(FEED_KEYS)
        return added
      }),
    )
  })

/**
 * Stores the messages of feed rows the store lacks. Each is one
 * `conversations.replies` with the message's ts as both bounds: Slack
 * answers with the thread's root first for a reply, and with the message
 * alone otherwise. One Slack refuses for good, or no longer has, drops its row.
 */
export const fetchFeedMessages = (ctx: SyncContext, refs: ReadonlyArray<{ readonly channel: string; readonly ts: string }>): Effect.Effect<void, OpenError, OpenServices> =>
  Effect.forEach(
    refs,
    ({ channel, ts }) =>
      Effect.gen(function* () {
        const api = yield* SlackApi
        const requestedAt = yield* nowTs
        const page = yield* api
          .call('conversations.replies', { channel, ts: ts as Ts, oldest: ts, latest: ts, inclusive: true, limit: 2 }, { lane: 'background', reason: 'reactions' })
          .pipe(Effect.catchTag('SlackRejected', () => Effect.succeed(undefined)))
        const message = page?.messages.find((each) => each.ts === ts)
        yield* transaction(
          Effect.gen(function* () {
            const sql = yield* StoreWriter
            if (message === undefined) yield* sql`DELETE FROM reaction_feed WHERE channel = ${channel} AND ts = ${ts}`
            else {
              yield* applyPage(ctx, channel, [message], { kind: 'page', requestedAt })
              // The answer holds every reaction made before the request; a later one keeps the row stale.
              yield* sql`UPDATE reaction_feed SET fetched_at = MIN(at, ${tsToMillis(requestedAt)}) WHERE channel = ${channel} AND ts = ${ts}`
            }
            yield* invalidate(FEED_KEYS)
          }),
        )
      }),
    { discard: true },
  )
