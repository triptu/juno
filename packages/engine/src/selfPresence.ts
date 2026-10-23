/**
 * What Slack shows colleagues for the user (SPEC 14, "Your own dot"), from
 * `presence_change` for the user's own id. `presence/service.ts` writes it
 * from the socket; `notifications.status` reads it for the avatar's dot.
 * Undefined until Slack answers and while the socket is down.
 */
import type { Presence } from '@juno/domain'
import { Context, Effect, Layer, Stream, SubscriptionRef } from 'effect'

export class SelfPresence extends Context.Service<SelfPresence, {
  readonly current: Effect.Effect<Presence | undefined>
  /** `current` first, then each change. */
  readonly changes: Stream.Stream<Presence | undefined>
  readonly set: (presence: Presence | undefined) => Effect.Effect<void>
}>()('juno/engine/SelfPresence') {
  static readonly layer = Layer.effect(SelfPresence, Effect.gen(function* () {
    const ref = yield* SubscriptionRef.make<Presence | undefined>(undefined)
    return SelfPresence.of({
      current: SubscriptionRef.get(ref),
      changes: SubscriptionRef.changes(ref).pipe(Stream.changes),
      set: (presence) => SubscriptionRef.set(ref, presence),
    })
  }))
}
