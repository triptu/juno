/**
 * `messages.check`: the checks on send (spec section 8, architecture 10).
 *
 * Nothing runs while AI assist is off. Otherwise the clarity check (pure,
 * `@juno/domain`) runs on every draft, and in a Main the wrong-place check
 * asks `routeCheck` whether the draft replies to one of the channel's
 * latest open topics. The provider gives up at the task's 1.5 s timeout;
 * no answer, a low confidence or a spent budget find nothing, so the
 * message just sends.
 *
 * Answers are kept in `ai_cache` under `cacheKeyOf(routeCheck, input)`, so
 * pressing Enter again on the same draft asks nothing. Nothing reads them
 * live, so the write invalidates nothing.
 */
import { AiProvider, cacheKeyOf, routeCheck, type AiMessage, type RouteCheckInput } from '@juno/ai'
import type { ClarityFinding, RouteFinding, SendCheck } from '@juno/contract'
import { channelLabel, clarityCheck, resolveTitle, threadTopicId, topicStatus, type ChannelId, type Ts } from '@juno/domain'
import { StoreReader, StoreWriter, type SqlError } from '@juno/store'
import { Clock, Effect } from 'effect'
import { aiAssistOn } from '../ai'
import { channelInfoOf, parseColumns, topicFrom, TOPIC_COLUMNS, TOPIC_FROM, userName, type JoinedRow, type UserRow } from '../topicRows'
import { Workspace } from '../workspace'

/** How many of the channel's latest open topics a Main draft is compared with (spec section 8: 3 or 4). */
export const ROUTE_TOPICS = 4
/** The latest messages of each topic the model reads. */
const ROUTE_MESSAGES = 4
/** Below this the bar stays away: a wrong guess costs more than a missed one. */
export const ROUTE_CONFIDENCE = 0.75
/** `routeCheck` calls per day, counted in this process. Past it a draft goes unchecked. */
export const ROUTE_DAILY_BUDGET = 500

const DAY = 24 * 60 * 60 * 1000

export interface CheckInput {
  readonly channelId: string
  readonly threadTs?: string | undefined
  readonly text: string
}

/** Counts the calls made today; `take` says whether one more fits. */
export function dailyBudget(limit: number): { readonly take: (now: number) => boolean } {
  let day = -1
  let used = 0
  return {
    take: (now) => {
      const today = Math.floor(now / DAY)
      if (today !== day) {
        day = today
        used = 0
      }
      if (used >= limit) return false
      used++
      return true
    },
  }
}

const isoOf = (ts: string): string => new Date(Number(ts) * 1000).toISOString()

/** The channel's latest open threads with their last few messages, newest first. */
const latestTopics = (channelId: string, now: number) =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const prefs = yield* sql<{ value_json: string }>`SELECT value_json FROM prefs WHERE key = 'quietDays'`
    const quietDays = prefs[0] === undefined ? undefined : (JSON.parse(prefs[0].value_json) as unknown)
    const ctx = { now, ...(typeof quietDays === 'number' ? { quietDays } : {}) }
    const self = (yield* sql<{ self_user_id: string | null }>`SELECT self_user_id FROM team LIMIT 1`)[0]?.self_user_id ?? undefined
    // A few more than needed: resolved and quiet ones are skipped.
    const rows = yield* sql.unsafe<JoinedRow>(
      `${TOPIC_COLUMNS}, NULL AS channel_activity_ts ${TOPIC_FROM} WHERE i.channel = ? AND i.kind = 'thread' ORDER BY i.last_activity_ts DESC LIMIT ?`,
      [channelId, ROUTE_TOPICS * 3],
    )
    const open = rows
      .map((row) => {
        const columns = parseColumns(row)
        return { row, topic: topicFrom(row, columns, channelInfoOf(row, columns, self, (id) => id)) }
      })
      .filter(({ row, topic }) => row.root_ts !== null && topicStatus(topic, ctx) === 'open')
      .slice(0, ROUTE_TOPICS)
    const recent = new Map<string, ReadonlyArray<{ ts: string; user_id: string | null; text: string }>>()
    const senders = new Set<string>()
    for (const { row } of open) {
      const messages = yield* sql<{ ts: string; user_id: string | null; text: string }>`
        SELECT ts, user_id, text FROM messages WHERE channel = ${channelId} AND thread_ts = ${row.root_ts} AND deleted = 0 ORDER BY ts DESC LIMIT ${ROUTE_MESSAGES}`
      recent.set(row.topic_id, messages.toReversed())
      for (const message of messages) if (message.user_id !== null) senders.add(message.user_id)
    }
    const users = new Map<string, UserRow>()
    if (senders.size > 0) for (const user of yield* sql<UserRow>`SELECT id, name, display_name, real_name, avatar_url FROM users WHERE id IN ${sql.in([...senders])}`) users.set(user.id, user)
    return {
      channel: open[0] === undefined ? '' : channelLabel(open[0].topic.channel),
      topics: open.map(({ row, topic }) => ({
        id: topic.id,
        rootTs: row.root_ts!,
        title: resolveTitle(topic).text,
        recent: (recent.get(row.topic_id) ?? [])
          .filter((m) => m.text.trim() !== '')
          .map(
            (m): AiMessage => ({
              sender: m.user_id === null ? 'Someone' : userName(m.user_id, users.get(m.user_id)),
              text: m.text.slice(0, 600),
              at: isoOf(m.ts),
              ...(m.user_id !== null && m.user_id === self ? { fromMe: true } : {}),
            }),
          ),
      })),
    }
  })

