/**
 * Handlers for the notification routes (spec section 14, inventory 2.1,
 * 13 and 15). The settings live in the `notifications` pref, validated by
 * `@juno/notifications`; every write goes through `updateSettings`, one at
 * a time, and the running pipeline re-decides today's messages when the
 * pref changes (`notificationRuntime.ts`).
 *
 * Notify me on a thread is also its follow (SPEC 5): Every message and
 * When it matters follow it in Slack through `topics.subscribe`, Never
 * unfollows it. Only Every message is stored as a thread level.
 *
 * Writing the notification hours into Slack's own schedule (the `dnd_*`
 * user prefs) is not done: the owner has not approved writing Slack's
 * prefs. `slackScheduleSeam` is where it goes (docs/backlog.md).
 */
import { Clock, Effect, Schema, Semaphore, Stream } from 'effect'
import {
  NotFound,
  NotificationsRoutes,
  NotSignedIn,
  type CommandResult,
  type Hours,
  type NotificationSettingsView,
  type NotificationsPage,
  type NotificationStatus,
  type NotifyTag,
  type NotifyTargetView,
  type TodayRow,
  type Why,
} from '@juno/contract'
import {
  channelLabel,
  decideWithCause,
  hourLabel,
  localTime,
  notifyChoice,
  parseTopicId,
  pausedLabel,
  presenceLabel,
  scheduledPresence,
  threadNotifyChoice,
  type ConversationKind,
  type NotificationSettings,
  type NotifyChoice,
} from '@juno/domain'
import { Candidate, Judgement, NotificationSettingsSchema, readSettings } from '@juno/notifications'
import { liveQuery, prefs, StoreReader, transaction, type InvalidationKeys, type SqlError } from '@juno/store'
import { NotificationControl } from '../notificationRuntime'
import { Outbox } from '../outbox'
import { retryFirstRun, serveLiveValue, timed, type Run } from '../protocol/live'
import { setSubscribed } from '../follow'
import { Workspace, type StoreServices } from '../workspace'

const SETTINGS_KEYS: InvalidationKeys = ['prefs']
const PAGE_KEYS: InvalidationKeys = ['prefs', 'notification_log', 'conversations', 'users']
const TODAY_LIMIT = 50

/**
 * Writes Slack's own notification schedule from the notification hours.
 * Disabled: the owner has not approved writing Slack's prefs, and a live
 * write may go only to a private test channel or the self-DM. The research
 * is in docs/research/slack-data-access.md section 7; the backlog has the
 * steps. Until then the page does not say that the phone pauses.
 */
const slackScheduleSeam = (_hours: Hours): Effect.Effect<void> => Effect.void

const levelsOf = (settings: NotificationSettings) => ({ ...settings, threads: settings.threads ?? {} })

/** Every channel and person on a list, with their names. Unknown ids show as they are. */
const tagsFor = (settings: NotificationSettings, level: 'every' | 'never') =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const channelIds = Object.keys(settings.channels).filter((id) => settings.channels[id] === level)
    const personIds = Object.keys(settings.people).filter((id) => settings.people[id] === level)
    const channels = channelIds.length === 0 ? [] : yield* sql<{ id: string; kind: ConversationKind; name: string | null; person: string | null }>`
      SELECT c.id, c.kind, c.name, COALESCE(u.display_name, u.real_name, u.name) AS person FROM conversations c
      LEFT JOIN users u ON u.id = c.user_id WHERE c.id IN ${sql.in(channelIds)}`
    const people = personIds.length === 0 ? [] : yield* sql<{ id: string; name: string | null; avatar_url: string | null }>`
      SELECT id, COALESCE(display_name, real_name, name) AS name, avatar_url FROM users WHERE id IN ${sql.in(personIds)}`
    const channelById = new Map(channels.map((row) => [row.id, row]))
    const personById = new Map(people.map((row) => [row.id, row]))
    const tags: NotifyTag[] = []
    for (const id of channelIds) {
      const row = channelById.get(id)
      const kind = row?.kind ?? 'public'
      tags.push({ kind: 'channel', id, name: row?.person ?? row?.name ?? id, channelKind: kind })
    }
    for (const id of personIds) {
      const row = personById.get(id)
      tags.push({ kind: 'person', id, name: row?.name ?? id, ...(row?.avatar_url == null ? {} : { avatarUrl: row.avatar_url }) })
    }
    return tags.toSorted((a, b) => a.name.localeCompare(b.name))
  })

interface LogRow {
  readonly id: number
  readonly at: string
  readonly outcome: 'now' | 'summary' | 'hold'
  readonly reason: string | null
  readonly preview: string | null
  readonly candidate_json: string | null
  readonly judgement_json: string | null
  readonly delivered_at: string | null
  readonly suppressed_at: string | null
  readonly summary_due_at: string | null
}

