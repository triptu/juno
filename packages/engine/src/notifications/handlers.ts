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
 * Slack's own schedule (the `dnd_*` user prefs) follows the notification
 * hours through `SlackSchedule` (`../slackSchedule.ts`), which watches the
 * hours itself, so every way of changing them reaches it. The page carries
 * its state; the switch and Restore are served here.
 */
import { Clock, Effect, Schema, Semaphore, Stream } from 'effect'
import {
  NotFound,
  NotificationsRoutes,
  NotSignedIn,
  type CommandResult,
  type Hours, type NotificationSettingsView,
  type NotificationsPage,
  type NotificationStatus,
  type NotifyTag,
  type NotifyTargetView,
  type TodayRow,
} from '@juno/contract'
import {
  channelLabel,
  localTime,
  notifyChoice,
  parseTopicId,
  pausedLabel,
  presenceLabel,
  scheduledPresence,
  seenNote,
  threadNotifyChoice,
  type ConversationKind,
  type NotificationSettings,
  type NotifyChoice,
} from '@juno/domain'
import { Candidate, NotificationSettingsSchema, readSettings } from '@juno/notifications'
import { liveQuery, prefs, StoreReader, transaction, type InvalidationKeys, type SqlError } from '@juno/store'
import { NotificationControl } from '../notificationRuntime'
import { SelfPresence } from '../selfPresence'
import { Outbox } from '../outbox'
import { SlackSchedule, slackScheduleView } from '../slackSchedule'
import { retryFirstRun, serveLiveValue, timed, type Run } from '../protocol/live'
import { setSubscribed } from '../follow'
import { Workspace, type StoreServices } from '../workspace'
import { UNKNOWN_PERSON } from '@juno/richtext'

const SETTINGS_KEYS: InvalidationKeys = ['prefs']
const PAGE_KEYS: InvalidationKeys = ['prefs', 'notification_log', 'conversations', 'users', 'team']
const TODAY_LIMIT = 50

const levelsOf = (settings: NotificationSettings) => ({ ...settings, threads: settings.threads ?? {}, huddleRing: settings.huddleRing !== false })

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
      tags.push({ kind: 'person', id, name: row?.name ?? UNKNOWN_PERSON, ...(row?.avatar_url == null ? {} : { avatarUrl: row.avatar_url }) })
    }
    return tags.toSorted((a, b) => a.name.localeCompare(b.name))
  })

interface LogRow {
  readonly id: number
  readonly at: string
  readonly outcome: 'now' | 'hold'
  readonly reason: string | null
  readonly preview: string | null
  readonly candidate_json: string | null
  readonly judgement_json: string | null
  readonly delivered_at: string | null
  readonly suppressed_at: string | null
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
    const selfPresence = yield* SelfPresence
    const slackSchedule = yield* SlackSchedule
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

    const changeHours = (which: 'notifications' | 'presence', change: (hours: Hours) => Hours) =>
      Effect.gen(function* () {
        yield* updateSettings((settings) => (which === 'notifications'
          ? { ...settings, notificationHours: change(settings.notificationHours) }
          : { ...settings, presenceHours: change(settings.presenceHours) }))
        // Only hours the owner set reach Slack's schedule (`../slackSchedule.ts`).
        if (which === 'notifications') yield* inWorkspace(slackSchedule.hoursSet.pipe(Effect.orDie))
      })

    const settingsView = Effect.map(readSettings, ({ settings, aiAssist }): NotificationSettingsView => ({ ...levelsOf(settings), aiAssist }))

    const status = Effect.gen(function* () {
      const now = localTime(yield* Clock.currentTimeMillis)
      const { settings } = yield* readSettings
      const presence = (yield* control.currentPresence) ?? null
      const seen = yield* selfPresence.current
      const shown = presence ?? scheduledPresence(now, settings.presenceHours)
      const label = presenceLabel(now, shown, settings.presenceHours)
      const note = presence === null ? undefined : seenNote(presence, seen)
      const paused = pausedLabel(now, settings.notificationHours)
      return { presence, seen: seen ?? null, presenceLabel: note === undefined ? label : `${label}. ${note}`, ...(paused === undefined ? {} : { paused }) } satisfies NotificationStatus
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
              return {
                every: yield* tagsFor(settings, 'every'),
                never: yield* tagsFor(settings, 'never'),
                ...(yield* today(now)),
                slackSchedule: yield* slackScheduleView,
              } satisfies NotificationsPage
            }),
            // Today starts again at midnight.
            Stream.tick('1 minute').pipe(Stream.drop(1)),
          ),
        ).pipe(retryFirstRun('notifications.page'), Stream.orDie),
      'notifications.status': () =>
        serveLiveValue(
          // The presence stream starts with the current value, which can be newer than what the first
          // run read (the two start together), so it is not dropped: it costs one more run.
          runs(SETTINGS_KEYS, status, Stream.merge(Stream.merge(control.presence, selfPresence.changes), Stream.tick('1 minute').pipe(Stream.drop(1)))),
        ).pipe(retryFirstRun('notifications.status'), Stream.orDie),
      'notifications.setHours': ({ which, hours }) => changeHours(which, (saved) => ({ ...saved, ...hours })),
      'notifications.setDay': ({ which, day, enabled }) => changeHours(which, (saved) => ({
        ...saved,
        days: enabled ? [...saved.days.filter((other) => other !== day), day].toSorted((a, b) => a - b) : saved.days.filter((other) => other !== day),
      })),
      'notifications.setMatters': ({ text }) => updateSettings((settings) => ({ ...settings, matters: text.trim() })).pipe(Effect.asVoid),
      'notifications.setHuddleRing': ({ enabled }) => updateSettings((settings) => ({ ...settings, huddleRing: enabled })).pipe(Effect.asVoid),
      'notifications.setLevel': ({ target, choice }) => setLevel(target, choice),
      'notifications.setPresence': ({ presence }) =>
        Effect.gen(function* () {
          if ((yield* workspace.current) === undefined) return yield* new NotSignedIn()
          yield* control.setPresence(presence)
        }),
      'notifications.setSlackSchedule': ({ enabled }) => inWorkspace(slackSchedule.setEnabled(enabled).pipe(Effect.orDie)),
      'notifications.restoreSlackSchedule': () => inWorkspace(slackSchedule.restore.pipe(Effect.catchTag('SqlError', Effect.die))),
    }
  }),
)
