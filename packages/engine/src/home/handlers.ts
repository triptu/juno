/**
 * Handlers for Home (`contract/src/routes/home.ts`).
 *
 * `home.view` follows the open workspace like the other live queries and
 * reads only the local cache (`query.ts`). With AI assist on, a run that
 * shows an item with no current title rewrite asks the assistant for one
 * in the background (`homeTitle`, once per item and activity, inside
 * Home's budget); the answer lands in `ai_cache`, which re-runs the query.
 * So rewrites are asked for only while Home is on screen, and only once
 * Home is ready, when the people they name are known.
 *
 * `home.visit`, `home.markDone`, `home.movesShown` and `home.movesSeen` are
 * small local writes, as are the reviews' commands on follow-ups and drafts; each of
 * those returns the undo that puts the row back as it was stored.
 */
import { AiProvider, tasks } from '@juno/ai'
import { HomeRoutes, NotSignedIn, type CommandResult, type UndoCommand } from '@juno/contract'
import { Invalidation, keys, liveQuery, prefs, StoreReader, StoreWriter, transaction, type InvalidationKeys, type SqlError } from '@juno/store'
import { Clock, Effect, Stream } from 'effect'
import { retryFirstRun, serveLiveValue, timed } from '../protocol/live'
import { aiJobsOn } from '../ai'
import { aiWakes } from '../aiCredentials'
import { Workspace, type OpenWorkspace, type StoreServices } from '../workspace'
import { decideAndStore, HOME_DAILY_BUDGET, recentMessages, usedToday } from './assist'
import { MOVES_SHOWN_PREF } from './moves'
import { readHome, type HomeRun } from './query'

/** Invalidated when a review deletes, keeps or restores a draft. */
const DRAFT_REVIEWS = 'draft_reviews'

const KEYS: InvalidationKeys = [
  'huddle_history',
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
  'automated_channels',
  'automated_moves',
  'sidebar_views',
  // Old drafts: the reviews' own writes. A draft being typed changes nothing Home shows: a draft that new is never old.
  DRAFT_REVIEWS,
]

type FollowUpRow = { done_at: string | null; match_kept_ts: string | null }
type DraftRow = { text: string; updated_at: string; kept_at: string | null }

/** Visits kept; Home reads only the newest. */
const VISITS_KEPT = 20
/** Messages a title rewrite reads. */
const REWRITE_MESSAGES = 8

