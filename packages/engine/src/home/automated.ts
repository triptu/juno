/**
 * Sorting conversations into the built-in Automated view (SPEC section 5,
 * "Automated"; architecture 10, "Automated").
 *
 * The sync already moved the clear cases at the end of its boot
 * (`sortClearCases`). A pass runs once the first sync is done, and again when conversations or
 * topics change (changes in a 3 second window are one pass) and every 15
 * minutes. It looks only at conversations the user is in, not ignored, in
 * no view, with activity in the last 30 days, and with no settled place in
 * `automated_channels` (or one the rules or Juno still ask about). One it
 * already looked at is looked at again only when it has new activity, or
 * when AI assist is turned on or off.
 *
 * For each, the rules (`classifyConversation`) read the senders of its
 * latest messages:
 * - automated: it goes into the view, which is made the first time.
 * - ambiguous: with AI assist on, Juno judges it once (`automatedChannel`,
 *   a decision over the latest 20 messages, kept in `ai_cache`). Sure it is
 *   automated: it goes in. Sure it is not: it stays. Otherwise, or with AI
 *   off or no provider, Home asks (`ask`), with why: how many of the
 *   latest messages apps wrote, and Juno's reason when it gave one.
 * - people or too few messages: it stays, and an open question goes.
 *
 * Nothing runs once the user deleted the view.
 */
import { AiProvider, tasks, type SampleMessage } from '@juno/ai'
import { junoVerdict } from '@juno/domain'
import { liveQuery, StoreReader, syncState, type InvalidationKeys, type SqlError } from '@juno/store'
import { BOOT_KEY } from '@juno/sync'
import { Clock, Effect, Layer, Stream } from 'effect'
import { aiAssistOn, aiJobsOn } from '../ai'
import type { EngineConfig } from '../config'
import { AiCredentials, aiWakes } from '../aiCredentials'
import { AiSpend } from '../aiSpend'
import { automatedViewState, candidates, classify, clearVerdict, moveToAutomated, selfIdOf, senderOf, setVerdict, write, type SampleRow } from '../automatedView'
import { userName, type UserRow } from '../topicRows'
import { Workspace, type StoreServices } from '../workspace'
import { decideAndStore, HOME_DAILY_BUDGET, usedToday } from './assist'
import { unescapeMrkdwn } from '@juno/richtext'

const KEYS: InvalidationKeys = ['conversations', 'topics', 'sync_state', 'sidebar_views', 'automated_channels', 'ignored_channels', 'prefs', 'users']
const WINDOW = '3 seconds'
const TICK = '15 minutes'
/** Juno calls one pass makes at most. */
const PASS_CALLS = 6
/** Messages Juno reads. */
const JUNO_MESSAGES = 20
const DEFER_BASE_MILLIS = 60_000
const DEFER_CAP_MILLIS = 60 * 60_000

interface Memory {
  /** Conversation id to what it was looked at with: its activity and whether AI assist was on. */
  readonly seen: Map<string, string>
  readonly deferred: Map<string, { readonly until: number; readonly attempts: number }>
}

interface Answer {
  readonly probability: number
  readonly reason?: string
}

/** Juno's stored answer for the conversation, if it answered before. */
const storedAnswer = (channel: string) =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const row = (yield* sql<{ output_json: string }>`SELECT output_json FROM ai_cache WHERE task = 'automatedChannel' AND key = ${channel}`)[0]
    if (row === undefined) return undefined
    try {
      const value = JSON.parse(row.output_json) as { probability?: unknown; reason?: unknown }
      if (typeof value.probability !== 'number') return undefined
      return { probability: value.probability, ...(typeof value.reason === 'string' ? { reason: value.reason } : {}) } satisfies Answer
    } catch {
      return undefined
    }
  })