const decodeCandidate = (json: string | null): Candidate | undefined => {
  if (json === null) return undefined
  try {
    return Schema.decodeUnknownSync(Candidate)(JSON.parse(json))
  } catch {
    return undefined
  }
}

const today = (now: number) =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const midnight = new Date(now)
    midnight.setHours(0, 0, 0, 0)
    const since = midnight.toISOString()
    const counts = yield* sql<{ interrupted: number; held: number }>`
      SELECT COALESCE(SUM(delivered_at IS NOT NULL AND outcome = 'now'), 0) AS interrupted, COALESCE(SUM(outcome = 'hold'), 0) AS held
      FROM notification_log WHERE at >= ${since}`
    const rows = yield* sql<LogRow>`SELECT * FROM notification_log WHERE at >= ${since} AND outcome = 'now' AND delivered_at IS NOT NULL
      ORDER BY at DESC, id DESC LIMIT ${TODAY_LIMIT}`
    const list: TodayRow[] = rows.map((row) => {
      const candidate = decodeCandidate(row.candidate_json)
      return {
        id: row.id,
        at: new Date(row.at).getTime(),
        place: candidate === undefined ? '' : channelLabel(candidate.channel),
        sender: candidate?.senderName ?? '',
        text: row.preview ?? '',
        reason: row.reason ?? '',
      }
    })
    return { interrupted: counts[0]?.interrupted ?? 0, held: counts[0]?.held ?? 0, today: list }
  })

const clock = (iso: string) => {
  const date = new Date(iso)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** The why for a message the pipeline decided: the stored outcome and reason, and what decided it. */
const whyOfRow = (row: LogRow, settings: NotificationSettings, aiAssist: boolean): Why => {
  const reason = row.reason ?? ''
  const notified = row.outcome === 'now' && row.delivered_at !== null
  const title = notified
    ? `Notified you at ${clock(row.delivered_at ?? row.at)}`
    : row.outcome === 'summary'
      ? row.summary_due_at === null ? 'Kept for your summary' : `In the ${hourLabel(localTime(new Date(row.summary_due_at).getTime()).minutes)} summary`
      : "Didn't notify you"
  const candidate = decodeCandidate(row.candidate_json)
  if (candidate === undefined) return { notified, title, reason, action: { kind: 'none' } }
  const judgement = row.judgement_json === null ? undefined : Schema.decodeUnknownOption(Judgement)(JSON.parse(row.judgement_json))
  const at = localTime(new Date(row.at).getTime())
  const decided = decideWithCause({ ...candidate, at }, settings, { aiAssist: aiAssist && judgement?._tag === 'Some', userName: () => candidate.senderName }, judgement?._tag === 'Some' ? judgement.value : undefined)
  // Settings changed since, in a way today's re-run did not reach: say what happened, offer nothing.
  if ('needsJudgement' in decided || !reason.startsWith(decided.decision.reason)) return { notified, title, reason, action: { kind: 'none' } }
  const { cause } = decided
  switch (cause.kind) {
    case 'level': {
      const target = cause.target
      const name = target.kind === 'thread' ? 'This thread' : target.kind === 'channel' ? channelLabel(candidate.channel) : candidate.senderName ?? target.id
      return { notified, title, reason, action: { kind: 'change', target, name } }
    }
    case 'hours':
      return { notified, title, reason, action: { kind: 'hours' } }
    case 'juno':
      return { notified, title, reason, action: { kind: 'juno' } }
    default:
      return { notified, title, reason, action: { kind: 'none' } }
  }
}

/** The why for a message the pipeline never saw: a Never level, an ignored channel, or Juno only checks some messages. */
const whyUnseen = (topicId: string, channel: string, ts: string, settings: NotificationSettings) =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const parsed = parseTopicId(topicId)
    const threadTs = parsed?.kind === 'thread' ? parsed.threadTs : ''
    const rows = yield* sql<{ kind: ConversationKind; name: string | null; person: string | null; ignored: number; sender: string | null; sender_name: string | null; subscribed: number | null }>`
      SELECT c.kind, c.name, COALESCE(u.display_name, u.real_name, u.name) AS person, ig.channel IS NOT NULL AS ignored,
        m.user_id AS sender, COALESCE(sender.display_name, sender.real_name, sender.name) AS sender_name,
        (SELECT subscribed FROM thread_subs s WHERE s.channel = c.id AND s.thread_ts = ${threadTs}) AS subscribed
      FROM conversations c LEFT JOIN users u ON u.id = c.user_id LEFT JOIN ignored_channels ig ON ig.channel = c.id
      LEFT JOIN messages m ON m.channel = c.id AND m.ts = ${ts} LEFT JOIN users sender ON sender.id = m.user_id
      WHERE c.id = ${channel}`
    const row = rows[0]
    const title = "Didn't notify you"
    if (row === undefined) return { notified: false, title, reason: 'Juno does not know this conversation yet.', action: { kind: 'none' } } satisfies Why
    const where = channelLabel({ kind: row.kind, name: row.person ?? row.name ?? channel })
    if (row.ignored === 1) return { notified: false, title, reason: `${where} is ignored`, action: { kind: 'none' } } satisfies Why
    if (parsed?.kind === 'thread' && row.subscribed === 0) {
      return { notified: false, title, reason: 'This thread is set to Never', action: { kind: 'change', target: { kind: 'thread', id: topicId }, name: 'This thread' } } satisfies Why
    }
    if (settings.channels[channel] === 'never') {
      return { notified: false, title, reason: `${where} is set to Never`, action: { kind: 'change', target: { kind: 'channel', id: channel }, name: where } } satisfies Why
    }
    if (row.sender !== null && settings.people[row.sender] === 'never') {
      const name = row.sender_name ?? row.sender
      return { notified: false, title, reason: `${name} is set to Never`, action: { kind: 'change', target: { kind: 'person', id: row.sender }, name } } satisfies Why
    }
    return {
      notified: false,
      title,
      reason: 'Juno checks DMs, mentions of you, and places set to Every message. This was none of them.',
      action: { kind: 'change', target: { kind: 'channel', id: channel }, name: where },
    } satisfies Why
  })

