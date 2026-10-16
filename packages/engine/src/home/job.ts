/**
 * The background job behind Home's AI items (SPEC sections 12 and 15;
 * architecture 10, "Home items"): settled scores for Tidy up, and the
 * user's promises for Follow-up.
 *
 * A pass runs when the workspace opens and its topics change (changes in
 * a 3 second window are one pass, and a steady stream of them cannot hold
 * passes off), and every 15 minutes, so a topic that went quiet gets
 * scored. Each pass asks only about topics whose
 * stored answer is older than their latest activity, newest first, a few at
 * a time, inside Home's daily budget (`assist.ts`). A call that did not
 * answer defers that topic with backoff in memory. Nothing runs while AI
 * assist is off.
 *
 * - Settled: a followed topic, open, idle for 2 minutes, active in the
 *   last week, with at least two messages.
 * - Follow-ups: a followed topic active in the last 3 days where the user
 *   wrote one of the latest messages. Found promises go to `follow_ups`;
 *   one already there keeps its Mark done.
 */
import { AiProvider, tasks } from '@juno/ai'
import { channelLabel, resolveTitle, type TopicId } from '@juno/domain'
import { Invalidation, keys, liveQuery, StoreReader, StoreWriter, syncState, transaction, type InvalidationKeys, type SqlError } from '@juno/store'
import { BOOT_KEY } from '@juno/sync'
import { Clock, Effect, Layer, Stream } from 'effect'
import { aiAssistOn } from '../ai'
import { AiCredentials, aiWakes } from '../aiCredentials'
import { AiSpend } from '../aiSpend'
import { channelInfoOf, parseColumns, topicFrom, userIdsOf, userName, type UserRow } from '../topicRows'
import { Workspace, type StoreServices } from '../workspace'
import { decideAndStore, HOME_DAILY_BUDGET, recentMessages, usedToday } from './assist'
import { FOLLOWED, HOME_SELECT, OPEN, type HomeRow } from './query'

const KEYS: InvalidationKeys = ['topics', 'topic_overlay', 'thread_subs', 'prefs', 'sync_state']
/** Changes in this window are one pass; a steady stream of changes still gets a pass per window. */
const WINDOW = '3 seconds'
const TICK = '15 minutes'
const CONCURRENCY = 2
/** Topics one pass asks about, per task. */
const PASS_SIZE = 12
const IDLE_MILLIS = 2 * 60_000
const SETTLED_DAYS = 7
const FOLLOW_UP_DAYS = 3
/** Messages a settled score or a follow-up scan reads. */
const MESSAGES = 12
const DEFER_BASE_MILLIS = 60_000
const DEFER_CAP_MILLIS = 60 * 60_000
const DAY = 24 * 60 * 60 * 1000

const tsOf = (millis: number) => `${Math.floor(millis / 1000)}.000000`

/** Followed, open topics with activity between `from` and `to` whose `task` answer is missing or older than that activity. */
export const staleStatement = (task: string, from: string, to: string, limit: number) => ({
  sql: `${HOME_SELECT}
    LEFT JOIN ai_cache ac ON ac.task = ? AND ac.key = i.topic_id
    WHERE i.last_activity_ts >= ? AND i.last_activity_ts <= ? AND ${OPEN} AND ${FOLLOWED}
      AND (ac.key IS NULL OR CAST(ac.created_at AS REAL) < CAST(i.last_activity_ts AS REAL) * 1000)
    ORDER BY i.last_activity_ts DESC LIMIT ?`,
  params: [task, from, to, limit] as ReadonlyArray<string | number>,
})

interface Memory {
  readonly deferred: Map<string, { readonly until: number; readonly attempts: number }>
}

const due = (memory: Memory, key: string, now: number) => (memory.deferred.get(key)?.until ?? 0) <= now

const defer = (memory: Memory, key: string, now: number) => {
  const attempts = (memory.deferred.get(key)?.attempts ?? 0) + 1
  memory.deferred.set(key, { until: now + Math.min(DEFER_CAP_MILLIS, DEFER_BASE_MILLIS * 2 ** (attempts - 1)), attempts })
}

/** The title and place a task reads for a topic. */
const describe = (row: HomeRow, selfId: string | undefined, users: ReadonlyMap<string, UserRow>) => {
  const columns = parseColumns(row)
  const nameOf = (id: string) => userName(id, users.get(id))
  const info = channelInfoOf(row, columns, selfId, nameOf)
  const label = channelLabel(info)
  return { title: row.kind === 'main' ? label : resolveTitle(topicFrom(row, columns, info), { user: nameOf }).text, channel: label }
}