export const HomeHandlers = HomeRoutes.toLayer(
  Effect.gen(function* () {
    const workspace = yield* Workspace
    const provider = yield* AiProvider
    const wakes = yield* aiWakes
    const jobs = yield* aiJobsOn
    const scope = yield* Effect.scope
    /** Items asked about, by workspace, with the activity they were asked at, so one is asked once until its topic moves. */
    const asked = new Map<string, Map<string, string>>()

    const rewrite = (open: OpenWorkspace, run: HomeRun, revision: string): Effect.Effect<void> => {
      const memory = asked.get(open.id) ?? new Map<string, string>()
      asked.set(open.id, memory)
      const due = run.rewritable.filter(({ item, row }) => memory.get(item.id) !== `${revision}:${row.last_activity_ts ?? ''}`)
      if (due.length === 0) return Effect.void
      for (const { item, row } of due) memory.set(item.id, `${revision}:${row.last_activity_ts ?? ''}`)
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
          Stream.zipLatest(wakes),
          Stream.switchMap(([open, revision]) =>
            open === undefined
              ? Stream.empty
              : liveQuery(
                  KEYS,
                  timed(readHome().pipe(Effect.tap((run) => (jobs && run.aiAssist && run.view.ready ? rewrite(open, run, revision) : Effect.void)))).pipe(
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

    /** Runs a write that returns its undo. */
    const command = (effect: Effect.Effect<UndoCommand | undefined, SqlError, StoreWriter | Invalidation>): Effect.Effect<CommandResult, NotSignedIn> =>
      Effect.gen(function* () {
        const open = yield* workspace.current
        if (open === undefined) return yield* new NotSignedIn()
        const undo = yield* transaction(effect).pipe(Effect.provide(open.context), Effect.orDie)
        return undo === undefined ? {} : { undo }
      })

    const followUp = (topicId: string, messageTs: string) =>
      Effect.gen(function* () {
        const sql = yield* StoreWriter
        return (yield* sql<FollowUpRow>`SELECT done_at, match_kept_ts FROM follow_ups WHERE topic_id = ${topicId} AND message_ts = ${messageTs}`)[0]
      })
    const followUpUndo = (topicId: string, messageTs: string, row: FollowUpRow): UndoCommand => ({ _tag: 'followUps.restore', topicId, messageTs, doneAt: row.done_at, matchKeptTs: row.match_kept_ts })
    const draft = (topicId: string) =>
      Effect.gen(function* () {
        const sql = yield* StoreWriter
        return (yield* sql<DraftRow>`SELECT text, updated_at, kept_at FROM drafts WHERE topic_id = ${topicId}`)[0]
      })
    const draftUndo = (topicId: string, row: DraftRow): UndoCommand => ({ _tag: 'drafts.restore', topicId, text: row.text, updatedAt: row.updated_at, keptAt: row.kept_at })
    const draftsChanged = (topicId: string) => Invalidation.use((i) => i.invalidate({ drafts: [topicId], [DRAFT_REVIEWS]: [] }))

    return {
      'home.view': () => view(),
      'home.huddleSeen': ({ callId }) => write(Effect.gen(function* () {
        yield* (yield* StoreWriter)`UPDATE huddle_history SET seen = 1 WHERE call_id = ${callId}`
        yield* (yield* Invalidation).invalidate(['huddle_history'])
      })),
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
      'home.movesShown': () =>
        write(
          Effect.gen(function* () {
            yield* prefs.set(MOVES_SHOWN_PREF, yield* Clock.currentTimeMillis)
          }),
        ),
      'home.movesSeen': ({ channels }) =>
        write(
          Effect.gen(function* () {
            if (channels.length === 0) return
            const sql = yield* StoreWriter
            const now = yield* Clock.currentTimeMillis
            yield* sql`UPDATE automated_moves SET seen_at = ${String(now)} WHERE channel IN ${sql.in(channels)} AND seen_at IS NULL`
            yield* (yield* Invalidation).invalidate(keys.automatedMoves)
          }),
        ),
      'followUps.markDone': ({ topicId, messageTs }) =>
        command(
          Effect.gen(function* () {
            const row = yield* followUp(topicId, messageTs)
            if (row === undefined || row.done_at !== null) return undefined
            const sql = yield* StoreWriter
            const now = String(yield* Clock.currentTimeMillis)
            yield* sql`UPDATE follow_ups SET done_at = ${now} WHERE topic_id = ${topicId} AND message_ts = ${messageTs}`
            yield* (yield* Invalidation).invalidate(keys.followUps)
            return followUpUndo(topicId, messageTs, row)
          }),
        ),
      'followUps.notDone': ({ topicId, messageTs, matchTs }) =>
        command(
          Effect.gen(function* () {
            const row = yield* followUp(topicId, messageTs)
            if (row === undefined || (row.match_kept_ts !== null && row.match_kept_ts >= matchTs)) return undefined
            const sql = yield* StoreWriter
            yield* sql`UPDATE follow_ups SET match_kept_ts = ${matchTs} WHERE topic_id = ${topicId} AND message_ts = ${messageTs}`
            yield* (yield* Invalidation).invalidate(keys.followUps)
            return followUpUndo(topicId, messageTs, row)
          }),
        ),
      'followUps.restore': ({ topicId, messageTs, doneAt, matchKeptTs }) =>
        command(
          Effect.gen(function* () {
            const sql = yield* StoreWriter
            yield* sql`UPDATE follow_ups SET done_at = ${doneAt}, match_kept_ts = ${matchKeptTs} WHERE topic_id = ${topicId} AND message_ts = ${messageTs}`
            yield* (yield* Invalidation).invalidate(keys.followUps)
            return undefined
          }),
        ),
      'drafts.discard': ({ topicId, updatedAt }) =>
        command(
          Effect.gen(function* () {
            const row = yield* draft(topicId)
            if (row === undefined || row.updated_at !== updatedAt) return undefined
            const sql = yield* StoreWriter
            yield* sql`DELETE FROM drafts WHERE topic_id = ${topicId}`
            yield* draftsChanged(topicId)
            return draftUndo(topicId, row)
          }),
        ),
      'drafts.keep': ({ topicId, updatedAt }) =>
        command(
          Effect.gen(function* () {
            const row = yield* draft(topicId)
            if (row === undefined || row.updated_at !== updatedAt || row.kept_at === updatedAt) return undefined
            const sql = yield* StoreWriter
            yield* sql`UPDATE drafts SET kept_at = ${updatedAt} WHERE topic_id = ${topicId}`
            yield* draftsChanged(topicId)
            return draftUndo(topicId, row)
          }),
        ),
      'drafts.restore': ({ topicId, text, updatedAt, keptAt }) =>
        command(
          Effect.gen(function* () {
            const sql = yield* StoreWriter
            // A draft typed in the topic since the review acted wins over the one put back.
            const current = yield* draft(topicId)
            if (current === undefined || current.updated_at === updatedAt)
              yield* sql`INSERT INTO drafts (topic_id, text, updated_at, kept_at) VALUES (${topicId}, ${text}, ${updatedAt}, ${keptAt})
                ON CONFLICT (topic_id) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at, kept_at = excluded.kept_at`
            yield* draftsChanged(topicId)
            return undefined
          }),
        ),
    }
  }),
)
