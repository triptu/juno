/**
 * Handlers for the notification routes (spec section 14, inventory 2.1,
 * 13 and 15). The settings live in the `notifications` pref, validated by
 * `@juno/notifications`; every write goes through `updateSettings`, one at
 * a time, and the running pipeline re-decides today's messages when the
 * pref changes (`notificationRuntime.ts`).
 *
 * Notify me on a thread is also its follow (SPEC 5): Always and Auto
 * follow it in Slack through `topics.subscribe`, Never unfollows it. Only
 * Always is stored as a thread level.
 *
 * Slack's own schedule (the `dnd_*` user prefs) follows the notification
 * hours through `SlackSchedule` (`../slackSchedule.ts`), which watches the
 * hours itself, so every way of changing them reaches it. The page carries
 * its state; Use Juno's hours is served here.
 */
import { randomUUID } from 'node:crypto'
import { Clock, Effect, Schema, Semaphore, Stream } from 'effect'
import { AiProvider, tasks } from '@juno/ai'
import {
  NotFound,
  NotifyTargetSchema,
  NotificationsRoutes,
  NotSignedIn,
  type CommandResult,
  type Hours, type InstructionRule, type NotificationSettingsView,
  type NotificationsPage,
  type NotificationStatus,
  type NotifyTag,
  type NotifyTargetView,
  type TodayRow,
} from '@juno/contract'
import {
  alwaysNotifyOf,
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
  type NotifyLevel,
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
const DECISION_KEYS: InvalidationKeys = ['notification_log']
const DECISIONS_LIMIT = 500
/** People and channels an instruction names that the rule check is shown, at most. */
const NAMED_LIMIT = 5

const viewOf = (settings: NotificationSettings, aiAssist: boolean): NotificationSettingsView => ({
  notificationHours: settings.notificationHours,
  presenceHours: settings.presenceHours,
  channels: settings.channels,
  people: settings.people,
  threads: settings.threads ?? {},
  alwaysNotify: alwaysNotifyOf(settings),
  instructions: settings.instructions ?? [],
  aiAssist,
  huddleRing: settings.huddleRing !== false,
})

/** Every channel and person on a list, with their names. Unknown ids show as they are. */
const tagsFor = (settings: NotificationSettings, level: NotifyLevel) =>
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
  readonly channel: string
  readonly topic_id: string | null
  readonly outcome: 'notify' | 'stay'
  readonly decided_by: TodayRow['decidedBy'] | null
  readonly decision_json: string | null
  readonly reason: string | null
  readonly preview: string | null
  readonly candidate_json: string | null
}

const decodeCandidate = (json: string | null): Candidate | undefined => {
  if (json === null) return undefined
  try {
    return Schema.decodeUnknownSync(Candidate)(JSON.parse(json))
  } catch {
    return undefined
  }
}

const DecisionExtra = Schema.Struct({ target: Schema.optionalKey(NotifyTargetSchema), instructionId: Schema.optionalKey(Schema.String) })
const decodeExtra = (json: string | null): typeof DecisionExtra.Type => {
  if (json === null) return {}
  try {
    return Schema.decodeUnknownSync(DecisionExtra)(JSON.parse(json))
  } catch {
    return {}
  }
}

const sinceMidnight = (now: number) => {
  const midnight = new Date(now)
  midnight.setHours(0, 0, 0, 0)
  return midnight.toISOString()
}

/** Today's counts for the page: what notified (a banner was shown) and what stayed. */
const todayCounts = (now: number) =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const counts = yield* sql<{ notified: number; stayed: number }>`
      SELECT COALESCE(SUM(delivered_at IS NOT NULL AND outcome = 'notify'), 0) AS notified, COALESCE(SUM(outcome = 'stay'), 0) AS stayed
      FROM notification_log WHERE at >= ${sinceMidnight(now)}`
    return { notified: counts[0]?.notified ?? 0, stayed: counts[0]?.stayed ?? 0 }
  })

/** Every decision today, newest first, for Details. Rows from before decided-by was stored read as Auto's reading. */
const todayDecisions = (now: number) =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const rows = yield* sql<LogRow>`SELECT id, at, channel, topic_id, outcome, decided_by, decision_json, reason, preview, candidate_json
      FROM notification_log WHERE at >= ${sinceMidnight(now)} ORDER BY at DESC, id DESC LIMIT ${DECISIONS_LIMIT}`
    return rows.map((row): TodayRow => {
      const candidate = decodeCandidate(row.candidate_json)
      return {
        id: row.id,
        at: new Date(row.at).getTime(),
        place: candidate === undefined ? '' : channelLabel(candidate.channel),
        sender: candidate?.senderName ?? '',
        senderId: candidate?.senderId ?? '',
        channelId: row.channel,
        topicId: row.topic_id ?? '',
        text: row.preview ?? '',
        outcome: row.outcome === 'notify' ? 'notify' : 'stay',
        decidedBy: row.decided_by ?? 'reading',
        reason: row.reason ?? '',
        ...decodeExtra(row.decision_json),
      }
    })
  })

