/**
 * Handlers for the notification routes (spec section 14, inventory 2.1,
 * 13 and 15). The settings live in the `notifications` pref, validated by
 * `@juno/notifications`; every write goes through `updateSettings`, one at
 * a time, and the running pipeline re-decides today's messages when the
 * pref changes (`notificationRuntime.ts`).
 *
 * Notify me on a thread is also its follow (SPEC 5): Always and Auto
 * follow it in Slack through `topics.subscribe`, Never unfollows it. Always
 * and Never are also stored as the thread's level, which the decision reads.
 * The settings also carry the conversations with Follow new threads on
 * (`../followNew.ts`), which the menus show beside Notify me.
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
  NotificationsRoutes,
  NotSignedIn,
  type CommandResult,
  type Hours, type InstructionRule, type NotificationSettingsView,
  type NotificationsPage,
  type NotificationStatus,
  type NotifyTargetView,
} from '@juno/contract'
import {
  alwaysNotifyOf,
  localTime,
  notifyChoice,
  parseTopicId,
  pausedLabel,
  presenceLabel,
  scheduledPresence,
  seenNote,
  threadNotifyChoice,
  withGroupHours,
  type NotificationSettings,
  type NotifyChoice,
  type NotifyLevel,
} from '@juno/domain'
import { NotificationSettingsSchema, readSettings } from '@juno/notifications'
import { liveQuery, prefs, StoreReader, transaction, type InvalidationKeys, type SqlError } from '@juno/store'
import { NotificationControl } from '../notificationRuntime'
import { SelfPresence } from '../selfPresence'
import { Outbox } from '../outbox'
import { SlackSchedule, slackScheduleView } from '../slackSchedule'
import { retryFirstRun, serveLiveValue, timed, type Run } from '../protocol/live'
import { setSubscribed } from '../follow'
import { followNewChannels } from '../followNew'
import { Workspace, type StoreServices } from '../workspace'
import { tagsFor, todayCounts, todayDecisions } from './pageQueries'

const SETTINGS_KEYS: InvalidationKeys = ['prefs', 'follow_new_threads']
const PAGE_KEYS: InvalidationKeys = ['prefs', 'notification_log', 'conversations', 'users', 'team', 'topic_overlay']
const DECISION_KEYS: InvalidationKeys = ['notification_log']
/** People and channels an instruction names that the rule check is shown, at most. */
const NAMED_LIMIT = 5

const viewOf = (settings: NotificationSettings, aiAssist: boolean, followNewThreads: ReadonlyArray<string>): NotificationSettingsView => ({
  notificationHours: settings.notificationHours,
  presenceHours: settings.presenceHours,
  channels: settings.channels,
  people: settings.people,
  threads: settings.threads ?? {},
  alwaysNotify: alwaysNotifyOf(settings),
  instructions: settings.instructions ?? [],
  aiAssist,
  huddleRing: settings.huddleRing !== false,
  followNewThreads,
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

/** The settings with one Notify me choice applied. Auto is no entry; Always and Never are stored for a thread, channel or person alike. */
const withLevel = (settings: NotificationSettings, target: NotifyTargetView, choice: NotifyChoice): NotificationSettings => {
  const set = (map: Readonly<Record<string, NotifyLevel>> | undefined) => {
    const { [target.id]: _, ...rest } = map ?? {}
    return choice === 'auto' ? rest : { ...rest, [target.id]: choice }
  }
  switch (target.kind) {
    case 'channel':
      return { ...settings, channels: set(settings.channels) }
    case 'person':
      return { ...settings, people: set(settings.people) }
    case 'thread':
      return { ...settings, threads: set(settings.threads) }
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

    const settingsView = Effect.gen(function* () {
      const { settings, aiAssist } = yield* readSettings
      return viewOf(settings, aiAssist, yield* followNewChannels)
    })

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
          const parsed = thread(target.id)
          if (parsed === undefined) return yield* new NotFound({ kind: 'topic', id: target.id })
          const follow = choice !== 'never'
          // The follow flag as Slack last said, not the stored level: Slack may have followed the thread again since.
          const followed = yield* inWorkspace(
            Effect.map(StoreReader.use((sql) => sql<{ subscribed: number }>`SELECT subscribed FROM thread_subs WHERE channel = ${parsed.channel} AND thread_ts = ${parsed.threadTs}`),
              (rows) => rows[0]?.subscribed === 1).pipe(Effect.orDie),
          )
          if (follow !== followed) {
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
      'notifications.setGroupHours': ({ which, group, hours }) => changeHours(which, (saved) => withGroupHours(saved, group, hours)),
      'notifications.setAlwaysNotify': ({ which, enabled }) =>
        updateSettings((settings) => ({ ...settings, alwaysNotify: { ...settings.alwaysNotify, [which]: enabled } })).pipe(Effect.asVoid),
      'notifications.saveInstruction': ({ id, direction, text }) =>
        Effect.gen(function* () {
          const fresh = `i${randomUUID().replaceAll('-', '').slice(0, 12)}`
          let saved = fresh
          yield* updateSettings((settings) => {
            const list = settings.instructions ?? []
            const old = list.find((other) => other.id === id)
            // A changed instruction gets a new id, so a reading made against the old one names an id that is gone and is ignored.
            saved = old !== undefined && old.text === text.trim() && old.direction === direction ? old.id : fresh
            const item = { id: saved, direction, text: text.trim() }
            return { ...settings, instructions: old === undefined ? [...list, item] : list.map((other) => (other.id === id ? item : other)) }
          })
          return { id: saved }
        }),
      'notifications.removeInstruction': ({ id }) =>
        updateSettings((settings) => ({ ...settings, instructions: (settings.instructions ?? []).filter((item) => item.id !== id) })).pipe(Effect.asVoid),
      'notifications.checkInstruction': ({ text, direction }) =>
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
            // The owner's direction decides the level, so Make it a setting never applies the opposite one.
            return { kind: rule.kind, id: rule.id, name: rule.kind === 'channel' ? `#${name}` : name, level: direction === 'notify' ? 'always' : 'never' } satisfies InstructionRule
          }).pipe(Effect.orDie),
        ),
      'notifications.setHuddleRing': ({ enabled }) => updateSettings((settings) => ({ ...settings, huddleRing: enabled })).pipe(Effect.asVoid),
      'notifications.setLevel': ({ target, choice }) => setLevel(target, choice),
      'notifications.setPresence': ({ presence }) =>
        Effect.gen(function* () {
          if ((yield* workspace.current) === undefined) return yield* new NotSignedIn()
          return { sent: yield* control.setPresence(presence) }
        }),
      'notifications.useJunoHours': () => inWorkspace(slackSchedule.useJunoHours.pipe(Effect.orDie)),
    }
  }),
)
