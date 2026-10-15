/**
 * What every sync step shares: who the user is, the config, and the small
 * in-memory queues that connect steps (roots to fetch, users to name).
 */
import type { Me } from '@juno/domain'
import { Clock, Effect, type Queue } from 'effect'
import type { SyncConfigShape } from './config'

export interface RootFetch {
  readonly channel: string
  readonly ts: string
}

export interface SyncContext {
  /** The user and the user groups they belong to (`client.userBoot.subteams.self`), for the mention rules. */
  me: Me
  readonly config: SyncConfigShape
  /** Messages to fetch again (`conversations.replies`, `limit: 1`): stub roots, and messages whose page was older than an event. A background fiber fetches them. */
  readonly rootFetches: Queue.Queue<RootFetch>
  /** Channels whose Main read pointer Slack must settle (`conversations.info`): an event Juno cannot order, or a page too old to apply. A background fiber asks. */
  readonly readLookups: Queue.Queue<string>
  /**
   * Reactions that arrived for a message the store did not have yet, by
   * `channel:ts`, with the event's `event_ts`. A page that stores the message
   * from a request older than the event queues a fetch of it, so the
   * reaction is not lost to the older snapshot. Bounded; oldest dropped.
   */
  readonly lateReactions: Map<string, string>
  /** Users whose name a preview needed and the users table lacked, with the topics to re-index once they arrive. */
  readonly missingUsers: Map<string, Set<string>>
  /** Ids the edge did not return (`failed_ids`: bots, Slack Connect users). Not asked for again in this session. */
  readonly unknownUsers: Set<string>
  /** Page fetches outside the work permit (opened topics, root fetches) in flight, with when each was requested. */
  readonly fetchesInFlight: Set<{ readonly at: number }>
}

/** Runs a page fetch outside the work permit, so the recheck can wait for it (`awaitEarlierFetches`). */
export const trackFetch = <A, E, R>(ctx: SyncContext, fetch: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(
    Effect.map(Clock.currentTimeMillis, (at) => {
      const entry = { at }
      ctx.fetchesInFlight.add(entry)
      return entry
    }),
    () => fetch,
    (entry) => Effect.sync(() => ctx.fetchesInFlight.delete(entry)),
  )

/**
 * Waits until every tracked fetch requested up to now has landed, so no
 * older answer arrives after the recheck's (specs/catchup.qnt `olderPage`).
 * Fetches end within the request timeout.
 */
export const awaitEarlierFetches = (ctx: SyncContext): Effect.Effect<void> =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    while ([...ctx.fetchesInFlight].some((entry) => entry.at <= now)) yield* Effect.sleep(50)
  })

/** `reindexTopics` options bound to a context: missing names are collected for the users step. */
export const reindexOptions = (ctx: SyncContext) => ({
  me: ctx.me,
  onMissingUser: (userId: string, topicId: string) => {
    let topics = ctx.missingUsers.get(userId)
    if (topics === undefined) {
      topics = new Set()
      ctx.missingUsers.set(userId, topics)
    }
    topics.add(topicId)
  },
})
