/**
 * Slack's own notification schedule from the notification hours (SPEC 14,
 * "Slack's notification schedule"; research section 7). On by default.
 *
 * The state is the `slackSchedule` pref: whether Juno writes the schedule,
 * the schedule Slack held before Juno's first write (`saved`, for Restore),
 * and the hours and prefs Juno last applied. A pass runs, after a debounce,
 * when a pref or Slack's cached prefs change and when a catch-up ends, but
 * not before this session's first catch-up, so it reads Slack's prefs as
 * the boot left them. Nothing is written until the hours are the owner's
 * own on this install: set on the page (`hoursSet`) or confirmed by turning
 * the switch on, which sits under them (`hoursChosen`). Default hours never
 * reach Slack, so a fresh or dev install leaves the schedule alone.
 * After that, it writes only when the notification hours differ
 * from the hours it last applied, and only when Slack does not hold the
 * schedule already. So a restart, its own `pref_change` echo and an
 * unrelated pref change never write. A change made in Slack is left alone
 * until the hours change in Juno or the owner picks Use Juno's hours; the
 * page says it no longer matches.
 *
 * A top-level module like `notificationRuntime.ts`: the notifications
 * feature serves the switch and Restore through it.
 */
import { Context, Effect, Layer, Ref, Schema, Semaphore, Stream } from 'effect'
import type { SlackScheduleView } from '@juno/contract'
import { slackScheduleFor, slackScheduleKeys, slackScheduleMatches, slackScheduleSnapshot, type Hours, type SlackSchedulePrefs } from '@juno/domain'
import { NotificationSettingsSchema, readSettings } from '@juno/notifications'
import { invalidate, liveQuery, prefs, StoreReader, StoreWriter, transaction, type SqlError } from '@juno/store'
import { Outbox, type MirrorError } from './outbox'
import { SyncLink } from './syncLink'
import { Workspace, type StoreServices } from './workspace'

const PREF = 'slackSchedule'
/** Changing the hours on the page is two selects; one write covers both. */
const DEBOUNCE = '1 second'

const SchedulePrefs = Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Boolean]))
const State = Schema.Struct({
  enabled: Schema.Boolean,
  /** The owner set the notification hours on this install, or turned the switch on. Until then nothing is written. */
  hoursChosen: Schema.optionalKey(Schema.Boolean),
  /** Slack's schedule before Juno's first write. */
  saved: Schema.optionalKey(SchedulePrefs),
  /** The notification hours Juno last applied. */
  appliedFor: Schema.optionalKey(NotificationSettingsSchema.fields.notificationHours),
  /** The prefs Juno last applied. */
  applied: Schema.optionalKey(SchedulePrefs),
})
type State = typeof State.Type

const readState = Effect.gen(function* () {
  const raw = yield* prefs.get(PREF)
  return yield* Schema.decodeUnknownEffect(State)(raw ?? { enabled: true }).pipe(Effect.catch(() => Effect.succeed<State>({ enabled: true })))
})

const writeState = (state: State) => transaction(prefs.set(PREF, state))

/** Slack's prefs as the sync last stored them, or undefined before the first boot. */
const cachedPrefs = Effect.gen(function* () {
  const sql = yield* StoreReader
  const rows = yield* sql<{ prefs_json: string | null }>`SELECT prefs_json FROM team LIMIT 1`
  const json = rows[0]?.prefs_json
  return json == null ? undefined : (JSON.parse(json) as Record<string, unknown>)
})

/** Keeps the cache in step with what Slack now holds, as a `pref_change` would. */
const storePrefs = (changes: Readonly<Record<string, unknown>>) =>
  transaction(Effect.gen(function* () {
    const sql = yield* StoreWriter
    const rows = yield* sql<{ id: string; prefs_json: string | null }>`SELECT id, prefs_json FROM team LIMIT 1`
    const team = rows[0]
    if (team === undefined) return
    const next = { ...(team.prefs_json === null ? {} : JSON.parse(team.prefs_json)), ...changes }
    yield* sql`UPDATE team SET prefs_json = ${JSON.stringify(next)} WHERE id = ${team.id}`
    yield* invalidate(['team'])
  }))

const sameHours = (a: Hours, b: Hours) => a.from === b.from && a.to === b.to && a.days.length === b.days.length && a.days.every((day) => b.days.includes(day))

/** What the Notifications page shows about Slack's schedule. */
export const slackScheduleView: Effect.Effect<SlackScheduleView, SqlError, StoreServices> = Effect.gen(function* () {
  const state = yield* readState
  const cached = yield* cachedPrefs
  const changedInSlack = state.enabled && state.applied !== undefined && cached !== undefined && !slackScheduleMatches(cached, state.applied)
  return { enabled: state.enabled, canRestore: state.saved !== undefined, changedInSlack, waitingForHours: state.enabled && state.hoursChosen !== true }
})

