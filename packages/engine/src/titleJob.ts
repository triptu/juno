/**
 * AI titles for recent sidebar threads (SPEC 2, "Titles"; 13.10), after the
 * first sync and without opening them. It reads the local cache only, so it
 * makes no Slack call; the threads' replies arrive through sync's follow pass
 * on the background lane.
 *
 * - Candidates: followed threads, and unfollowed ones that mention you while
 *   unread, inside the quiet window, in channels you are in and do not
 *   ignore, not resolved, newest activity first.
 * - Each thread is titled once: one with an AI title is not asked again, and
 *   neither is one you renamed, since your title wins (an empty rename brings
 *   the AI title back, so the job titles it then).
 * - Paced: a pass takes at most `PASS_SIZE` threads, `CONCURRENCY` calls at
 *   a time, after a 1.5 s debounce of store changes or every 30 s, inside
 *   `TITLE_DAILY_BUDGET` calls per workspace per day. Every call also
 *   reserves in the daily spend cap (`AiSpend`).
 * - A call that did not finish waits a minute before its thread is asked
 *   again, and counts toward the budget until the day ends. No key or the
 *   cap stops the pass with no call counted; a key change or a link to the
 *   agent's ledger starts a new pass. AI assist off stops new calls.
 */
import { AiProvider, cacheKeyOf, tasks } from '@juno/ai'
import { quietDaysOf, type TopicId } from '@juno/domain'
import { unescapeMrkdwn } from '@juno/richtext'
import { Invalidation, liveQuery, StoreReader, StoreWriter, syncState, transaction, type InvalidationKeys, type SqlError } from '@juno/store'
import { BOOT_KEY } from '@juno/sync'
import { Clock, Effect, Layer, Stream } from 'effect'
import { aiAssistOn } from './ai'
import { AiCredentials, aiWakes } from './aiCredentials'
import { AiSpend } from './aiSpend'
import { Workspace, type StoreServices } from './workspace'

/** Calls per workspace per day, counted from stored titles and this process's unfinished calls. */
export const TITLE_DAILY_BUDGET = 200
const PASS_SIZE = 12
const CONCURRENCY = 2
const DEBOUNCE = '1500 millis'
const TICK = '30 seconds'
const DEFER_MILLIS = 60_000
const DAY = 86_400_000
const KEYS: InvalidationKeys = ['topics', 'topic_overlay', 'thread_subs', 'conversations', 'ignored_channels', 'prefs', 'sync_state']

interface Candidate {
  readonly topic_id: string
  readonly channel: string
  readonly root_ts: string
  readonly name: string | null
}

/** What one workspace's job remembers between passes. */
interface Memory {
  /** Calls today that stored no title: they may have been billed. Shared by every pass of the workspace. */
  readonly spent: { day: number; unstored: number }
  /** Waits, per wake, so a pass cut short by a wake cannot hold a thread back in the next one. */
  readonly deferred: Map<string, number>
}

