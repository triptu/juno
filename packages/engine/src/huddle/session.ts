/**
 * Huddles in the engine (docs/plans/huddles.md, specs/huddle.qnt): the
 * `Huddle` service from `@juno/huddle`, attached to every sync through
 * `SocketEvents` with that sync's Slack client and the open workspace.
 *
 * The leaves that must happen are stored in the workspace's user.db, under
 * the pref `huddle.pendingLeaves`: one JSON list of channel, call and
 * attendee ids, written in one transaction. user.db is the workspace's
 * durable database (cache.db can be deleted and rebuilt), and a leave only
 * makes sense with that workspace's session, which is when it is read.
 * Other engine state that must outlive a crash lives in prefs the same way
 * (`slackSchedule.ts`, `readCatchUp.ts`). No credentials are stored.
 */
import { Effect, Layer, Schema } from 'effect'
import { Huddle, HuddleStoreError, type Identity } from '@juno/huddle'
import { prefs, StoreReader, transaction } from '@juno/store'
import { SocketEvents, type SessionServices } from '../socketEvents'

export const PENDING_LEAVES_PREF = 'huddle.pendingLeaves'

const Identities = Schema.Array(Schema.Struct({ channelId: Schema.String, callId: Schema.String, attendeeId: Schema.String }))

/** The conversations the user is in, to read running huddles for. */
const memberChannels = Effect.gen(function* () {
  const sql = yield* StoreReader
  const rows = yield* sql<{ id: string }>`SELECT id FROM conversations WHERE is_member = 1 AND is_archived = 0`
  return rows.map((row) => row.id)
})

/** Attaches `Huddle` to each sync, in that sync's scope. */
export const HuddleSessions = Layer.effectDiscard(Effect.gen(function* () {
  const huddle = yield* Huddle
  const events = yield* SocketEvents
  yield* events.subscribe('huddle', Effect.gen(function* () {
    const context = yield* Effect.context<SessionServices>()
    const listener = yield* huddle.attach({
      slack: context,
      leaves: {
        // An unreadable record is dropped with a warning: nothing can be left without its ids.
        read: prefs.get(PENDING_LEAVES_PREF).pipe(
          Effect.flatMap((raw) => Schema.decodeUnknownEffect(Identities)(raw ?? [])),
          Effect.catch((error) => Effect.logWarning('huddle: stored leaves unreadable', { error: String(error) }).pipe(Effect.as<ReadonlyArray<Identity>>([]))),
          Effect.provide(context),
        ),
        write: (records) =>
          transaction(prefs.set(PENDING_LEAVES_PREF, records)).pipe(
            Effect.mapError((cause) => new HuddleStoreError({ cause })),
            Effect.provide(context),
          ),
      },
      channels: memberChannels.pipe(
        Effect.provide(context),
        Effect.catch((error) => Effect.logWarning('huddle: channels unreadable', { error: String(error) }).pipe(Effect.as<ReadonlyArray<string>>([]))),
      ),
    })
    return (input) => listener(input)
  }))
}))

/** The service and its session attachment. Requires `SocketEvents`. */
export const HuddleLive = HuddleSessions.pipe(Layer.provideMerge(Huddle.layer))
