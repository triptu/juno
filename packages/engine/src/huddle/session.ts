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
 * (`slackSchedule.ts`, `readCatchUp.ts`). No credentials are stored. A read
 * that fails, or a stored value that is not a list of records (bad JSON and
 * `null` included), is a typed failure the service waits out, never an
 * empty list: only a missing pref is one.
 *
 * Main reports the live renderer page generations and the highest it gave
 * out (`huddlePages`); the service takes a page that is not listed as gone,
 * with its media.
 *
 * At boot every workspace's stored leaves are read, not only the open one's
 * (`listWorkspaces`, `peekUserPref`): a page may still hold media for a
 * workspace the user left before the engine restarted.
 */
import { Effect, Layer, Schema, Stream } from 'effect'
import { Huddle, HuddleStoreError } from '@juno/huddle'
import { listWorkspaces, peekUserPref, prefs, StoreReader, transaction } from '@juno/store'
import { EngineConfig, EngineTiming } from '../config'
import { HostLink } from '../protocol/host'
import { SocketEvents, type SessionServices, type SocketListener } from '../socketEvents'
import { Workspace } from '../workspace'

export const PENDING_LEAVES_PREF = 'huddle.pendingLeaves'

const Records = Schema.Array(Schema.Struct({
  channelId: Schema.String,
  callId: Schema.String,
  attendeeId: Schema.String,
  /** The renderer page generation the credentials went to; null when none did. */
  generation: Schema.NullOr(Schema.Number),
}))

/**
 * The stored records: none when the pref is missing, and a failure for
 * anything else that is not a list of records, bad JSON and `null`
 * included. Read here rather than with `prefs.get`, which throws on bad JSON.
 */
const decodeRecords = (json: string | undefined) => (json === undefined ? Effect.succeed([]) : Schema.decodeUnknownEffect(Schema.fromJsonString(Records))(json))

const readRecords = Effect.gen(function* () {
  const sql = yield* StoreReader
  const rows = yield* sql<{ value_json: string }>`SELECT value_json FROM prefs WHERE key = ${PENDING_LEAVES_PREF}`
  return yield* decodeRecords(rows[0]?.value_json)
})

/** The conversations the user is in, to read running huddles for. */
const memberChannels = Effect.gen(function* () {
  const sql = yield* StoreReader
  const rows = yield* sql<{ id: string }>`SELECT id FROM conversations WHERE is_member = 1 AND is_archived = 0`
  return rows.map((row) => row.id)
})

const ignore: SocketListener = () => Effect.void

/** Attaches `Huddle` to each sync, in that sync's scope, and passes main's page reports on. */
export const HuddleSessions = Layer.effectDiscard(Effect.gen(function* () {
  const huddle = yield* Huddle
  const events = yield* SocketEvents
  const workspace = yield* Workspace
  const link = yield* HostLink
  const config = yield* EngineConfig
  const timing = yield* EngineTiming
  // Quitting leaves the huddle (SPEC 20): the leave is queued as the engine stops, and the session's work scope waits for
  // its request to go out. If the session closes first, the stored leave goes out on the next launch.
  yield* Effect.addFinalizer(() => huddle.leave)
  const fromMain = yield* link.messages
  yield* Effect.forkScoped(Stream.runForEach(fromMain, (message) => (message._tag === 'huddlePages' ? huddle.pages(message.live, message.maxIssued) : Effect.void)))
  yield* Effect.forkScoped(huddle.boot({
    workspaces: listWorkspaces(config.userData).pipe(Effect.mapError((cause) => new HuddleStoreError({ cause }))),
    read: (workspaceId) =>
      peekUserPref(config.userData, workspaceId, PENDING_LEAVES_PREF).pipe(Effect.flatMap(decodeRecords), Effect.mapError((cause) => new HuddleStoreError({ cause }))),
  }))
  yield* events.subscribe('huddle', Effect.gen(function* () {
    const context = yield* Effect.context<SessionServices>()
    const open = yield* workspace.current
    // The sync runs on the open workspace's store; there is always one.
    if (open === undefined) return ignore
    const listener = yield* huddle.attach({
      workspace: open.id,
      statusRenewMillis: timing.huddleStatusRenewMillis,
      slack: context,
      leaves: {
        read: readRecords.pipe(
          Effect.mapError((cause) => new HuddleStoreError({ cause })),
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
    const forward: SocketListener = (input) => listener(input)
    return forward
  }))
}))

/** The service and its session attachment. Requires `SocketEvents`. */
export const HuddleLive = HuddleSessions.pipe(Layer.provideMerge(Huddle.layer))
