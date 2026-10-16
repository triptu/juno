/**
 * The background job that draws topic art (SPEC section 5, "Row anatomy";
 * `docs/design/topic-art/v2`, "When art is generated").
 *
 * For every open workspace, a live query lists the topics that would get a
 * row in the sidebar (member, not archived or ignored, inside the quiet
 * window, a followed or mentioned thread or a channel's Main) and have no
 * drawing yet, or were drawn from their first words and now have an AI
 * title. It re-runs when topics, the overlay, the art table or prefs
 * change, debounced so a burst of sync writes is one pass. Each pass draws
 * the newest candidates first, `CONCURRENCY` at a time, inside the daily
 * budget. Nothing runs while AI assist is off.
 *
 * A finished attempt is stored (`draw.ts`), so a topic is asked about once.
 * A call that did not finish (no key, a timeout, a provider error) defers
 * the topic with backoff in memory, so one failing call cannot loop; a
 * missing key defers the whole pass, since no call can succeed.
 */
import { AiProvider } from '@juno/ai'
import { quietDaysOf } from '@juno/domain'
import { liveQuery, StoreReader, type InvalidationKeys, type SqlError } from '@juno/store'
import { Clock, Effect, Layer, Stream } from 'effect'
import { aiAssistOn } from '../ai'
import { AiCredentials, aiWakes } from '../aiCredentials'
import { AiSpend } from '../aiSpend'
import { Workspace, type OpenWorkspace, type StoreServices } from '../workspace'
import { ART_SELECT, drawTopic, type ArtOutcome } from './draw'
import type { JoinedRow } from '../topicRows'

/** Drawings in flight at once. The study's backlog ran at 4 without rate limits. */
export const ART_CONCURRENCY = 4
/** Calls per workspace per day, counted from stored rows and this process's unstored attempts. Tide is the fallback. */
export const ART_DAILY_BUDGET = 500
/** Candidates one pass takes; the next pass takes the next ones. */
const PASS_SIZE = 24
/** A burst of sync writes becomes one pass. */
const DEBOUNCE = '1500 millis'
/** After a call that did not finish, the topic waits this long, doubling each time, before it is asked about again. */
const DEFER_BASE_MILLIS = 60_000
const DEFER_CAP_MILLIS = 30 * 60_000
/** With no key or at the daily cap, nothing can succeed: the pass as a whole waits. */
const NO_KEY_DEFER_MILLIS = 10 * 60_000

const KEYS: InvalidationKeys = ['topics', 'topic_overlay', 'topic_art', 'prefs', 'conversations', 'ignored_channels', 'thread_subs']
const DAY = 24 * 60 * 60 * 1000

/**
 * The topics to draw, newest activity first: sidebar candidates (the
 * sidebar query's rules, `topics/query.ts`: a thread inside the quiet
 * window, or unread or pinned beyond it; every channel's Main, since a Main
 * stays in the sidebar on its threads' activity and channels are few) that
 * are not a DM's Main and have no finished
 * attempt, or whose drawing came from the first words of a thread that now
 * has an AI title.
 */
export const candidatesStatement = (cutoff: string, limit: number): { readonly sql: string; readonly params: ReadonlyArray<unknown> } => ({
  sql: `${ART_SELECT}
    WHERE (i.kind = 'main' OR i.last_activity_ts >= ? OR i.unread_count > 0 OR o.pinned_at IS NOT NULL) AND c.is_member = 1 AND c.is_archived = 0 AND ig.channel IS NULL
      AND NOT (i.kind = 'main' AND c.kind IN ('im', 'mpim'))
      AND (i.kind <> 'thread' OR s.subscribed = 1 OR (s.subscribed IS NULL AND i.mentions_me = 1 AND i.unread_count > 0))
      AND (a.topic_id IS NULL OR (a.source = 'ai' AND a.title_source = 'fallback' AND o.ai_title IS NOT NULL))
    ORDER BY i.last_activity_ts DESC LIMIT ?`,
  params: [cutoff, limit],
})

interface Pass {
  readonly aiAssist: boolean
  readonly selfId: string | undefined
  readonly rows: ReadonlyArray<JoinedRow>
  readonly usedToday: number
}

