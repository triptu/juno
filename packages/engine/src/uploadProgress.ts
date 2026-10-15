/**
 * `UploadProgress`: how far each post's uploads have got, by
 * `client_msg_id`, from 0 to 1, for the pending rows (`uploads.progress`).
 * Memory only: after a restart a post starts its missing files again.
 */
import { Context, Effect, Layer, Stream, SubscriptionRef } from 'effect'
import type { UploadProgress as Progress } from '@juno/contract'

export class UploadProgress extends Context.Service<
  UploadProgress,
  {
    readonly set: (clientMsgId: string, done: number) => Effect.Effect<void>
    readonly clear: (clientMsgId: string) => Effect.Effect<void>
    readonly changes: Stream.Stream<Progress>
  }
>()('juno/engine/files/UploadProgress') {
  static readonly layer: Layer.Layer<UploadProgress> = Layer.effect(
    UploadProgress,
    Effect.gen(function* () {
      const ref = yield* SubscriptionRef.make<Progress>({})
      return UploadProgress.of({
        set: (clientMsgId, done) => SubscriptionRef.update(ref, (all) => ({ ...all, [clientMsgId]: Math.min(1, Math.max(0, done)) })),
        clear: (clientMsgId) =>
          SubscriptionRef.update(ref, (all) => {
            if (!(clientMsgId in all)) return all
            const { [clientMsgId]: _, ...rest } = all
            return rest
          }),
        changes: SubscriptionRef.changes(ref),
      })
    }),
  )
}
