/**
 * Pause notifications (SPEC 14, "Pause notifications"; research section 7):
 * Slack's own snooze, so the phone and every other Slack client go quiet
 * too and colleagues see it.
 *
 * The state is the `slackSnooze` pref (`@juno/notifications`): when the
 * snooze ends, as Slack last said. `readSettings` puts it in the settings
 * while it runs, so the decision, the huddle ring and the avatar's paused
 * badge all read it. Pause and Resume call `dnd.setSnooze` and
 * `dnd.endSnooze` and store Slack's answer. Each session reads `dnd.info`
 * when it connects, and again on every `dnd_updated` for the user, so a
 * snooze set, changed or ended in another Slack client shows here. At the
 * end a timer clears the pref, which runs every reader again; nothing polls.
 * Calls answer in order, and the last `dnd_updated` always reads again, so
 * an older answer stored late is replaced. One write keyed by Slack's
 * answer, with no queue or merge: no Quint spec.
 */
import { Clock, Context, Effect, Layer, Result, Stream } from 'effect'
import { readSnooze, SNOOZE_PREF, writeSnooze } from '@juno/notifications'
import { SlackApi, SlackSession } from '@juno/slack'
import { liveQuery, prefs, transaction, type SqlError } from '@juno/store'
import { Outbox, type MirrorError } from './outbox'
import { SocketEvents, type SessionStart } from './socketEvents'
import { Workspace, type StoreServices } from './workspace'

export class SlackSnooze extends Context.Service<SlackSnooze, {
  /** Pauses notifications for `minutes` with Slack's snooze. When it ends, as Slack answered, in epoch milliseconds. */
  readonly pause: (minutes: number) => Effect.Effect<number, MirrorError | SqlError, StoreServices>
  /** Ends the snooze. One that already ended in Slack counts as ended. */
  readonly resume: Effect.Effect<void, MirrorError | SqlError, StoreServices>
}>()('juno/engine/SlackSnooze') {
  static readonly layer: Layer.Layer<SlackSnooze, never, Workspace | Outbox | SocketEvents> = Layer.effect(SlackSnooze, Effect.gen(function* () {
    const workspace = yield* Workspace
    const outbox = yield* Outbox
    const events = yield* SocketEvents
    yield* events.subscribe('snooze', sessionSnooze)

    // At the end of the snooze the pref is cleared, so every reader runs again. A new value interrupts the wait.
    yield* Effect.forkScoped(workspace.changes.pipe(
      Stream.switchMap((open) => open === undefined
        ? Stream.empty
        : liveQuery(['prefs'], readSnooze).pipe(
          Stream.filterMap((result) => (Result.isSuccess(result) ? Result.succeed(result.success) : Result.failVoid)),
          Stream.changes,
          Stream.switchMap((until) => Stream.fromEffect(endAt(until))),
          Stream.provide(open.context),
        )),
      Stream.runDrain,
    ))

    return SlackSnooze.of({
      pause: (minutes) => Effect.gen(function* () {
        const answer = yield* outbox.send((api) => api.call('dnd.setSnooze', { num_minutes: minutes }))
        const until = answer.snooze_endtime * 1000
        yield* writeSnooze(until)
        return until
      }),
      resume: outbox.send((api) => api.call('dnd.endSnooze', {})).pipe(
        Effect.asVoid,
        // `snooze_not_active`: it already ended, in Slack or by its time.
        Effect.catchIf((error) => error._tag === 'Rejected', () => Effect.void),
        Effect.andThen(writeSnooze(undefined)),
      ),
    })
  }))
}

/** Waits until `until`, then clears the pref if it still holds that snooze. */
const endAt = (until: number | undefined) => Effect.gen(function* () {
  if (until === undefined) return
  const now = yield* Clock.currentTimeMillis
  if (until > now) yield* Effect.sleep(until - now)
  yield* transaction(Effect.gen(function* () {
    if ((yield* readSnooze) === until) yield* prefs.set(SNOOZE_PREF, null)
  }))
}).pipe(Effect.catch((error) => Effect.logWarning('snooze: could not clear the ended snooze', { error: String(error) })))

/** Runs for each sync: reads the snooze when the socket connects and on each `dnd_updated` for the user. */
const sessionSnooze: SessionStart = Effect.gen(function* () {
  const api = yield* SlackApi
  const session = yield* SlackSession
  const read = api.call('dnd.info', {}, { lane: 'background' }).pipe(
    Effect.flatMap((info) => writeSnooze(info.snooze_enabled && info.snooze_endtime !== undefined ? info.snooze_endtime * 1000 : undefined)),
    Effect.catch((error) => Effect.logWarning('snooze: could not read Slack’s snooze', { error: String(error) })),
  )
  const context = yield* Effect.context<StoreServices>()
  return (input) => {
    if (input._tag === 'Connected' || input._tag === 'Overflowed') return read.pipe(Effect.provide(context))
    if (input._tag !== 'Frame' || input.frame.type !== 'dnd_updated') return Effect.void
    if (input.frame.user !== undefined && input.frame.user !== session.userId) return Effect.void
    return read.pipe(Effect.provide(context))
  }
})
