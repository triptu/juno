/**
 * Handlers for Home (`contract/src/routes/home.ts`).
 *
 * `home.view` follows the open workspace like the other live queries and
 * reads only the local cache (`query.ts`). With AI assist on, a run that
 * shows an item with no current title rewrite asks the assistant for one
 * in the background (`homeTitle`, once per item and activity, inside
 * Home's budget); the answer lands in `ai_cache`, which re-runs the query.
 * So rewrites are asked for only while Home is on screen, and only after
 * the first sync, when the people they name are known.
 *
 * `home.visit` and `home.markDone` are small local writes.
 */
import { AiProvider, tasks } from '@juno/ai'
import { HomeRoutes, NotSignedIn } from '@juno/contract'
import { Invalidation, keys, liveQuery, StoreReader, StoreWriter, transaction, type InvalidationKeys, type SqlError } from '@juno/store'
import { Clock, Effect, Stream } from 'effect'
import { retryFirstRun, serveLiveValue, timed } from '../protocol/live'
import { Workspace, type OpenWorkspace, type StoreServices } from '../workspace'
import { decideAndStore, HOME_DAILY_BUDGET, recentMessages, usedToday } from './assist'
import { readHome, type HomeRun } from './query'

const KEYS: InvalidationKeys = [
  'topics',
  'topic_overlay',
  'topic_reads',
  'conversations',
  'users',
  'ignored_channels',
  'thread_subs',
  'prefs',
  'topic_art',
  'team',
  'ai_cache',
  'follow_ups',
  'topic_visits',
  'sync_state',
]

/** Visits kept; Home reads only the newest. */
const VISITS_KEPT = 20
/** Messages a title rewrite reads. */
const REWRITE_MESSAGES = 8

export const HomeHandlers = HomeRoutes.toLayer(
  Effect.gen(function* () {
    const workspace = yield* Workspace
    const provider = yield* AiProvider
    const scope = yield* Effect.scope
    /** Items asked about, by workspace, with the activity they were asked at, so one is asked once until its topic moves. */
    const asked = new Map<string, Map<string, string>>()

    const rewrite = (open: OpenWorkspace, run: HomeRun): Effect.Effect<void> => {
      const memory = asked.get(open.id) ?? new Map<string, string>()
      asked.set(open.id, memory)
      const due = run.rewritable.filter(({ item, row }) => memory.get(item.id) !== (row.last_activity_ts ?? ''))
      if (due.length === 0) return Effect.void
      for (const { item, row } of due) memory.set(item.id, row.last_activity_ts ?? '')
      const work: Effect.Effect<void, SqlError, StoreServices | AiProvider> = Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        const left = HOME_DAILY_BUDGET - (yield* usedToday(now))
        const sql = yield* StoreReader
        const selfId = (yield* sql<{ self_user_id: string | null }>`SELECT self_user_id FROM team LIMIT 1`)[0]?.self_user_id ?? undefined
        yield* Effect.forEach(
          due.slice(0, Math.max(0, left)),
          ({ item, row }) =>
            Effect.gen(function* () {
              if (item.kind !== 'waiting' && item.kind !== 'resume' && item.kind !== 'moved') return
              const topic = item.topics[0]
              if (topic === undefined) return
              const messages = yield* recentMessages(row, selfId, REWRITE_MESSAGES)
              yield* decideAndStore(tasks.homeTitle, { itemId: item.id, kind: item.kind, title: topic.title, channel: topic.place, newCount: row.unread_count, messages })
            }),
          { concurrency: 2, discard: true },
        )
      })
      return work.pipe(
        Effect.catch((error) => Effect.logWarning('home: a title rewrite failed', error)),
        Effect.provide(open.context),
        Effect.provideService(AiProvider, provider),
        Effect.forkIn(scope),
        Effect.asVoid,
      )
    }

    // One stream per subscription: `serveLiveValue` remembers the last value it sent.
    const view = () =>
      serveLiveValue(
        workspace.changes.pipe(
          Stream.switchMap((open) =>
            open === undefined
              ? Stream.empty
              : liveQuery(
                  KEYS,
                  timed(readHome().pipe(Effect.tap((run) => (run.aiAssist && run.view.ready ? rewrite(open, run) : Effect.void)))).pipe(
                    Effect.map((timedRun) => ({ value: timedRun.value.view, queryMs: timedRun.queryMs })),
                  ),
                ).pipe(Stream.provide(open.context)),
          ),
        ),
      ).pipe(retryFirstRun('home.view'), Stream.orDie)

    /** Runs a write in the open workspace's store. A store failure is a bug (architecture 2.6). */
    const write = (effect: Effect.Effect<void, SqlError, StoreWriter | Invalidation>): Effect.Effect<void, NotSignedIn> =>
      Effect.gen(function* () {
        const open = yield* workspace.current
        if (open === undefined) return yield* new NotSignedIn()
        yield* transaction(effect).pipe(Effect.provide(open.context), Effect.orDie)
      })

    return {
      'home.view': () => view(),
      'home.visit': ({ id }) =>
        write(
          Effect.gen(function* () {
            const sql = yield* StoreWriter
            const now = String(yield* Clock.currentTimeMillis)
            yield* sql`INSERT INTO topic_visits (topic_id, seen_at) VALUES (${id}, ${now}) ON CONFLICT (topic_id) DO UPDATE SET seen_at = excluded.seen_at`
            yield* sql`DELETE FROM topic_visits WHERE topic_id NOT IN (SELECT topic_id FROM topic_visits ORDER BY seen_at DESC LIMIT ${VISITS_KEPT})`
            yield* (yield* Invalidation).invalidate(keys.topicVisits)
          }),
        ),
      'home.markDone': ({ topicId, messageTs }) =>
        write(
          Effect.gen(function* () {
            const sql = yield* StoreWriter
            const now = String(yield* Clock.currentTimeMillis)
            yield* sql`UPDATE follow_ups SET done_at = ${now} WHERE topic_id = ${topicId} AND message_ts = ${messageTs} AND done_at IS NULL`
            yield* (yield* Invalidation).invalidate(keys.followUps)
          }),
        ),
    }
  }),
)
