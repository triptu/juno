import { AiProvider, urgencyGate } from '@juno/ai'
import { channelLabel, inHours, localTime, nextHoursStart, decideNotification, hoursStartSummary, scheduledPresence, slackPresence, type NotificationDecision, type Presence } from '@juno/domain'
import { StoreWriter, type StoreReader } from '@juno/store'
import { Clock, Effect, Schema, Semaphore } from 'effect'
import { Candidate, Judgement, type MessageSource, type Notifier } from './model'
import { readSettings } from './settings'

interface Row {
  readonly id: number
  readonly at: string
  readonly channel: string
  readonly ts: string
  readonly topic_id: string
  readonly candidate_json: string
  readonly judgement_json: string | null
  readonly outcome: NotificationDecision['outcome']
  readonly reason: string
  readonly delivered_at: string | null
}

/** One instance per signed-in workspace. All decisions and delivery claims share a permit. */
export const makeNotifications = Effect.fn('Notifications.make')(function* (notifier: Notifier, setPresence: (value: 'auto' | 'away') => Effect.Effect<boolean>) {
  const sql = yield* StoreWriter
  const ai = yield* AiProvider
  const settingsContext = yield* Effect.context<StoreReader>()
  const configuration = readSettings.pipe(Effect.provide(settingsContext))
  const lock = yield* Semaphore.make(1)
  let scheduled: Presence | undefined
  let current: Presence | undefined

  const storeDecision = (id: number, candidate: Candidate, at: number, decision: NotificationDecision, due: number | undefined) =>
    Effect.gen(function* () {
      yield* sql`UPDATE notification_log SET outcome = ${decision.outcome},
        reason = CASE WHEN suppressed_at IS NULL THEN ${decision.reason} ELSE ${decision.reason + ". Topic is visible in a focused window"} END,
        summary_due_at = ${decision.outcome === 'summary' && due !== undefined ? new Date(due).toISOString() : null} WHERE id = ${id}`
      if (decision.outcome !== 'now') return
      // Claim before the external effect. A repeated event or settings pass cannot ring twice.
      const focused = yield* notifier.viewing(candidate.topicId)
      const claimed = yield* sql<{ id: number }>`UPDATE notification_log
        SET delivered_at = ${focused ? null : new Date(at).toISOString()}, suppressed_at = ${focused ? new Date(at).toISOString() : null},
          reason = ${focused ? decision.reason + '. Topic is visible in a focused window' : decision.reason}
        WHERE id = ${id} AND delivered_at IS NULL AND suppressed_at IS NULL RETURNING id`
      if (claimed.length === 0 || focused) return
      yield* notifier.show({ id: `message:${id}`, title: channelLabel(candidate.channel), body: candidate.text,
        target: { kind: 'message', source: { channelId: candidate.channel.id, ts: candidate.ts, topicId: candidate.topicId } } })
    })

  const receive = Effect.fn('Notifications.receive')(function* (candidate: Candidate) {
    const existing = yield* sql`SELECT id FROM notification_log WHERE channel = ${candidate.channel.id} AND ts = ${candidate.ts}`
    if (existing.length > 0) return
    let now = yield* Clock.currentTimeMillis
    const { settings, aiAssist } = yield* configuration
    let decision = decideNotification({ ...candidate, at: localTime(now) }, settings, { aiAssist, userName: () => candidate.senderName })
    let judgement: Judgement | undefined
    if ('needsJudgement' in decision) {
      const answer = yield* ai.decide(urgencyGate, {
        messageTs: candidate.ts, channel: channelLabel(candidate.channel), channelKind: candidate.channel.kind,
        sender: candidate.senderName ?? candidate.senderId, text: candidate.text, mentionsMe: candidate.mentionsMe,
        matters: settings.matters, now: new Date(now).toISOString(),
      }).pipe(Effect.timeout(2000), Effect.option)
      if (answer._tag === 'Some' && answer.value._tag === 'Decided') judgement = answer.value.value
      now = yield* Clock.currentTimeMillis
      decision = decideNotification({ ...candidate, at: localTime(now) }, settings, { aiAssist: judgement !== undefined, userName: () => candidate.senderName }, judgement)
    }
    if ('needsJudgement' in decision) return
    const due = nextHoursStart(now, settings.notificationHours)
    const rows = yield* sql<{ id: number }>`INSERT INTO notification_log
      (at, channel, ts, topic_id, preview, outcome, reason, candidate_json, judgement_json, summary_due_at)
      VALUES (${new Date(now).toISOString()}, ${candidate.channel.id}, ${candidate.ts}, ${candidate.topicId}, ${candidate.text},
        ${decision.outcome}, ${decision.reason}, ${JSON.stringify(candidate)}, ${judgement === undefined ? null : JSON.stringify(judgement)},
        ${decision.outcome === 'summary' && due !== undefined ? new Date(due).toISOString() : null})
      ON CONFLICT(channel, ts) DO NOTHING RETURNING id`
    const row = rows[0]
    if (row !== undefined) yield* storeDecision(row.id, candidate, now, decision, due)
  })

  const rerun = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    const midnight = new Date(now)
    midnight.setHours(0, 0, 0, 0)
    const { settings, aiAssist } = yield* configuration
    const rows = yield* sql<Row>`SELECT * FROM notification_log WHERE at >= ${midnight.toISOString()} AND candidate_json IS NOT NULL`
    for (const row of rows) {
      const candidate = Schema.decodeUnknownSync(Candidate)(JSON.parse(row.candidate_json))
      const judgement = row.judgement_json === null ? undefined : Schema.decodeUnknownSync(Judgement)(JSON.parse(row.judgement_json))
      const at = new Date(row.at).getTime()
      const decision = decideNotification({ ...candidate, at: localTime(at) }, settings, { aiAssist: aiAssist && judgement !== undefined, userName: () => candidate.senderName }, judgement)
      if (!('needsJudgement' in decision)) yield* storeDecision(row.id, candidate, now, decision, nextHoursStart(at, settings.notificationHours))
    }
    // Older summaries keep their judgement. A schedule edit only moves a future or disabled start.
    const next = inHours(localTime(now), settings.notificationHours) ? now : nextHoursStart(now, settings.notificationHours)
    yield* sql`UPDATE notification_log SET summary_due_at = ${next === undefined ? null : new Date(next).toISOString()}
      WHERE outcome = 'summary' AND delivered_at IS NULL AND suppressed_at IS NULL
      AND (summary_due_at IS NULL OR summary_due_at > ${new Date(now).toISOString()})`
  })

  const summarize = Effect.gen(function* () {
    const now = new Date(yield* Clock.currentTimeMillis).toISOString()
    const rows = yield* sql<Row>`SELECT * FROM notification_log WHERE outcome = 'summary' AND delivered_at IS NULL AND suppressed_at IS NULL
      AND summary_due_at <= ${now} AND candidate_json IS NOT NULL ORDER BY at, id`
    const summary = hoursStartSummary(rows.map((row) => ({ decision: { outcome: row.outcome, reason: row.reason },
      where: channelLabel(Schema.decodeUnknownSync(Candidate)(JSON.parse(row.candidate_json)).channel) })))
    const first = rows[0]
    if (summary === undefined || first === undefined) return
    const sources: ReadonlyArray<MessageSource> = rows.map((row) => ({ channelId: row.channel, ts: row.ts, topicId: row.topic_id }))
    const source = sources[0]
    if (source === undefined) return
    const id = `summary:${rows.map((row) => row.id).join(',')}`
    const { aiAssist } = yield* configuration
    const target = aiAssist
      ? { kind: 'summary' as const, id: yield* notifier.summary({ id, at: now, sources, ...summary }) }
      : { kind: 'message' as const, source }
    yield* sql`UPDATE notification_log SET delivered_at = ${now} WHERE id IN ${sql.in(rows.map((row) => row.id))}`
    yield* notifier.show({ id, ...summary, target })
  })

  const tick = (force: boolean) => Effect.gen(function* () {
    const { settings } = yield* configuration
    const next = scheduledPresence(localTime(yield* Clock.currentTimeMillis), settings.presenceHours)
    if (force || next !== scheduled) {
      if (yield* setPresence(slackPresence(next))) { scheduled = next; current = next }
    }
    yield* summarize
  })

  return {
    receive: (candidate: Candidate) => receive(candidate).pipe(lock.withPermit),
    settingsChanged: rerun.pipe(Effect.andThen(tick(false)), lock.withPermit),
    tick: tick(false).pipe(lock.withPermit),
    wake: tick(true).pipe(lock.withPermit),
    currentPresence: Effect.sync(() => current),
    observePresence: (value: Presence) => Effect.sync(() => { current = value }),
    setPresence: (value: Presence) => Effect.gen(function* () {
      if (yield* setPresence(slackPresence(value))) current = value
    }).pipe(lock.withPermit),
  }
})
export type Notifications = Effect.Success<ReturnType<typeof makeNotifications>>
