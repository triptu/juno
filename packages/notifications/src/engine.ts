import { AiProvider, notificationReading } from '@juno/ai'
import { channelLabel, decideNotification, localTime, scheduledPresence, type NotificationDecision, type NotificationSettings, type Presence, type Reading } from '@juno/domain'
import { Invalidation, StoreWriter, type StoreReader } from '@juno/store'
import { Clock, Effect, Schema, Semaphore, SubscriptionRef } from 'effect'
import { exchangesWith, readConversation, type Conversation } from './conversation'
import { Candidate, StoredReading, type Notifier } from './model'
import { readSettings } from './settings'

interface Row {
  readonly id: number
  readonly at: string
  readonly candidate_json: string
  readonly judgement_json: string | null
}

/** The reading waits this long; then the decision goes on without it. */
const READING_MILLIS = 2000
const FOCUSED = '. Topic is visible in a focused window'

const decodeReading = (json: string | null): StoredReading | undefined => {
  if (json === null) return undefined
  try {
    return Schema.decodeUnknownSync(StoredReading)(JSON.parse(json))
  } catch {
    return undefined
  }
}

const kindOf = (candidate: Candidate) =>
  candidate.channel.kind === 'im' ? 'dm' as const : candidate.channel.kind === 'mpim' ? 'group DM' as const : candidate.topicId.startsWith('t:') ? 'thread' as const : 'channel' as const

const decide = (candidate: Candidate, at: number, settings: NotificationSettings, aiAssist: boolean, reading?: StoredReading) =>
  decideNotification({ ...candidate, at: localTime(at) }, settings, { aiAssist, userName: () => candidate.senderName }, reading as Reading | 'failed' | undefined)

/**
 * One instance per signed-in workspace. All decisions and delivery claims share a permit.
 * `self` is the owner's user id, for the facts about who wrote what.
 */
