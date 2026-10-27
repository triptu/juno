/**
 * Slack's own notification schedule from the notification hours (SPEC 14,
 * "Slack's notification schedule"; research section 7). Always on.
 *
 * The state is the `slackSchedule` pref: whether the owner chose the hours,
 * and the hours and prefs Juno last applied. Values stored before
 * 2026-10-23 (`enabled`, `saved`) are left and not read. A pass runs, after a debounce,
 * when a pref or Slack's cached prefs change and when a catch-up ends, but
 * not before this session's first catch-up, so it reads Slack's prefs as
 * the boot left them. Until the owner sets notification hours, Juno has
 * none of its own and follows Slack's schedule (`readSettings` in
 * `@juno/notifications`), so nothing is written. Nothing is written either
 * until the hours are set on this install: on the page (`hoursSet`) or
 * confirmed with Use Juno's hours (`hoursChosen`), so hours saved by an
 * older version and never set here stay out of Slack.
 * After that, it writes only when the notification hours differ
 * from the hours it last applied, and only when Slack does not hold the
 * schedule already. So a restart, its own `pref_change` echo and an
 * unrelated pref change never write. A change made in Slack is left alone
 * until the hours change in Juno or the owner picks Use Juno's hours; the
 * page says it no longer matches.
 *
 * A top-level module like `notificationRuntime.ts`: the notifications
 * feature serves Use Juno's hours through it.
 */
import { observeWork, workWakes } from './workControl'
import { Context, Duration, Effect, Layer, Ref, Schema, Semaphore, Stream } from 'effect'
import type { SlackScheduleView } from '@juno/contract'
import { sameHours, slackScheduleFor, slackScheduleHours, slackScheduleKeys, slackScheduleMatches, slackScheduleSnapshot, type SlackSchedulePrefs } from '@juno/domain'
import { NotificationSettingsSchema, readOwnSettings, slackPrefs } from '@juno/notifications'
import { invalidate, liveQuery, prefs, StoreWriter, transaction, type SqlError } from '@juno/store'
import { EngineTiming } from './config'
import { Outbox } from './outbox'
import { SyncLink } from './syncLink'
import { Workspace, type StoreServices } from './workspace'

const PREF = 'slackSchedule'

const SchedulePrefs = Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Boolean]))
const State = Schema.Struct({
  /** The owner set the notification hours on this install, or chose Use Juno's hours. Until then nothing is written. */
  hoursChosen: Schema.optionalKey(Schema.Boolean),
  /** The notification hours Juno last applied. */
  appliedFor: NotificationSettingsSchema.fields.notificationHours,
  /** The prefs Juno last applied. */
  applied: Schema.optionalKey(SchedulePrefs),
})
type State = typeof State.Type

const readState = Effect.gen(function* () {
  const raw = yield* prefs.get(PREF)
  return yield* Schema.decodeUnknownEffect(State)(raw ?? {}).pipe(Effect.catch(() => Effect.succeed<State>({})))
})

const writeState = (state: State) => transaction(prefs.set(PREF, state))

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

/** What the Notifications page shows about Slack's schedule. */
export const slackScheduleView: Effect.Effect<SlackScheduleView, SqlError, StoreServices> = Effect.gen(function* () {
  const state = yield* readState
  const cached = yield* slackPrefs
  if ((yield* readOwnSettings).settings.notificationHours === undefined) {
    return { changedInSlack: false, waitingForHours: false, slackHours: (cached === undefined ? undefined : slackScheduleHours(cached)) ?? null }
  }
  const changedInSlack = state.applied !== undefined && cached !== undefined && !slackScheduleMatches(cached, state.applied)
  return { changedInSlack, waitingForHours: state.hoursChosen !== true, slackHours: null }
})

export class SlackSchedule extends Context.Service<
  SlackSchedule,
  {
    /** Use Juno's hours: apply the notification hours once now, even unchanged, over a schedule changed in Slack. */
    readonly useJunoHours: Effect.Effect<void, SqlError, StoreServices>
    /** The owner set the notification hours: from now on they may reach Slack. */
    readonly hoursSet: Effect.Effect<void, SqlError, StoreServices>
  }
>()('juno/engine/SlackSchedule') {
  static readonly layer: Layer.Layer<SlackSchedule, never, Workspace | Outbox | SyncLink> = Layer.effect(
    SlackSchedule,
    Effect.gen(function* () {
      const debounce = (yield* EngineTiming).slackScheduleDebounceMillis
      const workspace = yield* Workspace
      const outbox = yield* Outbox
      const link = yield* SyncLink
      // Passes and Use Juno's hours run one at a time.
      const lock = yield* Semaphore.make(1)
      const caughtUp = yield* Ref.make(false)

      const write = (changes: SlackSchedulePrefs) =>
        outbox.send((api) => api.call('users.prefs.set', { prefs: JSON.stringify(changes) })).pipe(Effect.andThen(storePrefs(changes)))

      const pass = Effect.gen(function* () {
        if (!(yield* Ref.get(caughtUp))) return
        const state = yield* readState
        if (state.hoursChosen !== true) return
        const hours = (yield* readOwnSettings).settings.notificationHours
        if (hours === undefined || (state.appliedFor !== undefined && sameHours(state.appliedFor, hours))) return
        const cached = yield* slackPrefs
        if (cached === undefined) return
        const target = slackScheduleFor(hours)
        // The cache can be behind Slack: read the schedule itself before writing over it.
        // When it already matches, nothing is written, and after this session's boot it is Slack's.
        const current = slackScheduleMatches(cached, target)
          ? cached
          : (yield* outbox.lookup((api) => api.call('users.prefs.get', { prefs: slackScheduleKeys.join(',') }))).prefs
        if (!slackScheduleMatches(current, target)) yield* write(target)
        else if (current !== cached) yield* storePrefs(slackScheduleSnapshot(current))
        yield* writeState({ ...state, appliedFor: hours, applied: target })
      }).pipe(
        Effect.catch((error) =>
          error._tag === 'Rejected'
            // Slack refused these values: do not ask again until the hours change.
            ? Effect.flatMap(readState, (state) => Effect.flatMap(readOwnSettings, ({ settings: { notificationHours } }) => writeState(notificationHours === undefined ? state : { ...state, appliedFor: notificationHours })))
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
              Stream.debounce(Duration.millis(debounce)),
              Stream.merge(workWakes('slackSchedule')),
              Stream.mapEffect(() => pass.pipe(observeWork('slackSchedule'))),
              Stream.provide(open.context),
            )
          }),
          Stream.runDrain,
        ),
      )
      yield* Effect.forkScoped(Stream.runForEach(workspace.changes, () => Ref.set(caughtUp, false)))

      return SlackSchedule.of({
        useJunoHours: Effect.gen(function* () {
          // Forgetting what was applied makes the next pass write the hours, even unchanged.
          const { appliedFor: _, ...rest } = yield* readState
          yield* writeState({ ...rest, hoursChosen: true })
        }).pipe(lock.withPermit),
        hoursSet: readState.pipe(Effect.flatMap((state) => state.hoursChosen === true ? Effect.void : writeState({ ...state, hoursChosen: true })), lock.withPermit),
      })
    }),
  )
}