const runPass = (memory: Memory, jobs: boolean): Effect.Effect<void, SqlError, StoreServices | AiProvider> =>
  Effect.gen(function* () {
    if ((yield* syncState.get(BOOT_KEY)) === undefined) return
    if ((yield* automatedViewState) === 'deleted') return
    const now = yield* Clock.currentTimeMillis
    // With the AI jobs off (tests that do not opt in), ambiguous channels go to Home's question as with AI assist off.
    const ai = jobs && (yield* aiAssistOn)
    const due = (yield* candidates(now)).filter((row) => memory.seen.get(row.id) !== `${row.activity}|${ai}`)
    if (due.length === 0) return
    const selfId = yield* selfIdOf
    let calls = ai ? Math.min(PASS_CALLS, HOME_DAILY_BUDGET - (yield* usedToday(now))) : 0

    for (const row of due) {
      const { verdict, sample } = yield* classify(row, selfId)
      const seen = () => memory.seen.set(row.id, `${row.activity}|${ai}`)
      if (verdict === 'automated') {
        yield* write(moveToAutomated(row.id, 'rules', now))
        seen()
        continue
      }
      if (verdict !== 'ambiguous') {
        if (row.verdict === 'ask') yield* write(clearVerdict(row.id))
        seen()
        continue
      }
      let answer: Answer | undefined = ai ? yield* storedAnswer(row.id) : undefined
      if (ai && answer === undefined && calls > 0 && (memory.deferred.get(row.id)?.until ?? 0) <= now) {
        calls -= 1
        const decision = yield* decideAndStore(tasks.automatedChannel, {
          channelId: row.id,
          channel: `#${row.name ?? row.id}`,
          ...(row.topic === null || row.topic === '' ? {} : { topic: row.topic }),
          messages: yield* junoSample(sample.slice(0, JUNO_MESSAGES), selfId),
        })
        if (decision._tag === 'Decided') answer = decision.value
        else {
          const attempts = (memory.deferred.get(row.id)?.attempts ?? 0) + 1
          memory.deferred.set(row.id, { until: now + Math.min(DEFER_CAP_MILLIS, DEFER_BASE_MILLIS * 2 ** (attempts - 1)), attempts })
        }
      }
      const judged = answer === undefined ? 'ambiguous' : junoVerdict(answer.probability)
      if (judged === 'automated') yield* write(moveToAutomated(row.id, 'juno', now))
      else if (judged === 'people') {
        if (row.verdict === 'ask') yield* write(clearVerdict(row.id))
      } else {
        // Written only when something Home says changed, so a pass waiting on Juno does not wake the next.
        const by = answer === undefined ? 'rules' : 'juno'
        const why = { apps: sample.filter((message) => senderOf(message, selfId) === 'app').length, sampled: sample.length, ...(answer?.reason === undefined ? {} : { reason: answer.reason }) }
        if (row.verdict !== 'ask' || row.by !== by || row.apps !== why.apps || row.sampled !== why.sampled || row.reason !== (why.reason ?? null)) yield* write(setVerdict(row.id, 'ask', by, now, why))
      }
      // Without Juno's answer yet, Home asks meanwhile and Juno is asked on a later pass.
      if (!ai || answer !== undefined) seen()
    }
  })

/** The sample as Juno reads it, oldest first, with names. */
const junoSample = (rows: ReadonlyArray<SampleRow>, selfId: string | undefined) =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const ids = [...new Set(rows.flatMap((row) => (row.user_id === null ? [] : [row.user_id])))]
    const users = new Map<string, UserRow>()
    if (ids.length > 0) for (const user of yield* sql<UserRow>`SELECT id, name, display_name, real_name, avatar_url, avatar_small_url, avatar_large_url FROM users WHERE id IN ${sql.in(ids)}`) users.set(user.id, user)
    return rows
      .toReversed()
      .filter((row) => row.text.trim() !== '')
      .map((row): SampleMessage => {
        const sender = senderOf(row, selfId)
        return {
          sender: row.user_id === null ? 'An app' : userName(row.user_id, users.get(row.user_id)),
          text: unescapeMrkdwn(row.text).slice(0, 300),
          at: new Date(Number(row.ts) * 1000).toISOString(),
          ...(sender === 'app' ? { fromApp: true } : {}),
          ...(sender === 'you' ? { fromMe: true } : {}),
        }
      })
  })

/** Runs the job for the life of the engine. */
export const AutomatedJob: Layer.Layer<never, never, Workspace | AiProvider | AiCredentials | AiSpend | EngineConfig> = Layer.effectDiscard(
  Effect.gen(function* () {
    const workspace = yield* Workspace
    const provider = yield* AiProvider
    const wakes = yield* aiWakes
    const jobs = yield* aiJobsOn
    const passes = workspace.changes.pipe(
      Stream.zipLatest(wakes),
      Stream.switchMap(([open]) => {
        if (open === undefined) return Stream.empty
        const memory: Memory = { seen: new Map(), deferred: new Map() }
        const triggers = Stream.merge(liveQuery(KEYS, Effect.void).pipe(Stream.groupedWithin(1000, WINDOW)), Stream.tick(TICK))
        return triggers.pipe(
          Stream.mapEffect(() =>
            runPass(memory, jobs).pipe(
              Effect.catch((error) => Effect.logWarning('home: an Automated pass failed', error)),
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