export class SlackSchedule extends Context.Service<
  SlackSchedule,
  {
    /** On: apply the notification hours once now, and on every change. Off: leave Slack's schedule as it is. */
    readonly setEnabled: (enabled: boolean) => Effect.Effect<void, SqlError, StoreServices>
    /** The owner set the notification hours: from now on they may reach Slack. */
    readonly hoursSet: Effect.Effect<void, SqlError, StoreServices>
    /** Writes the saved schedule back to Slack and turns the switch off. Nothing to do without a saved one. */
    readonly restore: Effect.Effect<void, SqlError | MirrorError, StoreServices>
  }
>()('juno/engine/SlackSchedule') {
  static readonly layer: Layer.Layer<SlackSchedule, never, Workspace | Outbox | SyncLink> = Layer.effect(
    SlackSchedule,
    Effect.gen(function* () {
      const workspace = yield* Workspace
      const outbox = yield* Outbox
      const link = yield* SyncLink
      // Passes, the switch and Restore run one at a time, so Restore never races a write.
      const lock = yield* Semaphore.make(1)
      const caughtUp = yield* Ref.make(false)

      const write = (changes: SlackSchedulePrefs) =>
        Effect.gen(function* () {
          yield* outbox.send((api) => api.call('users.prefs.set', { prefs: JSON.stringify(changes) }))
          yield* storePrefs(changes)
        })

      const pass = Effect.gen(function* () {
        if (!(yield* Ref.get(caughtUp))) return
        const state = yield* readState
        if (!state.enabled || state.hoursChosen !== true) return
        const hours = (yield* readSettings).settings.notificationHours
        if (state.appliedFor !== undefined && sameHours(state.appliedFor, hours)) return
        const cached = yield* cachedPrefs
        if (cached === undefined) return
        const target = slackScheduleFor(hours)
        // The cache can be behind Slack: read the schedule itself before saving it or writing over it.
        // When it already matches, nothing is written, and after this session's boot it is Slack's.
        const current = slackScheduleMatches(cached, target)
          ? cached
          : (yield* outbox.lookup((api) => api.call('users.prefs.get', { prefs: slackScheduleKeys.join(',') }))).prefs
        const saved = state.saved ?? slackScheduleSnapshot(current)
        if (!slackScheduleMatches(current, target)) yield* write(target)
        else if (current !== cached) yield* storePrefs(slackScheduleSnapshot(current))
        yield* writeState({ ...state, saved, appliedFor: hours, applied: target })
      }).pipe(
        Effect.catch((error) =>
          error._tag === 'Rejected'
            // Slack refused these values: do not ask again until the hours change.
            ? Effect.flatMap(readState, (state) => Effect.flatMap(readSettings, ({ settings }) => writeState({ ...state, appliedFor: settings.notificationHours })))
              .pipe(Effect.andThen(Effect.logWarning('slack schedule: Slack refused the write', { code: error.code })), Effect.ignore)
            : Effect.logWarning('slack schedule: not applied', { error: error._tag }),
        ),
        lock.withPermit,
      )

      yield* Effect.forkScoped(
        workspace.changes.pipe(
          Stream.switchMap((open) => {
            if (open === undefined) return Stream.empty
            const ends = link.caughtUps.pipe(Stream.mapEffect(() => Ref.set(caughtUp, true)))
            return Stream.merge(ends, liveQuery(['prefs', 'team'], Effect.void)).pipe(
              Stream.debounce(DEBOUNCE),
              Stream.mapEffect(() => pass),
              Stream.provide(open.context),
            )
          }),
          Stream.runDrain,
        ),
      )
      yield* Effect.forkScoped(Stream.runForEach(workspace.changes, () => Ref.set(caughtUp, false)))

      return SlackSchedule.of({
        setEnabled: (enabled) =>
          Effect.gen(function* () {
            const state = yield* readState
            // Turning it on applies the hours once, even when they did not change.
            const { appliedFor: _, ...rest } = state
            yield* writeState(enabled ? { ...rest, enabled, hoursChosen: true } : { ...state, enabled })
          }).pipe(lock.withPermit),
        hoursSet: Effect.gen(function* () {
          const state = yield* readState
          if (state.hoursChosen !== true) yield* writeState({ ...state, hoursChosen: true })
        }).pipe(lock.withPermit),
        restore: Effect.gen(function* () {
          const state = yield* readState
          if (state.saved === undefined) return
          yield* write(state.saved)
          yield* writeState({ enabled: false })
        }).pipe(lock.withPermit),
      })
    }),
  )
}