const runPass = (memory: Memory): Effect.Effect<void, SqlError, StoreServices | AiProvider> => Effect.gen(function* () {
  if (!(yield* aiAssistOn) || (yield* syncState.get(BOOT_KEY)) === undefined) return
  const sql = yield* StoreReader
  const now = yield* Clock.currentTimeMillis
  const day = now - (now % DAY)
  const spent = memory.spent
  if (spent.day !== day) {
    spent.day = day
    spent.unstored = 0
  }
  const used = (yield* sql<{ n: number }>`SELECT count(*) AS n FROM ai_cache WHERE task = 'titleTopic' AND created_at >= ${String(day)}`)[0]?.n ?? 0
  const budget = TITLE_DAILY_BUDGET - used - spent.unstored
  if (budget <= 0) return
  const quiet = (yield* sql<{ value_json: string }>`SELECT value_json FROM prefs WHERE key = 'quietDays'`)[0]
  const raw: unknown = quiet === undefined ? undefined : JSON.parse(quiet.value_json)
  const cutoff = `${Math.floor((now - quietDaysOf({ now, ...(typeof raw === 'number' ? { quietDays: raw } : {}) }) * DAY) / 1000)}.000000`
  const rows = yield* sql<Candidate>`SELECT i.topic_id, i.channel, i.root_ts, c.name
    FROM topic_index i JOIN conversations c ON c.id = i.channel
    LEFT JOIN topic_overlay o ON o.topic_id = i.topic_id
    LEFT JOIN thread_subs s ON s.channel = i.channel AND s.thread_ts = i.root_ts
    LEFT JOIN ignored_channels ig ON ig.channel = i.channel
    WHERE i.kind = 'thread' AND i.last_activity_ts >= ${cutoff} AND c.is_member = 1 AND c.is_archived = 0 AND ig.channel IS NULL
      AND (o.resolved_at IS NULL OR i.last_activity_ts > o.resolved_activity_ts)
      AND (s.subscribed = 1 OR (s.subscribed IS NULL AND i.mentions_me = 1 AND i.unread_count > 0))
      AND NULLIF(trim(o.ai_title), '') IS NULL AND NULLIF(trim(o.manual_title), '') IS NULL
    ORDER BY i.last_activity_ts DESC LIMIT 100`
  const chosen = rows.filter((row) => (memory.deferred.get(row.topic_id) ?? 0) <= now).slice(0, Math.min(PASS_SIZE, budget))
  const provider = yield* AiProvider
  let stopped = false
  yield* Effect.forEach(chosen, (row) => Effect.gen(function* () {
    if (stopped) return
    const messages = yield* sql<{ text: string; sender: string; ts: string }>`SELECT m.text, COALESCE(u.display_name, u.real_name, u.name, 'Someone') AS sender, m.ts
      FROM messages m LEFT JOIN users u ON u.id = m.user_id
      WHERE m.channel = ${row.channel} AND (m.ts = ${row.root_ts} OR m.thread_ts = ${row.root_ts}) AND m.deleted = 0 AND m.text <> ''
      ORDER BY m.ts ASC LIMIT 21`
    if (messages.length === 0) return
    const input = {
      topicId: row.topic_id as TopicId,
      channel: row.name ?? '',
      messages: messages.map((m) => ({ sender: m.sender, text: unescapeMrkdwn(m.text).slice(0, 1000), at: new Date(Number(m.ts) * 1000).toISOString() })),
    }
    // Counted before the call, so a call cut short (a key change, a new workspace) still counts today.
    spent.unstored++
    const answer = yield* provider.generate(tasks.titleTopic, input)
    if (answer._tag !== 'Decided') {
      if (answer.reason === 'missing-key' || answer.reason === 'budget') {
        spent.unstored--
        stopped = true
        return
      }
      memory.deferred.set(row.topic_id, now + DEFER_MILLIS)
      return
    }
    const at = String(yield* Clock.currentTimeMillis)
    const hash = cacheKeyOf(tasks.titleTopic, input).inputHash
    yield* transaction(Effect.gen(function* () {
      const writer = yield* StoreWriter
      yield* writer`INSERT INTO ai_cache (task, key, input_hash, output_json, model, cost_usd, created_at)
        VALUES ('titleTopic', ${row.topic_id}, ${hash}, ${JSON.stringify(answer.value)}, ${answer.meta.model}, ${answer.meta.costUsd ?? null}, ${at})
        ON CONFLICT (task, key) DO UPDATE SET input_hash = excluded.input_hash, output_json = excluded.output_json, model = excluded.model,
          cost_usd = excluded.cost_usd, created_at = excluded.created_at`
      yield* writer`INSERT INTO topic_overlay (topic_id, ai_title, ai_title_source_hash, ai_title_at)
        VALUES (${row.topic_id}, ${answer.value}, ${hash}, ${at})
        ON CONFLICT (topic_id) DO UPDATE SET ai_title = excluded.ai_title, ai_title_source_hash = excluded.ai_title_source_hash, ai_title_at = excluded.ai_title_at`
      yield* (yield* Invalidation).invalidate(['topic_overlay', 'ai_cache'])
    }))
    spent.unstored--
    memory.deferred.delete(row.topic_id)
  }), { concurrency: CONCURRENCY, discard: true })
})

/** Runs the job for the life of the engine. */
export const TitleJob: Layer.Layer<never, never, Workspace | AiProvider | AiCredentials | AiSpend> = Layer.effectDiscard(Effect.gen(function* () {
  const workspace = yield* Workspace
  const provider = yield* AiProvider
  const wakes = yield* aiWakes
  const spending = new Map<string, Memory['spent']>()
  yield* Effect.forkScoped(workspace.changes.pipe(
    Stream.zipLatest(wakes),
    Stream.switchMap(([open]) => {
      if (open === undefined) return Stream.empty
      const spent = spending.get(open.id) ?? { day: 0, unstored: 0 }
      spending.set(open.id, spent)
      const memory: Memory = { spent, deferred: new Map() }
      return Stream.merge(liveQuery(KEYS, Effect.void).pipe(Stream.debounce(DEBOUNCE)), Stream.tick(TICK)).pipe(
        Stream.mapEffect(() => runPass(memory).pipe(Effect.catch(() => Effect.logWarning('titles: a pass failed')), Effect.provideService(AiProvider, provider))),
        Stream.provide(open.context),
      )
    }),
    Stream.runDrain,
  ))
}))