/** A thread topic id's channel and root, or undefined for anything else. */
const thread = (id: string) => {
  const parsed = parseTopicId(id)
  return parsed?.kind === 'thread' ? parsed : undefined
}

/** The settings with one Notify me choice applied. When it matters is no entry; a thread's Never is its follow flag, not an entry. */
const withLevel = (settings: NotificationSettings, target: NotifyTargetView, choice: NotifyChoice): NotificationSettings => {
  const set = (map: Readonly<Record<string, 'every' | 'never'>> | undefined, allowNever: boolean) => {
    const { [target.id]: _, ...rest } = map ?? {}
    return choice === 'every' || (choice === 'never' && allowNever) ? { ...rest, [target.id]: choice } : rest
  }
  switch (target.kind) {
    case 'channel':
      return { ...settings, channels: set(settings.channels, true) }
    case 'person':
      return { ...settings, people: set(settings.people, true) }
    case 'thread':
      // A thread's Never is its follow flag, not a stored level.
      return { ...settings, threads: set(settings.threads, false) }
  }
}

/** A thread's choice from its follow flag and level. */
const threadChoice = (id: string, settings: NotificationSettings) =>
  Effect.gen(function* () {
    const parsed = thread(id)
    if (parsed === undefined) return 'never' as NotifyChoice
    const sql = yield* StoreReader
    const rows = yield* sql<{ subscribed: number }>`SELECT subscribed FROM thread_subs WHERE channel = ${parsed.channel} AND thread_ts = ${parsed.threadTs}`
    return threadNotifyChoice(rows[0]?.subscribed === 1, settings.threads?.[id])
  })