const runPass = (memory: Memory): Effect.Effect<void, SqlError, StoreServices | AiProvider> =>
  Effect.gen(function* () {
    if (!(yield* aiAssistOn)) return
    // Before the first sync finishes, a topic's messages are not all here yet.
    if ((yield* syncState.get(BOOT_KEY)) === undefined) return
    const sql = yield* StoreReader
    const now = yield* Clock.currentTimeMillis
    let budget = HOME_DAILY_BUDGET - (yield* usedToday(now))
    if (budget <= 0) return
    const selfId = (yield* sql<{ self_user_id: string | null }>`SELECT self_user_id FROM team LIMIT 1`)[0]?.self_user_id ?? undefined
    const users = new Map<string, UserRow>()
    /** Reads the names the rows' channels need (DM partners, group DM members) that are not read yet. */
    const readNames = (rows: ReadonlyArray<HomeRow>) =>
      Effect.gen(function* () {
        const ids = new Set<string>()
        for (const row of rows) userIdsOf(row, parseColumns(row), ids)
        const missing = [...ids].filter((id) => !users.has(id))
        if (missing.length === 0) return
        for (const user of yield* sql<UserRow>`SELECT id, name, display_name, real_name, avatar_url, avatar_small_url, avatar_large_url FROM users WHERE id IN ${sql.in(missing)}`) users.set(user.id, user)
      })
    const nowIso = new Date(now).toISOString()
    const take = (rows: ReadonlyArray<HomeRow>, task: string) => {
      const chosen = rows.filter((row) => due(memory, `${task}:${row.topic_id}`, now)).slice(0, Math.max(0, budget))
      budget -= chosen.length
      return chosen
    }

    const settledRun = staleStatement('settledScore', tsOf(now - SETTLED_DAYS * DAY), tsOf(now - IDLE_MILLIS), PASS_SIZE)
    const settled = take(
      (yield* sql.unsafe<HomeRow>(settledRun.sql, settledRun.params)).filter((row) => row.message_count >= 2),
      'settledScore',
    )
    yield* readNames(settled)
    yield* Effect.forEach(
      settled,
      (row) =>
        Effect.gen(function* () {
          const messages = yield* recentMessages(row, selfId, MESSAGES)
          const decision = yield* decideAndStore(tasks.settledScore, { topicId: row.topic_id as TopicId, ...describe(row, selfId, users), now: nowIso, messages })
          if (decision._tag !== 'Decided') defer(memory, `settledScore:${row.topic_id}`, yield* Clock.currentTimeMillis)
        }),
      { concurrency: CONCURRENCY, discard: true },
    )

    const followRun = staleStatement('followUps', tsOf(now - FOLLOW_UP_DAYS * DAY), tsOf(now), PASS_SIZE * 2)
    const candidates = (yield* sql.unsafe<HomeRow>(followRun.sql, followRun.params)).filter((row) => due(memory, `followUps:${row.topic_id}`, now))
    const scans: Array<{ readonly row: HomeRow; readonly messages: Effect.Success<ReturnType<typeof recentMessages>> }> = []
    for (const row of candidates) {
      if (scans.length >= Math.min(PASS_SIZE, budget)) break
      const messages = yield* recentMessages(row, selfId, MESSAGES)
      if (messages.some((m) => m.fromMe === true)) scans.push({ row, messages })
    }
    budget -= scans.length
    yield* readNames(scans.map((scan) => scan.row))
    yield* Effect.forEach(
      scans,
      ({ row, messages }) =>
        Effect.gen(function* () {
          const decision = yield* decideAndStore(tasks.followUps, { topicId: row.topic_id as TopicId, ...describe(row, selfId, users), now: nowIso, messages })
          if (decision._tag !== 'Decided') return defer(memory, `followUps:${row.topic_id}`, yield* Clock.currentTimeMillis)
          if (decision.value.followUps.length === 0) return
          const found = String(yield* Clock.currentTimeMillis)
          yield* transaction(
            Effect.gen(function* () {
              const writer = yield* StoreWriter
              for (const item of decision.value.followUps) {
                yield* writer`INSERT INTO follow_ups (topic_id, message_ts, text, found_at) VALUES (${row.topic_id}, ${item.messageId}, ${item.text}, ${found})
                  ON CONFLICT (topic_id, message_ts) DO NOTHING`
              }
              yield* (yield* Invalidation).invalidate(keys.followUps)
            }),
          )
        }),
      { concurrency: CONCURRENCY, discard: true },
    )
  })

/** Runs the job for the life of the engine. */
export const HomeJob: Layer.Layer<never, never, Workspace | AiProvider | AiCredentials | AiSpend> = Layer.effectDiscard(
  Effect.gen(function* () {
    const workspace = yield* Workspace
    const provider = yield* AiProvider
    const wakes = yield* aiWakes
    const passes = workspace.changes.pipe(
      Stream.zipLatest(wakes),
      Stream.switchMap(([open]) => {
        if (open === undefined) return Stream.empty
        const memory: Memory = { deferred: new Map() }
        const triggers = Stream.merge(liveQuery(KEYS, Effect.void).pipe(Stream.groupedWithin(1000, WINDOW)), Stream.tick(TICK))
        return triggers.pipe(
          Stream.mapEffect(() =>
            runPass(memory).pipe(
              Effect.catch((error) => Effect.logWarning('home: a pass failed', error)),
              Effect.provideService(AiProvider, provider),
            ),
          ),
          Stream.provide(open.context),
        )
      }),
    )
    yield* Effect.forkScoped(Stream.runDrain(passes))
  }),
)
