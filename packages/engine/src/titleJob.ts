/** Titles for recent sidebar threads, after first sync; no topic needs to be opened. */
import { AiProvider, cacheKeyOf, tasks } from '@juno/ai'
import { quietDaysOf, type TopicId } from '@juno/domain'
import { Invalidation, liveQuery, StoreReader, StoreWriter, syncState, transaction } from '@juno/store'
import { BOOT_KEY } from '@juno/sync'
import { Clock, Effect, Layer, Stream } from 'effect'
import { aiAssistOn } from './ai'
import { AiCredentials } from './aiCredentials'
import { Workspace } from './workspace'
import { unescapeMrkdwn } from '@juno/richtext'

export const TITLE_DAILY_BUDGET = 200
const DAY = 86_400_000
const KEYS = ['topics', 'topic_overlay', 'thread_subs', 'conversations', 'ignored_channels', 'prefs', 'sync_state'] as const

interface Candidate {
  readonly topic_id: string
  readonly channel: string
  readonly root_ts: string
  readonly name: string | null
  readonly stage: number
}
interface Memory {
  day: number
  unstored: number
  readonly deferred: Map<string, number>
}

const runPass = (memory: Memory) => Effect.gen(function* () {
  if (!(yield* aiAssistOn) || (yield* syncState.get(BOOT_KEY)) === undefined) return
  const sql = yield* StoreReader
  const now = yield* Clock.currentTimeMillis
  const day = now - now % DAY
  if (memory.day !== day) { memory.day = day; memory.unstored = 0 }
  const used = (yield* sql<{ n: number }>`SELECT count(*) AS n FROM ai_cache WHERE task = 'titleTopic' AND created_at >= ${String(day)}`)[0]?.n ?? 0
  const budget = TITLE_DAILY_BUDGET - used - memory.unstored
  if (budget <= 0) return
  const quiet = (yield* sql<{ value_json: string }>`SELECT value_json FROM prefs WHERE key = 'quietDays'`)[0]
  const raw: unknown = quiet === undefined ? undefined : JSON.parse(quiet.value_json)
  const cutoff = String((now - quietDaysOf({ now, ...(typeof raw === 'number' ? { quietDays: raw } : {}) }) * DAY) / 1000)
  // Store each reply-count milestone separately so every completed call counts toward today's budget.
  const rows = yield* sql<Candidate>`SELECT i.topic_id, i.channel, i.root_ts, c.name,
      CASE WHEN m.reply_count >= 20 THEN 20 WHEN m.reply_count >= 5 THEN 5 ELSE 0 END AS stage
    FROM topic_index i JOIN conversations c ON c.id = i.channel
    JOIN messages m ON m.channel = i.channel AND m.ts = i.root_ts AND m.deleted = 0
    LEFT JOIN topic_overlay o ON o.topic_id = i.topic_id
    LEFT JOIN thread_subs s ON s.channel = i.channel AND s.thread_ts = i.root_ts
    LEFT JOIN ignored_channels ig ON ig.channel = i.channel
    WHERE i.kind = 'thread' AND i.last_activity_ts >= ${cutoff} AND c.is_member = 1 AND c.is_archived = 0 AND ig.channel IS NULL
      AND (o.resolved_at IS NULL OR i.last_activity_ts > o.resolved_activity_ts)
      AND (s.subscribed = 1 OR (s.subscribed IS NULL AND i.mentions_me = 1 AND i.unread_count > 0))
      AND NOT EXISTS (SELECT 1 FROM ai_cache ac WHERE ac.task = 'titleTopic' AND ac.key = i.topic_id || ':' ||
        CASE WHEN m.reply_count >= 20 THEN 20 WHEN m.reply_count >= 5 THEN 5 ELSE 0 END)
    ORDER BY i.last_activity_ts DESC LIMIT 100`
  const chosen = rows.filter(row => (memory.deferred.get(row.topic_id) ?? 0) <= now).slice(0, Math.min(12, budget))
  const provider = yield* AiProvider
  yield* Effect.forEach(chosen, row => Effect.gen(function* () {
    const messages = yield* sql<{ text: string; sender: string; ts: string }>`SELECT m.text, COALESCE(u.display_name, u.real_name, u.name, 'Someone') AS sender, m.ts
      FROM messages m LEFT JOIN users u ON u.id = m.user_id
      WHERE m.channel = ${row.channel} AND (m.ts = ${row.root_ts} OR m.thread_ts = ${row.root_ts}) AND m.deleted = 0 AND m.text <> ''
      ORDER BY m.ts ASC LIMIT 21`
    if (messages.length === 0) return
    const input = { topicId: row.topic_id as TopicId, channel: row.name ?? '', messages: messages.map(m => ({ sender: m.sender, text: unescapeMrkdwn(m.text).slice(0, 1000), at: new Date(Number(m.ts) * 1000).toISOString() })) }
    memory.unstored++
    const answer = yield* provider.generate(tasks.titleTopic, input)
    if (answer._tag !== 'Decided') {
      if (answer.reason === 'missing-key') memory.unstored--
      memory.deferred.set(row.topic_id, now + 60_000)
      return
    }
    const hash = cacheKeyOf(tasks.titleTopic, input).inputHash
    yield* transaction(Effect.gen(function* () {
      const writer = yield* StoreWriter
      yield* writer`INSERT INTO ai_cache (task, key, input_hash, output_json, model, cost_usd, created_at)
        VALUES ('titleTopic', ${`${row.topic_id}:${row.stage}`}, ${hash}, ${JSON.stringify(answer.value)}, ${answer.meta.model}, ${answer.meta.costUsd ?? null}, ${String(now)})
        ON CONFLICT (task, key) DO NOTHING`
      yield* writer`INSERT INTO topic_overlay (topic_id, ai_title, ai_title_source_hash, ai_title_at)
        VALUES (${row.topic_id}, ${answer.value}, ${hash}, ${String(now)})
        ON CONFLICT (topic_id) DO UPDATE SET ai_title = excluded.ai_title, ai_title_source_hash = excluded.ai_title_source_hash, ai_title_at = excluded.ai_title_at`
      yield* (yield* Invalidation).invalidate(['topic_overlay'])
    }))
    memory.unstored--
  }), { concurrency: 2, discard: true })
})

export const TitleJob = Layer.effectDiscard(Effect.gen(function* () {
  const workspace = yield* Workspace
  const credentials = yield* AiCredentials
  const provider = yield* AiProvider
  const memories = new Map<string, Memory>()
  yield* Effect.forkScoped(workspace.changes.pipe(
    Stream.zipLatest(credentials.revisions),
    Stream.switchMap(([open]) => {
      if (open === undefined) return Stream.empty
      const memory = memories.get(open.id) ?? { day: 0, unstored: 0, deferred: new Map() }
      memories.set(open.id, memory)
      memory.deferred.clear()
      return Stream.merge(liveQuery(KEYS, Effect.void).pipe(Stream.debounce('1500 millis')), Stream.tick('30 seconds')).pipe(
        Stream.mapEffect(() => runPass(memory).pipe(Effect.catch(() => Effect.logWarning('titles: a pass failed')), Effect.provideService(AiProvider, provider))),
        Stream.provide(open.context),
      )
    }),
    Stream.runDrain,
  ))
}))