export const NotificationsHandlers = NotificationsRoutes.toLayer(
  Effect.gen(function* () {
    const workspace = yield* Workspace
    const outbox = yield* Outbox
    const control = yield* NotificationControl
    // Read-modify-write of one pref: one writer at a time, so two quick changes never lose one.
    const writes = yield* Semaphore.make(1)

    const runs = <A>(keys: InvalidationKeys, query: Effect.Effect<A, SqlError, StoreServices>, tick?: Stream.Stream<unknown>): Stream.Stream<Run<A, SqlError>> =>
      workspace.changes.pipe(
        Stream.switchMap((open) => {
          if (open === undefined) return Stream.empty
          const run = timed(query)
          const live = liveQuery(keys, run)
          const all = tick === undefined ? live : Stream.merge(live, tick.pipe(Stream.mapEffect(() => Effect.result(run))))
          return all.pipe(Stream.provide(open.context))
        }),
      )

    const inWorkspace = <A, E>(effect: Effect.Effect<A, E, StoreServices>): Effect.Effect<A, E | NotSignedIn> =>
      Effect.gen(function* () {
        const open = yield* workspace.current
        if (open === undefined) return yield* new NotSignedIn()
        return yield* effect.pipe(Effect.provide(open.context))
      })

    const updateSettings = (change: (settings: NotificationSettings) => NotificationSettings) =>
      inWorkspace(
        Effect.gen(function* () {
          const { settings } = yield* readSettings
          const next = Schema.decodeUnknownSync(NotificationSettingsSchema)(change(settings))
          yield* transaction(prefs.set('notifications', next))
          return { before: settings, after: next }
        }).pipe(Effect.orDie),
      ).pipe(writes.withPermit)

    const settingsView = Effect.map(readSettings, ({ settings, aiAssist }): NotificationSettingsView => ({ ...levelsOf(settings), aiAssist }))

    const status = Effect.gen(function* () {
      const now = localTime(yield* Clock.currentTimeMillis)
      const { settings } = yield* readSettings
      const presence = (yield* control.currentPresence) ?? null
      const shown = presence ?? scheduledPresence(now, settings.presenceHours)
      const paused = pausedLabel(now, settings.notificationHours)
      return { presence, presenceLabel: presenceLabel(now, shown, settings.presenceHours), ...(paused === undefined ? {} : { paused }) } satisfies NotificationStatus
    })

    const setLevel = (target: NotifyTargetView, choice: NotifyChoice) =>
      Effect.gen(function* () {
        const before = yield* inWorkspace(
          Effect.gen(function* () {
            const { settings } = yield* readSettings
            if (target.kind === 'thread') return yield* threadChoice(target.id, settings)
            return notifyChoice((target.kind === 'channel' ? settings.channels : settings.people)[target.id])
          }).pipe(Effect.orDie),
        )
        if (target.kind === 'thread') {
          if (thread(target.id) === undefined) return yield* new NotFound({ kind: 'topic', id: target.id })
          const follow = choice !== 'never'
          if (follow !== (before !== 'never')) {
            yield* setSubscribed(target.id, follow).pipe(Effect.provideService(Workspace, workspace), Effect.provideService(Outbox, outbox))
          }
        }
        yield* updateSettings((settings) => withLevel(settings, target, choice))
        const result: CommandResult = before === choice ? {} : { undo: { _tag: 'notifications.setLevel', target, choice: before } }
        return result
      })

    return {
      'notifications.settings': () =>
        serveLiveValue(runs(SETTINGS_KEYS, settingsView)).pipe(retryFirstRun('notifications.settings'), Stream.orDie),
      'notifications.page': () =>
        serveLiveValue(
          runs(
            PAGE_KEYS,
            Effect.gen(function* () {
              const { settings } = yield* readSettings
              const now = yield* Clock.currentTimeMillis
              return { every: yield* tagsFor(settings, 'every'), never: yield* tagsFor(settings, 'never'), ...(yield* today(now)) } satisfies NotificationsPage
            }),
            // Today starts again at midnight.
            Stream.tick('1 minute').pipe(Stream.drop(1)),
          ),
        ).pipe(retryFirstRun('notifications.page'), Stream.orDie),
      'notifications.status': () =>
        serveLiveValue(
          // The presence stream starts with the current value, which can be newer than what the first
          // run read (the two start together), so it is not dropped: it costs one more run.
          runs(SETTINGS_KEYS, status, Stream.merge(control.presence, Stream.tick('1 minute').pipe(Stream.drop(1)))),
        ).pipe(retryFirstRun('notifications.status'), Stream.orDie),
      'notifications.why': ({ topicId, ts }) =>
        inWorkspace(
          Effect.gen(function* () {
            const parsed = parseTopicId(topicId)
            const channel = parsed?.channel ?? ''
            const sql = yield* StoreReader
            const { settings, aiAssist } = yield* readSettings
            const rows = yield* sql<LogRow>`SELECT * FROM notification_log WHERE channel = ${channel} AND ts = ${ts}`
            const row = rows[0]
            return row === undefined ? yield* whyUnseen(topicId, channel, ts, settings) : whyOfRow(row, settings, aiAssist)
          }).pipe(Effect.orDie),
        ),
      'notifications.setHours': ({ which, hours }) =>
        Effect.gen(function* () {
          yield* updateSettings((settings) => (which === 'notifications' ? { ...settings, notificationHours: hours } : { ...settings, presenceHours: hours }))
          if (which === 'notifications') yield* slackScheduleSeam(hours)
        }),
      'notifications.setMatters': ({ text }) => updateSettings((settings) => ({ ...settings, matters: text.trim() })).pipe(Effect.asVoid),
      'notifications.setLevel': ({ target, choice }) => setLevel(target, choice),
      'notifications.setPresence': ({ presence }) =>
        Effect.gen(function* () {
          if ((yield* workspace.current) === undefined) return yield* new NotSignedIn()
          yield* control.setPresence(presence)
        }),
    }
  }),
)