const readPass = (now: number): Effect.Effect<Pass, SqlError, StoreReader> =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const aiAssist = yield* aiAssistOn
    if (!aiAssist) return { aiAssist, selfId: undefined, rows: [], usedToday: 0 }
    const quiet = yield* sql<{ value_json: string }>`SELECT value_json FROM prefs WHERE key = 'quietDays'`
    const raw = quiet[0] === undefined ? undefined : (JSON.parse(quiet[0].value_json) as unknown)
    const cutoff = `${Math.floor((now - quietDaysOf({ now, ...(typeof raw === 'number' ? { quietDays: raw } : {}) }) * DAY) / 1000)}.000000`
    const team = yield* sql<{ self_user_id: string | null }>`SELECT self_user_id FROM team LIMIT 1`
    const statement = candidatesStatement(cutoff, PASS_SIZE)
    const rows = yield* sql.unsafe<JoinedRow>(statement.sql, statement.params)
    const dayStart = String(now - (now % DAY))
    const used = yield* sql<{ n: number }>`SELECT count(*) AS n FROM topic_art WHERE created_at >= ${dayStart}`
    return { aiAssist, selfId: team[0]?.self_user_id ?? undefined, rows, usedToday: used[0]?.n ?? 0 }
  })

/** What one workspace's job remembers between passes: topics waiting after a call that did not finish, and attempts the table does not count. */
interface Memory {
  readonly deferred: Map<string, { readonly until: number; readonly attempts: number }>
  passDeferredUntil: number
  unstoredToday: number
  unstoredDay: number
}

const defer = (memory: Memory, topicId: string, now: number): void => {
  const attempts = (memory.deferred.get(topicId)?.attempts ?? 0) + 1
  memory.deferred.set(topicId, { until: now + Math.min(DEFER_CAP_MILLIS, DEFER_BASE_MILLIS * 2 ** (attempts - 1)), attempts })
}

const runPass = (memory: Memory): Effect.Effect<void, SqlError, StoreServices | AiProvider> =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    if (now < memory.passDeferredUntil) return
    const pass = yield* readPass(now)
    if (!pass.aiAssist) return
    const day = now - (now % DAY)
    if (memory.unstoredDay !== day) {
      memory.unstoredDay = day
      memory.unstoredToday = 0
    }
    let budget = ART_DAILY_BUDGET - pass.usedToday - memory.unstoredToday
    const due = pass.rows.filter((row) => {
      const wait = memory.deferred.get(row.topic_id)
      return wait === undefined || wait.until <= now
    })
    const chosen = due.slice(0, Math.max(0, Math.min(due.length, budget)))
    if (chosen.length === 0) return
    budget -= chosen.length
    yield* Effect.forEach(
      chosen,
      (row) =>
        Effect.gen(function* () {
          const outcome: ArtOutcome = yield* drawTopic(row, pass.selfId, { source: 'ai' })
          if (outcome === 'ok' || outcome === 'unsure' || outcome === 'failed') {
            memory.deferred.delete(row.topic_id)
            return
          }
          const at = yield* Clock.currentTimeMillis
          // No key, or the daily cap: nothing was sent, and nothing can succeed until a key or a link to the ledger wakes the job.
          if (outcome === 'missing-key' || outcome === 'budget') {
            memory.passDeferredUntil = at + NO_KEY_DEFER_MILLIS
            return
          }
          memory.unstoredToday += 1
          defer(memory, row.topic_id, at)
        }),
      { concurrency: ART_CONCURRENCY, discard: true },
    )
  })

/** Runs the job for the life of the engine. Requires the services; provides nothing. */
export const ArtJob: Layer.Layer<never, never, Workspace | AiProvider | AiCredentials | AiSpend> = Layer.effectDiscard(
  Effect.gen(function* () {
    const workspace = yield* Workspace
    const provider = yield* AiProvider
    const wakes = yield* aiWakes
    let previous: OpenWorkspace | undefined
    let memory: Memory = { deferred: new Map(), passDeferredUntil: 0, unstoredToday: 0, unstoredDay: 0 }
    const passes = workspace.changes.pipe(
      Stream.zipLatest(wakes),
      Stream.switchMap(([open]) => {
        if (open === undefined) return Stream.empty
        if (previous !== open) memory = { deferred: new Map(), passDeferredUntil: 0, unstoredToday: 0, unstoredDay: 0 }
        previous = open
        memory.deferred.clear()
        memory.passDeferredUntil = 0
        // The live query is the trigger; each pass reads its own fresh candidates, so a stale emission costs one query.
        return liveQuery(KEYS, Effect.void).pipe(
          Stream.debounce(DEBOUNCE),
          Stream.mapEffect(() =>
            runPass(memory).pipe(
              Effect.catch((error) => Effect.logWarning('topic art: a pass failed', error)),
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
