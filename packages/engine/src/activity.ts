/**
 * Keeps the owner shown as active in Slack while they use the Mac (SPEC 14,
 * "Active in Slack"; docs/research/slack-data-access.md section 3, Presence).
 *
 * Main reads the Mac's idle time every 10 s and sends `active` while the
 * owner used the Mac in the last 10 minutes and the screen is not locked.
 * On each one, and when the socket connects within 20 s of one, the running
 * session sends a socket `tickle`, which `SlackSocket` paces to one per 19 s, as the
 * official client does. Nothing is sent while the owner's presence is away
 * (Set yourself away, or outside active hours), so Slack keeps them away. When
 * it stops being away (Set yourself active, or the active hours start or are
 * changed to include now), main's last reading tickles at once, rather than
 * Slack hearing at main's next one.
 * When the Mac goes idle the tickles stop and Slack's own timeout shows the
 * owner away; when Juno quits, the socket closes.
 */
import { Clock, Context, Effect, Layer, Option, Stream, SubscriptionRef } from 'effect'
import { SlackSocket } from '@juno/slack'
import { NotificationControl } from './notificationRuntime'
import { HostLink } from './protocol/host'
import { SocketEvents, type SessionStart } from './socketEvents'

/** How long one `active` from main counts: main sends it every 10 s while the owner is at the Mac. */
export const ACTIVE_WINDOW_MILLIS = 20_000

export class OwnerActivity extends Context.Service<OwnerActivity, {
  /** When main last said the owner is at the Mac, on the engine's clock. */
  readonly lastActiveAt: SubscriptionRef.SubscriptionRef<number | undefined>
}>()('juno/engine/OwnerActivity') {
  static readonly layer = Layer.effect(OwnerActivity, Effect.gen(function* () {
    const lastActiveAt = yield* SubscriptionRef.make<number | undefined>(undefined)
    const link = yield* HostLink
    const fromMain = yield* link.messages
    yield* Effect.forkScoped(Stream.runForEach(fromMain, (message) =>
      message._tag === 'active' ? Effect.flatMap(Clock.currentTimeMillis, (now) => SubscriptionRef.set(lastActiveAt, now)) : Effect.void))
    const control = yield* NotificationControl
    const events = yield* SocketEvents
    yield* events.subscribe('activity', sessionActivity(lastActiveAt, control))
    return OwnerActivity.of({ lastActiveAt })
  }))
}

/** Runs for each sync, in its scope, and shares its socket. */
const sessionActivity = (lastActiveAt: SubscriptionRef.SubscriptionRef<number | undefined>, control: NotificationControl['Service']): SessionStart => Effect.gen(function* () {
  const socket = yield* SlackSocket
  const tickle = Effect.gen(function* () {
    const at = yield* SubscriptionRef.get(lastActiveAt)
    if (at === undefined || (yield* Clock.currentTimeMillis) - at > ACTIVE_WINDOW_MILLIS) return
    // Manual away stays away, as in the official client.
    if ((yield* control.currentPresence) === 'away') return
    yield* socket.tickle('polling')
  })
  yield* Effect.forkScoped(Stream.runForEach(SubscriptionRef.changes(lastActiveAt), () => tickle))
  yield* Effect.forkScoped(Stream.runForEach(Stream.zipWithPrevious(control.presence), ([before, now]) =>
    Option.getOrUndefined(before) === 'away' && now !== undefined && now !== 'away' ? tickle : Effect.void))
  // `Overflowed` needs nothing: the next `active` from main tickles anyway.
  return (input) => input._tag === 'Connected' ? tickle : Effect.void
})