export const makeNotifications = Effect.fn('Notifications.make')(function* (notifier: Notifier, setPresence: (value: Presence) => Effect.Effect<boolean>, self = '') {
  const sql = yield* StoreWriter
  const invalidation = yield* Invalidation
  /** The Notifications page's Today and its Details read the log. */
  const logChanged = invalidation.invalidate(['notification_log'])
  const ai = yield* AiProvider
  const settingsContext = yield* Effect.context<StoreReader>()
  const configuration = readSettings.pipe(Effect.provide(settingsContext))
  const lock = yield* Semaphore.make(1)
  let scheduled: Presence | undefined
  const current = yield* SubscriptionRef.make<Presence | undefined>(undefined)

  /** Stores the decision; on arrival (`deliver`), claims and shows the banner. A re-run never shows one: a message that stayed does not notify later. */
  const storeDecision = (id: number, candidate: Candidate, at: number, decision: NotificationDecision, deliver: boolean) =>
    Effect.gen(function* () {
      const { outcome, decidedBy, reason, ...rest } = decision
      yield* sql`UPDATE notification_log SET outcome = ${outcome}, decided_by = ${decidedBy}, decision_json = ${JSON.stringify(rest)},
        reason = CASE WHEN suppressed_at IS NULL THEN ${reason} ELSE ${reason + FOCUSED} END WHERE id = ${id}`
      if (outcome !== 'notify' || !deliver) return
      // Claim before the external effect. A repeated event or settings pass cannot ring twice.
      const focused = yield* notifier.viewing(candidate.topicId)
      const claimed = yield* sql<{ id: number }>`UPDATE notification_log
        SET delivered_at = ${focused ? null : new Date(at).toISOString()}, suppressed_at = ${focused ? new Date(at).toISOString() : null},
          reason = ${focused ? reason + FOCUSED : reason}
        WHERE id = ${id} AND delivered_at IS NULL AND suppressed_at IS NULL RETURNING id`
      if (claimed.length === 0 || focused) return
      yield* notifier.show({ id: `message:${id}`, title: channelLabel(candidate.channel), body: candidate.text,
        target: { kind: 'message', source: { channelId: candidate.channel.id, ts: candidate.ts, topicId: candidate.topicId } } })
    })

  /** Juno's reading of the message, or `failed` when it gives none within two seconds. */
  const read = (candidate: Candidate, conversation: Conversation, settings: NotificationSettings, now: number) =>
    Effect.gen(function* () {
      const exchanges = yield* exchangesWith(sql, candidate.senderId, now)
      const answer = yield* ai.decide(notificationReading, {
        messageTs: candidate.ts, where: channelLabel(candidate.channel), kind: kindOf(candidate),
        sender: candidate.senderName ?? 'Someone', text: candidate.text, mentionsMe: candidate.mentionsMe, now: new Date(now).toISOString(),
        ...(conversation.threadRoot === undefined ? {} : { threadRoot: conversation.threadRoot }),
        before: conversation.before,
        facts: {
          ...(conversation.facts.ownerWroteMinutesAgo === undefined ? {} : { ownerWroteMinutesAgo: Math.round(conversation.facts.ownerWroteMinutesAgo) }),
          ownerWroteLast: conversation.facts.ownerWroteLast === true,
          ownerStartedThread: conversation.facts.ownerStartedThread === true,
          senderWroteSinceOwner: conversation.senderWroteSinceOwner,
          exchangesLast30Days: exchanges,
        },
        instructions: settings.instructions ?? [],
      }).pipe(Effect.timeout(READING_MILLIS), Effect.option)
      if (answer._tag === 'None' || answer.value._tag !== 'Decided') return 'failed' as const
      const { instruction, ...rest } = answer.value.value
      return { ...rest, ...(instruction === null ? {} : { instruction }) } as StoredReading
    })

  const receive = Effect.fn('Notifications.receive')(function* (incoming: Candidate) {
    const existing = yield* sql`SELECT id FROM notification_log WHERE channel = ${incoming.channel.id} AND ts = ${incoming.ts}`
    if (existing.length > 0) return
    let now = yield* Clock.currentTimeMillis
    const { settings, aiAssist } = yield* configuration
    const conversation = yield* readConversation(sql, self, incoming, now)
    const candidate: Candidate = { ...incoming, facts: conversation.facts }
    let decision = decide(candidate, now, settings, aiAssist)
    let reading: StoredReading | undefined
    if ('needsReading' in decision) {
      reading = yield* read(candidate, conversation, settings, now)
      // The hours are checked again after the wait, so it cannot notify past their end.
      now = yield* Clock.currentTimeMillis
      decision = decide(candidate, now, settings, aiAssist, reading)
    }
    if ('needsReading' in decision) return
    const rows = yield* sql<{ id: number }>`INSERT INTO notification_log
      (at, channel, ts, topic_id, preview, outcome, reason, candidate_json, judgement_json)
      VALUES (${new Date(now).toISOString()}, ${candidate.channel.id}, ${candidate.ts}, ${candidate.topicId}, ${candidate.text},
        ${decision.outcome}, ${decision.reason}, ${JSON.stringify(candidate)}, ${reading === undefined ? null : JSON.stringify(reading)})
      ON CONFLICT(channel, ts) DO NOTHING RETURNING id`
    const row = rows[0]
    if (row !== undefined) yield* storeDecision(row.id, candidate, now, decision, true)
    yield* logChanged
  })

  /**
   * Today's rows again, at their own times, with their stored facts and readings, so Today and Details
   * say what the settings decide now. A row that would need a reading it does not have keeps its decision.
   */
  const rerun = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    const midnight = new Date(now)
    midnight.setHours(0, 0, 0, 0)
    const { settings, aiAssist } = yield* configuration
    const rows = yield* sql<Row>`SELECT id, at, candidate_json, judgement_json FROM notification_log WHERE at >= ${midnight.toISOString()} AND candidate_json IS NOT NULL`
    for (const row of rows) {
      const candidate = Schema.decodeUnknownSync(Candidate)(JSON.parse(row.candidate_json))
      const decision = decide(candidate, new Date(row.at).getTime(), settings, aiAssist, decodeReading(row.judgement_json))
      if (!('needsReading' in decision)) yield* storeDecision(row.id, candidate, now, decision, false)
    }
    yield* logChanged
  })

  const tick = (force: boolean) => Effect.gen(function* () {
    const { settings } = yield* configuration
    const next = scheduledPresence(localTime(yield* Clock.currentTimeMillis), settings.presenceHours)
    if (force || next !== scheduled) {
      if (yield* setPresence(next)) {
        scheduled = next
        yield* SubscriptionRef.set(current, next)
      }
    }
  })

  return {
    receive: (candidate: Candidate) => receive(candidate).pipe(lock.withPermit),
    settingsChanged: rerun.pipe(Effect.andThen(tick(false)), lock.withPermit),
    tick: tick(false).pipe(lock.withPermit),
    wake: tick(true).pipe(lock.withPermit),
    currentPresence: SubscriptionRef.get(current),
    /** What Slack shows, once known, then every change. */
    presenceChanges: SubscriptionRef.changes(current),
    observePresence: (value: Presence) => SubscriptionRef.set(current, value),
    /** Slack's value at boot (`client.userBoot` `self.manual_presence`), kept only while nothing newer is known: a set or an event wins. */
    seedPresence: (value: Presence) => SubscriptionRef.update(current, (known) => known ?? value),
    setPresence: (value: Presence) => Effect.gen(function* () {
      if (!(yield* setPresence(value))) return
      yield* SubscriptionRef.set(current, value)
      // A change by hand holds until the next switch, even when it comes before the first tick.
      const { settings } = yield* configuration
      scheduled = scheduledPresence(localTime(yield* Clock.currentTimeMillis), settings.presenceHours)
    }).pipe(lock.withPermit),
  }
})
export type Notifications = Effect.Success<ReturnType<typeof makeNotifications>>
