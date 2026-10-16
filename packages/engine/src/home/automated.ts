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
 *   off or no provider, Home asks (`ask`).
 * - people or too few messages: it stays, and an open question goes.
 *
 * Nothing runs once the user deleted the view.
 */
import { AiProvider, tasks, type SampleMessage } from '@juno/ai'
import { junoVerdict } from '@juno/domain'
import { liveQuery, StoreReader, syncState, type InvalidationKeys, type SqlError } from '@juno/store'
import { BOOT_KEY } from '@juno/sync'
import { Clock, Effect, Layer, Stream } from 'effect'
import { aiAssistOn } from '../ai'
import { AiCredentials } from '../aiCredentials'
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

/** Juno's stored probability for the conversation, if it answered before. */
const storedAnswer = (channel: string) =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const row = (yield* sql<{ output_json: string }>`SELECT output_json FROM ai_cache WHERE task = 'automatedChannel' AND key = ${channel}`)[0]
    if (row === undefined) return undefined
    try {
      const value = JSON.parse(row.output_json) as { probability?: unknown }
      return typeof value.probability === 'number' ? value.probability : undefined
    } catch {
      return undefined
    }
  })

const runPass = (memory: Memory): Effect.Effect<void, SqlError, StoreServices | AiProvider> =>
  Effect.gen(function* () {
    if ((yield* syncState.get(BOOT_KEY)) === undefined) return
    if ((yield* automatedViewState) === 'deleted') return
    const now = yield* Clock.currentTimeMillis
    const ai = yield* aiAssistOn
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
      let probability = ai ? yield* storedAnswer(row.id) : undefined
      if (ai && probability === undefined && calls > 0 && (memory.deferred.get(row.id)?.until ?? 0) <= now) {
        calls -= 1
        const decision = yield* decideAndStore(tasks.automatedChannel, {
          channelId: row.id,
          channel: `#${row.name ?? row.id}`,
          ...(row.topic === null || row.topic === '' ? {} : { topic: row.topic }),
          messages: yield* junoSample(sample.slice(0, JUNO_MESSAGES), selfId),
        })
        if (decision._tag === 'Decided') probability = decision.value.probability
        else {
          const attempts = (memory.deferred.get(row.id)?.attempts ?? 0) + 1
          memory.deferred.set(row.id, { until: now + Math.min(DEFER_CAP_MILLIS, DEFER_BASE_MILLIS * 2 ** (attempts - 1)), attempts })
        }
      }
      const judged = probability === undefined ? 'ambiguous' : junoVerdict(probability)
      if (judged === 'automated') yield* write(moveToAutomated(row.id, 'juno', now))
      else if (judged === 'people') {
        if (row.verdict === 'ask') yield* write(clearVerdict(row.id))
      } else if (row.verdict !== 'ask') yield* write(setVerdict(row.id, 'ask', probability === undefined ? 'rules' : 'juno', now))
      // Without Juno's answer yet, Home asks meanwhile and Juno is asked on a later pass.
      if (!ai || probability !== undefined) seen()
    }
  })

/** The sample as Juno reads it, oldest first, with names. */
const junoSample = (rows: ReadonlyArray<SampleRow>, selfId: string | undefined) =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const ids = [...new Set(rows.flatMap((row) => (row.user_id === null ? [] : [row.user_id])))]
    const users = new Map<string, UserRow>()
    if (ids.length > 0) for (const user of yield* sql<UserRow>`SELECT id, name, display_name, real_name, avatar_url FROM users WHERE id IN ${sql.in(ids)}`) users.set(user.id, user)
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
export const AutomatedJob: Layer.Layer<never, never, Workspace | AiProvider | AiCredentials> = Layer.effectDiscard(
  Effect.gen(function* () {
    const workspace = yield* Workspace
    const provider = yield* AiProvider
    const credentials = yield* AiCredentials
    const passes = workspace.changes.pipe(
      Stream.zipLatest(credentials.revisions),
      Stream.switchMap(([open]) => {
        if (open === undefined) return Stream.empty
        const memory: Memory = { seen: new Map(), deferred: new Map() }
        const triggers = Stream.merge(liveQuery(KEYS, Effect.void).pipe(Stream.groupedWithin(1000, WINDOW)), Stream.tick(TICK))
        return triggers.pipe(
          Stream.mapEffect(() =>
            runPass(memory).pipe(
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
