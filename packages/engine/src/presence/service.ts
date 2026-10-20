/**
 * Other people's presence (SPEC 14, "Show when people are active";
 * docs/research/slack-data-access.md section 3, Presence).
 *
 * For each running sync, Juno subscribes over the socket with
 * `presence_sub { ids }` to the people it shows: the partners of the
 * `PRESENCE_LIMIT` DMs with the latest activity, not the whole workspace.
 * Each `presence_sub` carries the whole list and replaces the last one, as
 * the official client's does. It goes out again when that list changes and
 * after every reconnect. Slack answers at once with the current presence of
 * every subscribed user and then each change, as `presence_change
 * { presence, users }` batches (the socket URL asks for
 * `batch_presence_aware=1`; checked live 2026-10-21). The subscribed users
 * Slack shows as active are `active`, sorted.
 *
 * Presence is kept in memory only. It is cleared when the socket drops and
 * when the sync ends, because Juno cannot know it then. With the
 * `showPresence` preference off, Juno subscribes to no one: it sends an
 * empty `presence_sub` once if it had subscribed on this connection, and
 * nothing after.
 */
import { SHOW_PRESENCE_PREF } from '@juno/contract'
import { SlackSession, SlackSocket } from '@juno/slack'
import { liveQuery, prefs, StoreReader } from '@juno/store'
import { Context, Effect, Layer, Semaphore, Stream, SubscriptionRef } from 'effect'
import { SocketEvents, type SessionStart } from '../socketEvents'

/** How many DM partners Juno follows at most: the DMs with the latest activity. */
export const PRESENCE_LIMIT = 100

const nobody: ReadonlyArray<string> = []

export class OthersPresence extends Context.Service<OthersPresence, {
  /** The followed users Slack shows as active, sorted; the current value first. */
  readonly active: Stream.Stream<ReadonlyArray<string>>
}>()('juno/engine/OthersPresence') {
  static readonly layer = Layer.effect(OthersPresence, Effect.gen(function* () {
    const active = yield* SubscriptionRef.make(nobody)
    const events = yield* SocketEvents
    yield* events.subscribe('presence', sessionPresence(active))
    return OthersPresence.of({ active: SubscriptionRef.changes(active) })
  }))
}

/** The DM partners to follow, latest activity first, or none while the setting is off. */
const wantedIds = (selfId: string) => Effect.gen(function* () {
  if ((yield* prefs.get(SHOW_PRESENCE_PREF)) === false) return nobody
  const sql = yield* StoreReader
  const rows = yield* sql<{ id: string }>`
    SELECT c.user_id AS id FROM topic_index t
    JOIN conversations c ON c.id = t.channel AND c.kind = 'im' AND c.is_member = 1 AND c.user_id IS NOT NULL
    LEFT JOIN users u ON u.id = c.user_id
    WHERE t.kind = 'main' AND c.user_id != ${selfId} AND c.user_id != 'USLACKBOT' AND COALESCE(u.is_bot, 0) = 0 AND COALESCE(u.deleted, 0) = 0
    ORDER BY t.last_activity_ts DESC
    LIMIT ${PRESENCE_LIMIT}`
  return rows.map((row) => row.id)
})

/** Runs for each sync, in its scope, and shares its socket. */
const sessionPresence = (active: SubscriptionRef.SubscriptionRef<ReadonlyArray<string>>): SessionStart => Effect.gen(function* () {
  const socket = yield* SlackSocket
  const session = yield* SlackSession
  const lock = yield* Semaphore.make(1)
  /** The users to follow now. */
  let wanted = new Set<string>()
  let wantedKey = ''
  /** The ids last sent on this connection, joined; undefined when nothing was sent on it. */
  let sent: string | undefined
  /** What Slack last said for each followed user on this connection. */
  const presence = new Map<string, 'active' | 'away'>()

  const publish = Effect.suspend(() => {
    const ids = [...presence].filter(([id, value]) => value === 'active' && wanted.has(id)).map(([id]) => id).toSorted()
    return SubscriptionRef.update(active, (last) => (sameIds(last, ids) ? last : ids))
  })
  // Sends the list when it differs from the last one sent. An empty list goes out only to end a subscription.
  const subscribe = Effect.suspend(() => {
    if (sent === wantedKey || (sent === undefined && wanted.size === 0)) return Effect.void
    return socket.send({ type: 'presence_sub', ids: [...wanted] }).pipe(Effect.map((ok) => {
      if (ok) sent = wantedKey
    }))
  })
  // Presence from an earlier connection may be stale: forget it, and subscribe again once connected.
  const forget = Effect.suspend(() => {
    sent = undefined
    presence.clear()
    return publish
  })

  yield* Effect.addFinalizer(() => SubscriptionRef.set(active, nobody))
  yield* Effect.forkScoped(Stream.runForEach(liveQuery(['prefs', 'topics', 'conversations', 'users'], wantedIds(session.userId)), (result) => {
    if (result._tag === 'Failure') return Effect.logWarning('presence: could not read whom to follow', { error: String(result.failure) })
    const key = result.success.join(',')
    if (key === wantedKey) return Effect.void
    return lock.withPermits(1)(Effect.suspend(() => {
      wanted = new Set(result.success)
      wantedKey = key
      for (const id of presence.keys()) if (!wanted.has(id)) presence.delete(id)
      return Effect.andThen(publish, subscribe)
    })).pipe(
      // A failed send is logged, and the next change or connect sends again.
      Effect.catchDefect((defect) => Effect.logWarning('presence: could not subscribe', { defect })),
    )
  }))

  return (input) => lock.withPermits(1)(Effect.suspend(() => {
    switch (input._tag) {
      case 'Connected':
        return Effect.andThen(forget, subscribe)
      case 'Disconnected':
        return forget
      // Changes were dropped: subscribing again makes Slack send the current presence.
      case 'Overflowed':
        return Effect.andThen(forget, subscribe)
      case 'Frame': {
        const frame = input.frame
        // The official client reads only `users`; a frame with a single `user` it logs and drops.
        if (frame.type !== 'presence_change' || frame.users === undefined) return Effect.void
        for (const id of frame.users) if (wanted.has(id)) presence.set(id, frame.presence)
        return publish
      }
    }
  }))
})

const sameIds = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) => a.length === b.length && a.every((id, index) => id === b[index])
