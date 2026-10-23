/**
 * Presence as Slack shows it to colleagues: other people's (SPEC 7,
 * "Presence in a DM"; SPEC 14, "Show who is active in the sidebar") and the
 * user's own (SPEC 14, "Your own dot"; docs/research/slack-data-access.md
 * section 3, Presence).
 *
 * For each running sync, Juno subscribes over the socket with
 * `presence_sub { ids }` to the people it shows, not the whole workspace:
 * the user, the partners of the open 1:1 DMs (topics shown in `SyncLink`,
 * a DM's Main or one of its threads) always, and while the `showPresence`
 * preference is on, also the partners of the `PRESENCE_LIMIT` DMs with the
 * latest activity. The official client also includes the user's own id.
 * Each `presence_sub` carries the whole list, sorted, and
 * replaces the last one, as the official client's does. It goes out again
 * when that set changes, at most once per `SUB_SETTLE` while tabs switch,
 * and after every reconnect. Slack answers at once with the current
 * presence of every subscribed user and then each change, as
 * `presence_change { presence, users }` batches (the socket URL asks for
 * `batch_presence_aware=1`; checked live 2026-10-21).
 *
 * Presence is kept in memory only. It is cleared when the socket drops and
 * when the sync ends, because Juno cannot know it then. The user's own goes
 * to `SelfPresence`, apart from the others', so it never shows as a DM
 * partner's.
 */
import { SHOW_PRESENCE_PREF, type PresencePeople } from '@juno/contract'
import { parseTopicId } from '@juno/domain'
import { SlackSession, SlackSocket } from '@juno/slack'
import { liveQuery, prefs, StoreReader } from '@juno/store'
import { Context, Effect, Layer, Semaphore, Stream, SubscriptionRef } from 'effect'
import { SelfPresence } from '../selfPresence'
import { SocketEvents, type SessionStart } from '../socketEvents'
import { SyncLink } from '../syncLink'

/** How many recent DM partners Juno follows at most while the sidebar setting is on. */
export const PRESENCE_LIMIT = 100

/** How long the set of people must hold before it is sent, so switching through tabs sends once. */
const SUB_SETTLE = '100 millis'

const unknown: PresencePeople = { active: [], away: [] }

export class OthersPresence extends Context.Service<OthersPresence, {
  /** What Slack last said about each followed user other than the user, sorted; the current value first. */
  readonly people: Stream.Stream<PresencePeople>
}>()('juno/engine/OthersPresence') {
  static readonly layer = Layer.effect(OthersPresence, Effect.gen(function* () {
    const people = yield* SubscriptionRef.make(unknown)
    const self = yield* SelfPresence
    const events = yield* SocketEvents
    const link = yield* SyncLink
    yield* events.subscribe('presence', sessionPresence(people, self, link))
    return OthersPresence.of({ people: SubscriptionRef.changes(people) })
  }))
}

/** The channels of the shown topics. */
const channelsOf = (topicIds: ReadonlyArray<string>) => [...new Set(topicIds.flatMap((id) => parseTopicId(id)?.channel ?? []))]

/** The people to follow, sorted: the user, the partners of the open DMs, and of the recent DMs while the setting is on. */
const wantedIds = (selfId: string, openChannels: ReadonlyArray<string>) => Effect.gen(function* () {
  const sql = yield* StoreReader
  const ids = new Set<string>([selfId])
  if (openChannels.length > 0) {
    const open = yield* sql<{ id: string }>`
      SELECT c.user_id AS id FROM conversations c LEFT JOIN users u ON u.id = c.user_id
      WHERE c.id IN ${sql.in(openChannels)} AND c.kind = 'im' AND c.is_member = 1 AND c.user_id IS NOT NULL
        AND c.user_id != ${selfId} AND c.user_id != 'USLACKBOT' AND COALESCE(u.is_bot, 0) = 0 AND COALESCE(u.deleted, 0) = 0`
    for (const row of open) ids.add(row.id)
  }
  if ((yield* prefs.get(SHOW_PRESENCE_PREF)) === true) {
    const recent = yield* sql<{ id: string }>`
      SELECT c.user_id AS id FROM topic_index t
      JOIN conversations c ON c.id = t.channel AND c.kind = 'im' AND c.is_member = 1 AND c.user_id IS NOT NULL
      LEFT JOIN users u ON u.id = c.user_id
      WHERE t.kind = 'main' AND c.user_id != ${selfId} AND c.user_id != 'USLACKBOT' AND COALESCE(u.is_bot, 0) = 0 AND COALESCE(u.deleted, 0) = 0
      ORDER BY t.last_activity_ts DESC
      LIMIT ${PRESENCE_LIMIT}`
    for (const row of recent) ids.add(row.id)
  }
  return [...ids].toSorted()
})

/** Runs for each sync, in its scope, and shares its socket. */
const sessionPresence = (people: SubscriptionRef.SubscriptionRef<PresencePeople>, self: SelfPresence['Service'], link: SyncLink['Service']): SessionStart => Effect.gen(function* () {
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
    const { active, away } = split(wanted, presence, session.userId)
    return SubscriptionRef.update(people, (last) => (sameIds(last.active, active) && sameIds(last.away, away) ? last : { active, away })).pipe(
      Effect.andThen(self.set(presence.get(session.userId))),
    )
  })
  // Sends the list when it differs from the last one sent; nothing before the first read.
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

  // The open DMs come from the shown topics; the query runs again when they change, and when the store or the pref does.
  const wantedChanges = link.shownChanges.pipe(
    Stream.map(channelsOf),
    Stream.changesWith(sameIds),
    Stream.switchMap((channels) => liveQuery(['prefs', 'topics', 'conversations', 'users'], wantedIds(session.userId, channels))),
    Stream.debounce(SUB_SETTLE),
  )

  yield* Effect.addFinalizer(() => Effect.andThen(SubscriptionRef.set(people, unknown), self.set(undefined)))
  yield* Effect.forkScoped(Stream.runForEach(wantedChanges, (result) => {
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

/** The followed people other than the user, by what Slack last said, sorted; those it has not answered for are left out. */
const split = (wanted: ReadonlySet<string>, presence: ReadonlyMap<string, 'active' | 'away'>, selfId: string): PresencePeople => {
  const active: Array<string> = []
  const away: Array<string> = []
  for (const id of [...wanted].toSorted()) {
    const value = id === selfId ? undefined : presence.get(id)
    if (value === 'active') active.push(id)
    else if (value === 'away') away.push(id)
  }
  return { active, away }
}

const sameIds = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) => a.length === b.length && a.every((id, index) => id === b[index])
