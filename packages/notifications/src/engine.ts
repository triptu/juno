import { AiProvider, notificationReading, type NotificationReadingInput } from '@juno/ai'
import { channelLabel, decideNotification, localTime, nextSwitchTime, sameHours, scheduledPresence, type Instruction, type NotificationDecision, type NotificationSettings, type Presence, type Reading } from '@juno/domain'
import { Invalidation, StoreWriter, type StoreReader } from '@juno/store'
import { Clock, Effect, Semaphore, SubscriptionRef } from 'effect'
import { exchangesWith, readConversation, type Conversation } from './conversation'
import { Candidate, StoredReading, type Notifier } from './model'
import { presenceHold, readSettings, type PresenceHold } from './settings'

/** The reading waits this long; then the decision goes on without it. */
const READING_MILLIS = 2000
const FOCUSED = '. Topic is visible in a focused window'

const kindOf = (candidate: Candidate) =>
  candidate.channel.kind === 'im' ? 'dm' as const : candidate.channel.kind === 'mpim' ? 'group DM' as const : candidate.topicId.startsWith('t:') ? 'thread' as const : 'channel' as const

const decide = (candidate: Candidate, at: number, settings: NotificationSettings, aiAssist: boolean, reading?: StoredReading) =>
  decideNotification({ ...candidate, at: localTime(at) }, settings, { aiAssist, userName: () => candidate.senderName }, reading as Reading | 'failed' | undefined)

/** What Juno's reading is given about one message. The replay tool (`scripts/notif-replay`) builds it the same way. */
export const readingInput = (candidate: Candidate, conversation: Conversation, instructions: ReadonlyArray<Instruction>, exchanges: number, now: number): NotificationReadingInput => ({
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
  instructions,
})

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
  const storeContext = yield* Effect.context<StoreReader | StoreWriter | Invalidation>()
  const configuration = readSettings.pipe(Effect.provide(storeContext))
  const lock = yield* Semaphore.make(1)
  /** Presence has its own permit, so a choice by hand never waits behind a decision's reading. */
  const presenceLock = yield* Semaphore.make(1)
  /** What Juno last told Slack; undefined until it has, so each session applies presence once. */
  let applied: Presence | undefined
  const current = yield* SubscriptionRef.make<Presence | undefined>(undefined)

  /** Stores the decision and, for a banner, claims and shows it. */
  const storeDecision = (id: number, candidate: Candidate, at: number, decision: NotificationDecision) =>
    Effect.gen(function* () {
      const { outcome, decidedBy, reason, ...rest } = decision
      yield* sql`UPDATE notification_log SET outcome = ${outcome}, decided_by = ${decidedBy}, decision_json = ${JSON.stringify(rest)},
        reason = CASE WHEN suppressed_at IS NULL THEN ${reason} ELSE ${reason + FOCUSED} END WHERE id = ${id}`
      if (outcome !== 'notify') return
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
      const answer = yield* ai.decide(notificationReading, readingInput(candidate, conversation, settings.instructions ?? [], exchanges, now))
        .pipe(Effect.timeout(READING_MILLIS), Effect.option)
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
      // Settings and hours are read again after the wait: a change made meanwhile, such as Never or the hours ending, wins.
      now = yield* Clock.currentTimeMillis
      const after = yield* configuration
      decision = decide(candidate, now, after.settings, after.aiAssist, reading)
    }
    if ('needsReading' in decision) return
    const rows = yield* sql<{ id: number }>`INSERT INTO notification_log
      (at, channel, ts, topic_id, preview, outcome, reason, candidate_json, judgement_json)
      VALUES (${new Date(now).toISOString()}, ${candidate.channel.id}, ${candidate.ts}, ${candidate.topicId}, ${candidate.text},
        ${decision.outcome}, ${decision.reason}, ${JSON.stringify(candidate)}, ${reading === undefined ? null : JSON.stringify(reading)})
      ON CONFLICT(channel, ts) DO NOTHING RETURNING id`
    const row = rows[0]
    if (row !== undefined) yield* storeDecision(row.id, candidate, now, decision)
    yield* logChanged
  })

  const readHold = presenceHold.read.pipe(Effect.provide(storeContext))
  const writeHold = (hold: PresenceHold | undefined) => presenceHold.write(hold).pipe(Effect.provide(storeContext))

  /** Holds `value` until the next switch in the active hours. */
  const hold = (value: Presence) => Effect.gen(function* () {
    const { settings } = yield* configuration
    const now = yield* Clock.currentTimeMillis
    yield* writeHold({ presence: value, until: nextSwitchTime(now, settings.presenceHours) ?? null, hours: settings.presenceHours })
  })

  /** The choice by hand while it holds; one that ended, or whose active hours changed since, is removed. */
  const heldPresence = (settings: NotificationSettings, now: number) => Effect.gen(function* () {
    const saved = yield* readHold
    if (saved === undefined) return undefined
    if (sameHours(saved.hours, settings.presenceHours) && (saved.until === null || now < saved.until)) return saved.presence
    yield* writeHold(undefined)
    return undefined
  })

  /** Applies the choice by hand while it holds, else the active hours; `force` sends it even when unchanged. */
  const tick = (force: boolean) => Effect.gen(function* () {
    const { settings } = yield* configuration
    const now = yield* Clock.currentTimeMillis
    const next = (yield* heldPresence(settings, now)) ?? scheduledPresence(localTime(now), settings.presenceHours)
    if (!force && next === applied) return
    if (yield* setPresence(next)) {
      applied = next
      yield* SubscriptionRef.set(current, next)
    }
  })

  return {
    receive: (candidate: Candidate) => receive(candidate).pipe(lock.withPermit),
    /** The log is history: a settings change re-decides nothing already logged. It can move the presence schedule. */
    settingsChanged: tick(false).pipe(presenceLock.withPermit),
    tick: tick(false).pipe(presenceLock.withPermit),
    wake: tick(true).pipe(presenceLock.withPermit),
    currentPresence: SubscriptionRef.get(current),
    /** What Slack shows, once known, then every change. */
    presenceChanges: SubscriptionRef.changes(current),
    /**
     * `manual_presence_change` for the owner. One Juno did not just send is a choice made in Slack, and holds as
     * one made in Juno does. It waits for a set in flight, so that set's own echo is not taken for one.
     */
    observePresence: (value: Presence) => Effect.gen(function* () {
      yield* SubscriptionRef.set(current, value)
      if (value === applied) return
      applied = value
      yield* hold(value)
    }).pipe(presenceLock.withPermit),
    /** Slack's value at boot (`client.userBoot` `self.manual_presence`), kept only while nothing newer is known: a set or an event wins. */
    seedPresence: (value: Presence) => SubscriptionRef.update(current, (known) => known ?? value),
    /**
     * Set yourself away or active. It shows at once, then holds until the next switch in the active hours,
     * through a wake and a new session. When Slack refuses it, the presence before comes back. Whether Slack took it.
     */
    setPresence: (value: Presence) => Effect.gen(function* () {
      const before = yield* SubscriptionRef.getAndSet(current, value)
      return yield* Effect.gen(function* () {
        const held = yield* readHold
        yield* hold(value)
        if (yield* setPresence(value)) {
          applied = value
          return true
        }
        yield* writeHold(held)
        yield* SubscriptionRef.set(current, before)
        return false
      }).pipe(presenceLock.withPermit)
    }),
  }
})
export type Notifications = Effect.Success<ReturnType<typeof makeNotifications>>
