/**
 * Incoming huddles (SPEC 20, "Incoming huddles"): the card at the top of the
 * sidebar, the ring and the OS notification when someone starts a huddle
 * where the user is. The rules over the running list and the call are in
 * `@juno/huddle` (`incoming.ts`); here each fresh huddle is decided by the
 * notification settings (`decideHuddleAlert`), named, and posted.
 *
 * The list lives for one sync: a new session starts it empty.
 */
import { Clock, Context, Effect, Layer, Semaphore, Stream, SubscriptionRef } from 'effect'
import type { HuddleCall, IncomingHuddle, RunningHuddles } from '@juno/contract'
import { channelLabel, decideHuddleAlert, localTime, type ConversationKind } from '@juno/domain'
import { dismiss, Huddle, incomingOf, lookAt, noIncoming, offer, settle, type Fresh, type IncomingState } from '@juno/huddle'
import { readSettings } from '@juno/notifications'
import { SlackSession } from '@juno/slack'
import { StoreReader } from '@juno/store'
import { conversationLabel } from '../placeLabel'
import { HostLink } from '../protocol/host'
import { SocketEvents, type SessionServices, type SocketListener } from '../socketEvents'

const ignore: SocketListener = () => Effect.void

/**
 * How the notification settings let this huddle interrupt, and whether Ring
 * for huddles lets it play the sound. A store that cannot say lets it ring:
 * a live call must not be lost.
 */
const alertFor = (fresh: Fresh, now: number) =>
  Effect.gen(function* () {
    const { settings } = yield* readSettings
    return { alert: decideHuddleAlert({ channelId: fresh.channelId, startedBy: fresh.startedBy, at: localTime(now) }, settings), sound: settings.huddleRing !== false }
  }).pipe(Effect.catch(() => Effect.succeed({ alert: 'ring' as const, sound: true })))

/** A person's name as message notifications show it: their display name first. */
const personName = (sql: StoreReader['Service'], id: string) =>
  sql<{ name: string | null }>`SELECT COALESCE(NULLIF(display_name, ''), NULLIF(real_name, ''), name) AS name FROM users WHERE id = ${id}`.pipe(Effect.map((rows) => rows[0]?.name ?? undefined))

/**
 * Titled with the place as a message's notification is ("#eng", "Maya",
 * "Maya, Leo"); the body says who started it: "Maya started a huddle", or in
 * a DM, which the title already names, "Started a huddle".
 */
const notificationOf = (entry: IncomingHuddle, teamId: string) =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const channel = (yield* sql<{ kind: ConversationKind; name: string | null; user_id: string | null }>`SELECT kind, name, user_id FROM conversations WHERE id = ${entry.channelId}`)[0]
    const starter = (yield* personName(sql, entry.startedBy)) ?? 'Someone'
    let title = 'Huddle'
    if (channel?.kind === 'mpim') title = (yield* conversationLabel(entry.channelId))?.label ?? title
    else if (channel?.kind === 'im') title = (channel.user_id === null ? undefined : yield* personName(sql, channel.user_id)) ?? starter
    else if (channel !== undefined) title = channelLabel({ kind: channel.kind, name: channel.name ?? entry.channelId })
    return {
      id: `${teamId}:huddle:${entry.callId}`,
      title,
      body: channel?.kind === 'im' ? 'Started a huddle' : `${starter} started a huddle`,
      target: { _tag: 'huddle' as const, channelId: entry.channelId },
      silent: true,
    }
  })

export class IncomingHuddles extends Context.Service<IncomingHuddles, {
  /** Newest first: at subscribe time, then every change. */
  readonly incoming: Stream.Stream<ReadonlyArray<IncomingHuddle>>
  readonly dismiss: (callId: string) => Effect.Effect<void>
}>()('juno/engine/IncomingHuddles') {
  static readonly layer = Layer.effect(IncomingHuddles, Effect.gen(function* () {
    const huddle = yield* Huddle
    const events = yield* SocketEvents
    const link = yield* HostLink
    const state = yield* SubscriptionRef.make<IncomingState>(noIncoming)
    const lock = yield* Semaphore.make(1)

    yield* events.subscribe('huddleIncoming', Effect.gen(function* () {
      const context = yield* Effect.context<SessionServices>()
      const session = yield* SlackSession
      const selfId = session.userId
      yield* Effect.acquireRelease(SubscriptionRef.set(state, noIncoming), () => lock.withPermits(1)(SubscriptionRef.set(state, noIncoming)))
      const step = (running: RunningHuddles, call: HuddleCall) =>
        lock.withPermits(1)(Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          const looked = lookAt(yield* SubscriptionRef.get(state), running, selfId, now)
          const entries: Array<IncomingHuddle> = []
          for (const fresh of looked.fresh) {
            const { alert, sound } = yield* alertFor(fresh, now).pipe(Effect.provide(context))
            entries.push(incomingOf(fresh, alert, sound, call, now))
          }
          const next = settle(offer(looked.state, entries), running, call, selfId)
          yield* SubscriptionRef.set(state, next)
          for (const entry of entries) {
            if (entry.alert !== 'ring' || !next.list.includes(entry)) continue
            const notification = yield* notificationOf(entry, session.teamId).pipe(Effect.provide(context), Effect.option)
            if (notification._tag === 'Some') yield* link.send({ _tag: 'notify', notification: notification.value })
          }
        }))
      yield* Effect.forkScoped(Stream.runForEach(Stream.zipLatest(huddle.running, huddle.call), ([running, call]) =>
        step(running, call).pipe(Effect.catchCause((cause) => Effect.logWarning('huddle: incoming failed', { cause: String(cause) }))),
      ))
      return ignore
    }))

    return IncomingHuddles.of({
      incoming: SubscriptionRef.changes(state).pipe(Stream.map((current) => current.list), Stream.changes),
      dismiss: (callId) => lock.withPermits(1)(SubscriptionRef.update(state, (before) => dismiss(before, callId))),
    })
  }))
}
