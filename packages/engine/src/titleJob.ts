/**
 * AI titles for recent sidebar threads (SPEC 2, "Titles"; 13.10), once Home
 * is ready in the first sync (`homeStage`) and without opening them. It reads the local cache only, so it
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
 *   again, and counts toward the budget until the day ends. A title the
 *   model refused for good (its policy, a bad request: `isFinal`) is not
 *   asked again, on any pass or wake, until the thread has a new message;
 *   the engine keeps the refused input in `ai_refusals` (`ai.ts`). No key or the
 *   cap stops the pass with no call counted; a key change, a link to the
 *   agent's ledger or its word that it has room again (the owner raised the
 *   cap) starts a new pass at once. AI assist off stops new calls.
 */
import { EngineTiming } from './config'
import { observeWork, workWakes } from './workControl'
import { AiProvider, cacheKeyOf, isFinal, tasks, type AiCallMeta, type TitleTopicInput } from '@juno/ai'
import { quietDaysOf, type TopicId } from '@juno/domain'
import { unescapeMrkdwn } from '@juno/richtext'
import { Invalidation, liveQuery, StoreReader, StoreWriter, transaction, type InvalidationKeys, type SqlError } from '@juno/store'
import { Clock, Effect, Layer, Stream } from 'effect'
import { aiAssistOn, aiJobsOn } from './ai'
import type { EngineConfig } from './config'
import { AiCredentials, aiWakes } from './aiCredentials'
import { AiSpend } from './aiSpend'
import { Workspace, type StoreServices } from './workspace'
import { homeStage } from './home/ready'

/** Calls per workspace per day, counted from stored titles and this process's unfinished calls. */
export const TITLE_DAILY_BUDGET = 200
const PASS_SIZE = 12
const CONCURRENCY = 2
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
  /** Waits, cleared on each wake, so a thread held back before a wake is tried again after it. */
  readonly deferred: Map<string, number>
}

/** Keeps the answer in `ai_cache` and as the topic's AI title. */
const storeTitle = (topicId: string, input: TitleTopicInput, title: string, meta: AiCallMeta) => Effect.gen(function* () {
  const at = String(yield* Clock.currentTimeMillis)
  const hash = cacheKeyOf(tasks.titleTopic, input).inputHash
  yield* transaction(Effect.gen(function* () {
    const writer = yield* StoreWriter
    yield* writer`INSERT INTO ai_cache (task, key, input_hash, output_json, model, cost_usd, created_at)
      VALUES ('titleTopic', ${topicId}, ${hash}, ${JSON.stringify(title)}, ${meta.model}, ${meta.costUsd ?? null}, ${at})
      ON CONFLICT (task, key) DO UPDATE SET input_hash = excluded.input_hash, output_json = excluded.output_json, model = excluded.model,
        cost_usd = excluded.cost_usd, created_at = excluded.created_at`
    yield* writer`INSERT INTO topic_overlay (topic_id, ai_title, ai_title_source_hash, ai_title_at)
      VALUES (${topicId}, ${title}, ${hash}, ${at})
      ON CONFLICT (topic_id) DO UPDATE SET ai_title = excluded.ai_title, ai_title_source_hash = excluded.ai_title_source_hash, ai_title_at = excluded.ai_title_at`
    yield* (yield* Invalidation).invalidate(['topic_overlay', 'ai_cache'])
  }))
})

const runPass = (memory: Memory): Effect.Effect<void, SqlError, StoreServices | AiProvider> => Effect.gen(function* () {
  if (!(yield* aiAssistOn) || !(yield* homeStage).ready) return
  const sql = yield* StoreReader
  const timing = yield* EngineTiming
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
    LEFT JOIN ai_refusals r ON r.task = 'titleTopic' AND r.key = i.topic_id
    WHERE i.kind = 'thread' AND i.last_activity_ts >= ${cutoff} AND c.is_member = 1 AND c.is_archived = 0 AND ig.channel IS NULL
      AND (o.resolved_at IS NULL OR i.last_activity_ts > o.resolved_activity_ts)
      AND (s.subscribed = 1 OR (s.subscribed IS NULL AND i.mentions_me = 1 AND i.unread_count > 0))
      AND NULLIF(trim(o.ai_title), '') IS NULL AND NULLIF(trim(o.manual_title), '') IS NULL
      -- A refused title is asked again once the thread has activity after the refusal (seconds against milliseconds).
      AND (r.key IS NULL OR CAST(i.last_activity_ts AS REAL) * 1000 > r.at)
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
      // Refused for good: kept by the provider wrapper, so nothing to wait for. One answered from that record was never sent.
      if (isFinal(answer)) {
        if (answer.meta.attempts === 0) spent.unstored--
        memory.deferred.delete(row.topic_id)
        return
      }
      if (answer.reason === 'missing-key' || answer.reason === 'budget') {
        spent.unstored--
        stopped = true
        return
      }
      memory.deferred.set(row.topic_id, now + timing.titleDeferMillis)
      return
    }
    yield* storeTitle(row.topic_id, input, answer.value, answer.meta)
    spent.unstored--
    memory.deferred.delete(row.topic_id)
  }), { concurrency: CONCURRENCY, discard: true })
})

/** Runs the job for the life of the engine. */
export const TitleJob: Layer.Layer<never, never, Workspace | AiProvider | AiCredentials | AiSpend | EngineConfig> = Layer.effectDiscard(Effect.gen(function* () {
  if (!(yield* aiJobsOn)) return
  const timing = yield* EngineTiming
  const workspace = yield* Workspace
  const provider = yield* AiProvider
  const wakes = yield* aiWakes
  const spending = new Map<string, Memory['spent']>()
  yield* Effect.forkScoped(workspace.changes.pipe(
    Stream.switchMap((open) => {
      if (open === undefined) return Stream.empty
      const spent = spending.get(open.id) ?? { day: 0, unstored: 0 }
      spending.set(open.id, spent)
      const memory: Memory = { spent, deferred: new Map() }
      // A wake forgets the waits and runs a pass after the one under way, which it does not stop.
      const woken = wakes.pipe(Stream.mapEffect(() => Effect.sync(() => memory.deferred.clear())))
      return Stream.merge(Stream.merge(liveQuery(KEYS, Effect.void).pipe(Stream.debounce(timing.titleDebounceMillis)), Stream.tick(timing.titleTickMillis)), woken).pipe(
        Stream.merge(workWakes('title')),
        Stream.mapEffect(() => runPass(memory).pipe(observeWork('title'), Effect.catch(() => Effect.logWarning('titles: a pass failed')), Effect.provideService(AiProvider, provider))),
        Stream.provide(open.context),
      )
    }),
    Stream.runDrain,
  ))
}))