/** The people and channels an instruction names: a person's full or first name or handle, a channel's name, as whole words. */
const namedIn = (text: string) =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const words = new Set(text.toLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter((word) => word.length > 1))
    const lower = ` ${text.toLowerCase().replace(/\s+/g, ' ')} `
    const people = yield* sql<{ id: string; name: string | null; display_name: string | null; real_name: string | null }>`
      SELECT id, name, display_name, real_name FROM users WHERE deleted = 0 AND is_bot = 0`
    const channels = yield* sql<{ id: string; name: string }>`
      SELECT id, name FROM conversations WHERE kind IN ('public', 'private') AND is_member = 1 AND is_archived = 0 AND name IS NOT NULL`
    const named = (full: string | null) => full !== null && full.trim() !== '' && (lower.includes(` ${full.toLowerCase()} `) || words.has(full.trim().split(/\s+/)[0]!.toLowerCase()))
    return {
      people: people.filter((p) => named(p.real_name) || named(p.display_name) || (p.name !== null && words.has(p.name.toLowerCase())))
        .slice(0, NAMED_LIMIT).map((p) => ({ id: p.id, name: p.real_name ?? p.display_name ?? p.name ?? p.id })),
      channels: channels.filter((c) => words.has(c.name.toLowerCase())).slice(0, NAMED_LIMIT).map((c) => ({ id: c.id, name: c.name })),
    }
  })

/** A thread topic id's channel and root, or undefined for anything else. */
const thread = (id: string) => {
  const parsed = parseTopicId(id)
  return parsed?.kind === 'thread' ? parsed : undefined
}

/** The settings with one Notify me choice applied. Auto is no entry; a thread's Never is its follow flag, not an entry. */
const withLevel = (settings: NotificationSettings, target: NotifyTargetView, choice: NotifyChoice): NotificationSettings => {
  const set = (map: Readonly<Record<string, NotifyLevel>> | undefined, allowNever: boolean) => {
    const { [target.id]: _, ...rest } = map ?? {}
    return choice === 'always' || (choice === 'never' && allowNever) ? { ...rest, [target.id]: choice } : rest
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
    const ai = yield* AiProvider
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

    const settingsView = Effect.map(readSettings, ({ settings, aiAssist }) => viewOf(settings, aiAssist))

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
                always: yield* tagsFor(settings, 'always'),
                never: yield* tagsFor(settings, 'never'),
                ...(yield* todayCounts(now)),
                slackSchedule: yield* slackScheduleView,
              } satisfies NotificationsPage
            }),
            // Today starts again at midnight.
            Stream.tick('1 minute').pipe(Stream.drop(1)),
          ),
        ).pipe(retryFirstRun('notifications.page'), Stream.orDie),
      'notifications.decisions': () =>
        serveLiveValue(
          runs(DECISION_KEYS, Effect.flatMap(Clock.currentTimeMillis, (now) => Effect.map(todayDecisions(now), (decisions) => ({ decisions }))), Stream.tick('1 minute').pipe(Stream.drop(1))),
        ).pipe(retryFirstRun('notifications.decisions'), Stream.orDie),
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
      'notifications.setAlwaysNotify': ({ which, enabled }) =>
        updateSettings((settings) => ({ ...settings, alwaysNotify: { ...settings.alwaysNotify, [which]: enabled } })).pipe(Effect.asVoid),
      'notifications.saveInstruction': ({ id, direction, text }) =>
        Effect.gen(function* () {
          const saved = id ?? `i${randomUUID().replaceAll('-', '').slice(0, 12)}`
          yield* updateSettings((settings) => {
            const list = settings.instructions ?? []
            const item = { id: saved, direction, text: text.trim() }
            return { ...settings, instructions: list.some((other) => other.id === saved) ? list.map((other) => (other.id === saved ? item : other)) : [...list, item] }
          })
          return { id: saved }
        }),
      'notifications.removeInstruction': ({ id }) =>
        updateSettings((settings) => ({ ...settings, instructions: (settings.instructions ?? []).filter((item) => item.id !== id) })).pipe(Effect.asVoid),
      'notifications.checkInstruction': ({ text }) =>
        inWorkspace(
          Effect.gen(function* () {
            const { aiAssist } = yield* readSettings
            const named = yield* namedIn(text)
            if (!aiAssist || named.people.length + named.channels.length === 0) return null
            const decision = yield* ai.decide(tasks.instructionRule, { text, ...named })
            const rule = decision._tag === 'Decided' ? decision.value.rule : null
            if (rule === null) return null
            const name = rule.kind === 'person' ? named.people.find((p) => p.id === rule.id)?.name : named.channels.find((c) => c.id === rule.id)?.name
            if (name === undefined) return null
            return { kind: rule.kind, id: rule.id, name: rule.kind === 'channel' ? `#${name}` : name, level: rule.level } satisfies InstructionRule
          }).pipe(Effect.orDie),
        ),
      'notifications.setHuddleRing': ({ enabled }) => updateSettings((settings) => ({ ...settings, huddleRing: enabled })).pipe(Effect.asVoid),
      'notifications.setLevel': ({ target, choice }) => setLevel(target, choice),
      'notifications.setPresence': ({ presence }) =>
        Effect.gen(function* () {
          if ((yield* workspace.current) === undefined) return yield* new NotSignedIn()
          yield* control.setPresence(presence)
        }),
      'notifications.useJunoHours': () => inWorkspace(slackSchedule.useJunoHours.pipe(Effect.orDie)),
    }
  }),
)
