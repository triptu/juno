/**
 * `ai.activity`: the AI activity log as Settings › AI activity shows it,
 * newest first, with today's estimated cost. The names of the topics and
 * channels the calls were for are looked up on every run, so a renamed
 * topic shows its name now; the log itself stores only ids (`aiAudit.ts`).
 */
import { AiRoutes, type AiActivity, type AiCallRow } from '@juno/contract'
import { channelLabel, firstWords, parseTopicId, slackLine } from '@juno/domain'
import { keys, liveQuery, StoreReader, type SqlError } from '@juno/store'
import { Clock, Effect, Stream } from 'effect'
import { EngineConfig } from './config'
import { retryFirstRun, serveLiveValue, timed, type Run } from './protocol/live'
import { Workspace } from './workspace'
import { KEEP } from './aiAudit'

interface CallRow {
  readonly id: number
  readonly at: number
  readonly last_at: number
  readonly repeats: number
  readonly source: string
  readonly feature: string
  readonly subject_kind: string
  readonly subject_id: string
  readonly provider: string
  readonly model: string
  readonly outcome: AiCallRow['outcome']
  readonly kind: string
  readonly message: string
  readonly duration_ms: number
  readonly input_tokens: number | null
  readonly output_tokens: number | null
  readonly cost_usd: number | null
  readonly summary: string
}

interface ConversationRow {
  readonly id: string
  readonly kind: 'public' | 'private' | 'im' | 'mpim'
  readonly name: string | null
  readonly person: string | null
}

interface TopicRow {
  readonly topic_id: string
  readonly kind: string
  readonly channel: string
  readonly manual_title: string | null
  readonly ai_title: string | null
  readonly root_text: string | null
}

/** Local midnight, as the agent's ledger counts a day. */
const midnight = (now: number): number => {
  const date = new Date(now)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

const readActivity: Effect.Effect<AiActivity, SqlError, StoreReader> = Effect.gen(function* () {
  const sql = yield* StoreReader
  const rows = yield* sql<CallRow>`SELECT * FROM ai_calls ORDER BY id DESC LIMIT ${KEEP}`
  const topicIds = [...new Set(rows.filter((row) => row.subject_kind === 'topic').map((row) => row.subject_id))]
  const topics = topicIds.length === 0 ? [] : yield* sql<TopicRow>`SELECT i.topic_id, i.kind, i.channel, o.manual_title, o.ai_title, m.text AS root_text
    FROM topic_index i LEFT JOIN topic_overlay o ON o.topic_id = i.topic_id
    LEFT JOIN messages m ON m.channel = i.channel AND m.ts = i.root_ts
    WHERE i.topic_id IN ${sql.in(topicIds)}`
  const channelIds = new Set(rows.filter((row) => row.subject_kind === 'channel').map((row) => row.subject_id))
  for (const id of topicIds) {
    const parsed = parseTopicId(id)
    if (parsed !== undefined) channelIds.add(parsed.channel)
  }
  const conversations = channelIds.size === 0 ? [] : yield* sql<ConversationRow>`SELECT c.id, c.kind, c.name,
      COALESCE(NULLIF(u.display_name, ''), NULLIF(u.real_name, ''), u.name) AS person
    FROM conversations c LEFT JOIN users u ON u.id = c.user_id WHERE c.id IN ${sql.in([...channelIds])}`
  const labels = new Map(conversations.map((row) => [row.id, channelLabel({ kind: row.kind, name: (row.kind === 'im' ? row.person : row.name) ?? row.id })]))
  const titles = new Map(topics.map((row) => {
    const label = labels.get(row.channel) ?? ''
    if (row.kind === 'main') return [row.topic_id, label]
    const title = row.manual_title?.trim() || row.ai_title?.trim() || firstWords(slackLine(row.root_text ?? '')) || label
    return [row.topic_id, title]
  }))
  const nameOf = (row: CallRow): string => {
    if (row.subject_kind === 'topic') return titles.get(row.subject_id) ?? ''
    if (row.subject_kind === 'channel') return labels.get(row.subject_id) ?? ''
    return ''
  }
  const today = midnight(yield* Clock.currentTimeMillis)
  let todayUsd = 0
  let todayCalls = 0
  for (const row of rows) {
    if (row.at < today) continue
    todayUsd += row.cost_usd ?? 0
    if (row.outcome !== 'blocked') todayCalls += 1
  }
  return {
    calls: rows.map((row) => ({
      id: String(row.id),
      at: row.at,
      lastAt: row.last_at,
      repeats: row.repeats,
      source: row.source === 'agent' ? 'agent' : 'engine',
      feature: row.feature,
      subject: { kind: row.subject_kind, id: row.subject_id, name: nameOf(row) },
      provider: row.provider,
      model: row.model,
      outcome: row.outcome,
      kind: row.kind,
      message: row.message,
      durationMs: row.duration_ms,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      costUsd: row.cost_usd,
      summary: row.summary,
    })),
    todayUsd,
    todayCalls,
  }
})

/** Topic names follow the overlay and the topics; the log follows its own table. */
const KEYS = [...keys.aiCalls, 'topic_overlay', 'topics', 'conversations']

export const AiHandlers = AiRoutes.toLayer(
  Effect.gen(function* () {
    const workspace = yield* Workspace
    const config = yield* EngineConfig
    const measure = config.e2e || config.dev
    const runs: Stream.Stream<Run<AiActivity, SqlError>> = workspace.changes.pipe(
      Stream.switchMap((open) => (open === undefined ? Stream.empty : liveQuery(KEYS, timed(readActivity)).pipe(Stream.provide(open.context)))),
    )
    return {
      'ai.activity': () => serveLiveValue(runs, { measure }).pipe(retryFirstRun('ai.activity'), Stream.orDie),
    }
  }),
)
