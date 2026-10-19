/**
 * The send queue that the composer and Juno Agent's host share
 * (architecture 5.7). `queueText` writes a `pending_messages` row the way
 * the composer does: the text as one `rich_text` block and its mrkdwn
 * fallback. `PostQueue.wake` asks `PostWorker` (`send/worker.ts`) to look
 * at the rows now. One queue, one worker and one set of rules, whoever sent
 * the message.
 *
 * A top-level module, like `outbox.ts`, so the `send` and `agent-host`
 * features can both use it.
 */
import { Context, Effect, Layer, Queue } from 'effect'
import { composeOutgoing } from '@juno/richtext'
import { queuePost, type PendingFile, type PendingShare } from '@juno/sync'

export class PostQueue extends Context.Service<
  PostQueue,
  {
    /** Look at the pending posts now: one was queued, or a row changed. */
    readonly wake: Effect.Effect<void>
    /** Waits for the next wake. Only `PostWorker` takes them. */
    readonly woken: Effect.Effect<void>
  }
>()('juno/engine/PostQueue') {
  static readonly layer: Layer.Layer<PostQueue> = Layer.effect(
    PostQueue,
    Effect.gen(function* () {
      const signal = yield* Queue.sliding<void>(1)
      return PostQueue.of({ wake: Effect.asVoid(Queue.offer(signal, undefined)), woken: Queue.take(signal) })
    }),
  )
}

/**
 * Queues a message as the composer does, inside the caller's transaction.
 * Returns the text the post carries, its mrkdwn fallback. Text that is only
 * whitespace goes with its files and no blocks.
 */
export const queueText = (post: {
  readonly clientMsgId: string
  readonly channel: string
  readonly threadTs: string | undefined
  readonly text: string
  readonly files?: ReadonlyArray<PendingFile>
  /** A forward's source (`send/forward.ts`); the text is its note. */
  readonly share?: PendingShare
  readonly createdAt: number
}) => {
  const empty = post.text.trim() === ''
  const outgoing = composeOutgoing(post.text)
  const text = empty ? '' : outgoing.text
  return queuePost({ ...post, text, blocksJson: empty ? null : JSON.stringify(outgoing.blocks) }).pipe(Effect.as(text))
}
