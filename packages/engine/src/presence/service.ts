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
 *
 * Whether each followed person has notifications paused (SPEC 14, "Paused
 * colleagues") comes from Slack's Do Not Disturb, kept the same way: one
 * `dnd.teamInfo` for the people not yet asked about, each time the set
 * changes, and for everyone after each connect; one again for a person on
 * each `dnd_updated_user`, as Slack's client does, batched with any that
 * arrive while a call runs. Slack may not send `dnd_updated_user` for
 * people Juno has not subscribed to, so when a DM is shown (opened, or its
 * tab shown again) Juno asks again about its partner if the last answer is
 * older than `dndStaleMillis`. The people are asked about only while the
 * socket is connected; the connect asks about everyone. One timer wakes at the earliest time anyone's
 * pause starts or ends, publishes, and asks again about each person whose
 * scheduled pause just ended, since Slack names only the next one. Nothing
 * polls.
 */
import { SHOW_PRESENCE_PREF, type PresencePeople } from '@juno/contract'
import { parseTopicId } from '@juno/domain'
import { SlackSession, SlackSocket } from '@juno/slack'
import { liveQuery, prefs, StoreReader } from '@juno/store'
import { Clock, Context, Effect, Layer, Semaphore, Stream, SubscriptionRef } from 'effect'
import { SelfPresence } from '../selfPresence'
import { SocketEvents, type SessionStart } from '../socketEvents'
import { SyncLink } from '../syncLink'
import { SystemWake } from '../systemWake'
import { pausedPeople } from './dnd'

/** How many recent DM partners Juno follows at most while the sidebar setting is on. */
export const PRESENCE_LIMIT = 100

/** How long the set of people must hold before it is sent, so switching through tabs sends once. */
const SUB_SETTLE = '100 millis'

const unknown: PresencePeople = { active: [], away: [], paused: [] }

export class OthersPresence extends Context.Service<OthersPresence, {
  /** What Slack last said about each followed user other than the user, sorted; the current value first. */
  readonly people: Stream.Stream<PresencePeople>
}>()('juno/engine/OthersPresence') {
  static readonly layer = Layer.effect(OthersPresence, Effect.gen(function* () {
    const people = yield* SubscriptionRef.make(unknown)
    const self = yield* SelfPresence
    const events = yield* SocketEvents
    const link = yield* SyncLink
    const wake = yield* SystemWake
    yield* events.subscribe('presence', sessionPresence(people, self, link, wake))
    return OthersPresence.of({ people: SubscriptionRef.changes(people) })
  }))
}

/** The channels of the shown topics. */
const channelsOf = (topicIds: ReadonlyArray<string>) => [...new Set(topicIds.flatMap((id) => parseTopicId(id)?.channel ?? []))]

/** The people to follow (`ids`), sorted: the user, the partners of the open DMs (`open`), and of the recent DMs while the setting is on. */
const wantedIds = (selfId: string, openChannels: ReadonlyArray<string>) => Effect.gen(function* () {
  const sql = yield* StoreReader
  const ids = new Set<string>([selfId])
  const openIds: Array<string> = []
  if (openChannels.length > 0) {
    const open = yield* sql<{ id: string }>`
      SELECT c.user_id AS id FROM conversations c LEFT JOIN users u ON u.id = c.user_id
      WHERE c.id IN ${sql.in(openChannels)} AND c.kind = 'im' AND c.is_member = 1 AND c.user_id IS NOT NULL
        AND c.user_id != ${selfId} AND c.user_id != 'USLACKBOT' AND COALESCE(u.is_bot, 0) = 0 AND COALESCE(u.deleted, 0) = 0`
    for (const row of open) ids.add(row.id)
    openIds.push(...open.map((row) => row.id).toSorted())
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
  return { ids: [...ids].toSorted(), open: openIds }
})

/** Whom a sync follows. */
interface Following {
  /** The users to follow now, and their ids joined. */
  wanted: ReadonlySet<string>
  wantedKey: string
  /** The partners of the DMs shown now, joined. */
  openKey: string
  /** Whether the socket is connected: people are asked about only then. */
  connected: boolean
}

/** The people to follow, again each time the shown topics change (the open DMs), and when the store or the pref does. */
const wantedChanges = (link: SyncLink['Service'], selfId: string) => link.shownChanges.pipe(
  Stream.map(channelsOf),
  Stream.changesWith(sameIds),
  Stream.switchMap((channels) => liveQuery(['prefs', 'topics', 'conversations', 'users'], wantedIds(selfId, channels))),
  Stream.debounce(SUB_SETTLE),
)

/**
 * Takes a new answer to whom to follow: forgets what is known of those no longer followed, and asks Slack about
 * who has notifications paused among the new people and the partners of newly shown DMs whose answer is stale.
 * Before the connect it asks nothing, since the connect asks about everyone; whether the socket is connected is read
 * when the ask runs, so a connect that came before the first answer still counts.
 */
const follow = (state: Following, next: { readonly ids: ReadonlyArray<string>; readonly open: ReadonlyArray<string> }, presence: Map<string, 'active' | 'away'>, paused: Effect.Success<ReturnType<typeof pausedPeople>>) => {
  const shown = state.openKey.split(',')
  const newlyShown = next.open.filter((id) => !shown.includes(id))
  state.openKey = next.open.join(',')
  const key = next.ids.join(',')
  if (key !== state.wantedKey) {
    state.wanted = new Set(next.ids)
    state.wantedKey = key
    for (const id of presence.keys()) if (!state.wanted.has(id)) presence.delete(id)
  }
  const unasked = paused.keepOnly(state.wanted)
  return Effect.suspend(() => (state.connected ? Effect.andThen(paused.askAbout(unasked), paused.refresh(newlyShown)) : Effect.void))
}

/** Runs for each sync, in its scope, and shares its socket. */
const sessionPresence = (people: SubscriptionRef.SubscriptionRef<PresencePeople>, self: SelfPresence['Service'], link: SyncLink['Service'], wake: SystemWake['Service']): SessionStart => Effect.gen(function* () {
  const socket = yield* SlackSocket
  const session = yield* SlackSession
  const lock = yield* Semaphore.make(1)
  const state: Following = { wanted: new Set(), wantedKey: '', openKey: '', connected: false }
  /** The ids last sent on this connection, joined; undefined when nothing was sent on it. */
  let sent: string | undefined
  /** What Slack last said for each followed user on this connection. */
  const presence = new Map<string, 'active' | 'away'>()

  const publish: Effect.Effect<void> = Effect.gen(function* () {
    const next = { ...split(state.wanted, presence, session.userId), paused: paused.now((yield* Clock.currentTimeMillis) / 1000) }
    yield* SubscriptionRef.update(people, (last) => (samePeople(last, next) ? last : next))
    yield* self.set(presence.get(session.userId))
  })

  const paused = yield* pausedPeople({ selfId: session.userId, wanted: () => state.wanted, lock, publish: Effect.suspend(() => publish) }).pipe(Effect.provideService(SystemWake, wake))
  // Sends the list when it differs from the last one sent; nothing before the first read.
  const subscribe = Effect.suspend(() => {
    if (sent === state.wantedKey || (sent === undefined && state.wanted.size === 0)) return Effect.void
    const key = state.wantedKey
    return socket.send({ type: 'presence_sub', ids: [...state.wanted] }).pipe(Effect.map((ok) => {
      if (ok) sent = key
    }))
  })
  // Presence from an earlier connection may be stale: forget it, and subscribe again once connected.
  const forget = Effect.suspend(() => {
    sent = undefined
    state.connected = false
    presence.clear()
    paused.forget()
    return publish
  })

  yield* Effect.addFinalizer(() => Effect.andThen(SubscriptionRef.set(people, unknown), self.set(undefined)))
  yield* Effect.forkScoped(Stream.runForEach(wantedChanges(link, session.userId), (result) => {
    if (result._tag === 'Failure') return Effect.logWarning('presence: could not read whom to follow', { error: String(result.failure) })
    if (result.success.ids.join(',') === state.wantedKey && result.success.open.join(',') === state.openKey) return Effect.void
    return lock.withPermits(1)(Effect.suspend(() => {
      const ask = follow(state, result.success, presence, paused)
      return Effect.andThen(publish, subscribe).pipe(Effect.andThen(ask))
    })).pipe(
      // A failed send is logged, and the next change or connect sends again.
      Effect.catchDefect((defect) => Effect.logWarning('presence: could not subscribe', { defect })),
    )
  }))

  return (input) => lock.withPermits(1)(Effect.suspend(() => {
    switch (input._tag) {
      // After an overflow changes were dropped: subscribing again makes Slack send the current presence.
      case 'Connected':
      case 'Overflowed':
        return Effect.andThen(forget, subscribe).pipe(Effect.andThen(Effect.suspend(() => {
          state.connected = true
          return paused.askAbout(state.wanted)
        })))
      case 'Disconnected':
        return forget
      case 'Frame': {
        const frame = input.frame
        if (frame.type === 'dnd_updated_user') return frame.user !== undefined && state.wanted.has(frame.user) ? paused.askAbout([frame.user]) : Effect.void
        // The official client reads only `users`; a frame with a single `user` it logs and drops.
        if (frame.type !== 'presence_change' || frame.users === undefined) return Effect.void
        for (const id of frame.users) if (state.wanted.has(id)) presence.set(id, frame.presence)
        return publish
      }
    }
  }))
})

/** The followed people other than the user, by what Slack last said, sorted; those it has not answered for are left out. */
const split = (wanted: ReadonlySet<string>, presence: ReadonlyMap<string, 'active' | 'away'>, selfId: string): Omit<PresencePeople, 'paused'> => {
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
const samePeople = (a: PresencePeople, b: PresencePeople) => sameIds(a.active, b.active) && sameIds(a.away, b.away) && sameIds(a.paused, b.paused)