/** The stored answer for exactly this input, if any. */
const cached = (input: RouteCheckInput) =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const key = cacheKeyOf(routeCheck, input)
    const rows = yield* sql<{ output_json: string }>`SELECT output_json FROM ai_cache WHERE task = ${key.task} AND key = ${key.key} AND input_hash = ${key.inputHash}`
    return rows[0] === undefined ? undefined : (JSON.parse(rows[0].output_json) as { readonly replyTo: string | null; readonly confidence: number })
  })

const store = (input: RouteCheckInput, value: unknown, model: string, costUsd: number | undefined, at: number) =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const key = cacheKeyOf(routeCheck, input)
    yield* sql`INSERT INTO ai_cache (task, key, input_hash, output_json, model, cost_usd, created_at)
      VALUES (${key.task}, ${key.key}, ${key.inputHash}, ${JSON.stringify(value)}, ${model}, ${costUsd ?? null}, ${String(at)})
      ON CONFLICT (task, key) DO UPDATE SET input_hash = excluded.input_hash, output_json = excluded.output_json, model = excluded.model,
        cost_usd = excluded.cost_usd, created_at = excluded.created_at`
  })

const wrongPlace = (
  input: CheckInput,
  budget: ReturnType<typeof dailyBudget>,
): Effect.Effect<RouteFinding | undefined, SqlError, AiProvider | StoreReader | StoreWriter> =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    const latest = yield* latestTopics(input.channelId, now)
    if (latest.topics.length === 0) return undefined
    const ask: RouteCheckInput = { draft: input.text, channel: latest.channel, topics: latest.topics.map(({ id, title, recent }) => ({ id, title, recent })) }
    let answer = yield* cached(ask)
    if (answer === undefined) {
      if (!budget.take(now)) return undefined
      const decision = yield* (yield* AiProvider).decide(routeCheck, ask)
      if (decision._tag !== 'Decided') return undefined
      answer = decision.value
      yield* store(ask, answer, decision.meta.model, decision.meta.costUsd, now)
    }
    const { replyTo, confidence } = answer
    const topic = latest.topics.find((t) => t.id === replyTo)
    if (topic === undefined || confidence < ROUTE_CONFIDENCE) return undefined
    return { topicId: threadTopicId(input.channelId as ChannelId, topic.rootTs as Ts), threadTs: topic.rootTs, title: topic.title, confidence }
  })

const clarity = (text: string): ClarityFinding | undefined => {
  const found = clarityCheck(text)
  if (found === undefined) return undefined
  return { fixes: found.fixes.map((fix) => fix.label), fixed: found.fixed, confidence: found.confidence, ...(found.note === undefined ? {} : { note: found.note }) }
}

/** Runs the checks for one draft. Empty when there is nothing to say. */
export const checkMessage = (input: CheckInput, budget: ReturnType<typeof dailyBudget>): Effect.Effect<SendCheck, never, Workspace | AiProvider> =>
  Effect.gen(function* () {
    const open = yield* (yield* Workspace).current
    if (open === undefined || input.text.trim() === '') return {}
    return yield* Effect.gen(function* () {
      if (!(yield* aiAssistOn)) return {}
      const route = input.threadTs === undefined ? yield* wrongPlace(input, budget) : undefined
      const found = clarity(input.text)
      return { ...(route === undefined ? {} : { route }), ...(found === undefined ? {} : { clarity: found }) }
    }).pipe(Effect.provide(open.context), Effect.orDie)
  })
