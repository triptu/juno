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
 * For each, the rules (`classifyConversation`) read who wrote its latest
 * top-level messages (thread replies say nothing about who starts
 * conversations):
 * - automated: it goes into the view, which is made the first time.
 * - ambiguous: with AI assist on, Juno judges it once (`automatedChannel`,
 *   a decision over the latest 20 messages, kept in `ai_cache`). Sure it is
 *   automated: it goes in. Sure it is not: it stays. Otherwise, or with AI
 *   off or no provider, Home asks (`ask`), with why: how many of the
 *   latest top-level messages apps wrote, and Juno's reason when it gave one.
 * - people or too few messages: it stays, and an open question goes.
 *
 * The same pass looks again at what the rules and Juno already moved in
 * (never what the user placed), when it has new activity: one where people
 * now start most conversations (`people`) goes back out, and the move is
 * recorded for Home's card. Only `people` moves one out, not `ambiguous`, so
 * a channel near the line does not go back and forth.
 *
 * Nothing runs once the user deleted the view.
 */
import { observeWork, workWakes } from '../workControl'
import { AiProvider, tasks, type SampleMessage } from '@juno/ai'
import { junoVerdict } from '@juno/domain'
import { liveQuery, StoreReader, syncState, type InvalidationKeys, type SqlError } from '@juno/store'
import { BOOT_KEY } from '@juno/sync'
import { Clock, Duration, Effect, Layer, Stream } from 'effect'
import { aiAssistOn, aiJobsOn } from '../ai'
import { EngineConfig, EngineTiming } from '../config'
import { AiCredentials, aiWakes } from '../aiCredentials'
import { AiSpend } from '../aiSpend'
import { automatedViewState, candidates, classify, clearVerdict, moveBackOut, movedIn, moveToAutomated, selfIdOf, senderOf, setVerdict, write, type SampleRow } from '../automatedView'
import { userName, type UserRow } from '../topicRows'
import { Workspace, type StoreServices } from '../workspace'
import { decideAndStore, HOME_DAILY_BUDGET, usedToday } from './assist'
import { unescapeMrkdwn } from '@juno/richtext'

const KEYS: InvalidationKeys = ['conversations', 'topics', 'sync_state', 'sidebar_views', 'automated_channels', 'ignored_channels', 'prefs', 'users']
/** Juno calls one pass makes at most. */
const PASS_CALLS = 6
/** Messages Juno reads. */
const JUNO_MESSAGES = 20

interface Memory {
  /** Conversation id to what it was looked at with: its activity and whether AI assist was on. */
  readonly seen: Map<string, string>
  /** Conversations in Automated by the rules or Juno, to the activity they were last checked at. */
  readonly checked: Map<string, string>
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
    const timing = yield* EngineTiming
    const now = yield* Clock.currentTimeMillis
    const selfId = yield* selfIdOf
    yield* recheckMoved(memory, selfId, now)
    // With the AI jobs off (tests that do not opt in), ambiguous channels go to Home's question as with AI assist off.
    const ai = jobs && (yield* aiAssistOn)
    const due = (yield* candidates(now)).filter((row) => memory.seen.get(row.id) !== `${row.activity}|${ai}`)
    if (due.length === 0) return
    let calls = ai ? Math.min(PASS_CALLS, HOME_DAILY_BUDGET - (yield* usedToday(now))) : 0

    for (const row of due) {
      const { verdict, sample, counts } = yield* classify(row, selfId)
      const seen = () => memory.seen.set(row.id, `${row.activity}|${ai}`)
      if (verdict === 'automated') {
        yield* write(moveToAutomated(row.id, 'rules', now, { counts }))
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
          memory.deferred.set(row.id, { until: now + Math.min(timing.aiDeferCapMillis, timing.aiDeferBaseMillis * 2 ** (attempts - 1)), attempts })
        }
      }
      const judged = answer === undefined ? 'ambiguous' : junoVerdict(answer.probability)
      if (judged === 'automated') yield* write(moveToAutomated(row.id, 'juno', now, { counts, ...(answer?.reason === undefined ? {} : { reason: answer.reason }) }))
      else if (judged === 'people') {
        if (row.verdict === 'ask') yield* write(clearVerdict(row.id))
      } else {
        // Written only when something Home says changed, so a pass waiting on Juno does not wake the next.
        const by = answer === undefined ? 'rules' : 'juno'
        const why = { apps: counts.apps, sampled: counts.of, ...(answer?.reason === undefined ? {} : { reason: answer.reason }) }
        if (row.verdict !== 'ask' || row.by !== by || row.apps !== why.apps || row.sampled !== why.sampled || row.reason !== (why.reason ?? null)) yield* write(setVerdict(row.id, 'ask', by, now, why))
      }
      // Without Juno's answer yet, Home asks meanwhile and Juno is asked on a later pass.
      if (!ai || answer !== undefined) seen()
    }
  })

/**
 * Looks again at what the rules and Juno moved in, each when it has new
 * activity: where people now start most conversations, it goes back out.
 */
const recheckMoved = (memory: Memory, selfId: string | undefined, now: number) =>
  Effect.gen(function* () {
    for (const row of yield* movedIn) {
      const activity = row.activity ?? ''
      if (memory.checked.get(row.id) === activity) continue
      memory.checked.set(row.id, activity)
      const { verdict, counts } = yield* classify(row, selfId)
      if (verdict === 'people') yield* write(moveBackOut(row.id, row.by, now, { counts }))
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
    const timing = yield* EngineTiming
    const workspace = yield* Workspace
    const provider = yield* AiProvider
    const wakes = yield* aiWakes
    const jobs = yield* aiJobsOn
    const window = Duration.millis(timing.automatedWindowMillis)
    const passes = workspace.changes.pipe(
      Stream.switchMap((open) => {
        if (open === undefined) return Stream.empty
        const memory: Memory = { seen: new Map(), checked: new Map(), deferred: new Map() }
        // A wake forgets the waits and runs a pass after the one under way, which it does not stop.
        const woken = wakes.pipe(Stream.mapEffect(() => Effect.sync(() => {
          memory.seen.clear()
          memory.checked.clear()
          memory.deferred.clear()
        })))
        const triggers = Stream.merge(Stream.merge(liveQuery(KEYS, Effect.void).pipe(Stream.groupedWithin(1000, window)), Stream.tick(timing.automatedTickMillis)), woken)
        return triggers.pipe(
          Stream.merge(workWakes('automated')),
          Stream.mapEffect(() =>
            runPass(memory, jobs).pipe(observeWork('automated'),
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
