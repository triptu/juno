/**
 * What Slack accepted from Juno's own edits, deletes, reactions and
 * broadcasts (`ActionWorker`, architecture 5.7), stored as the socket event
 * would store it.
 */
import { millisToTs } from '@juno/domain'
import type { Message } from '@juno/slack-schema'
import { Invalidation, StoreWriter, transaction, type SqlError } from '@juno/store'
import { Clock, Effect } from 'effect'
import { writeBroadcast } from './broadcasts'
import type { SyncContext } from './context'
import { writeChanged, writeDeleted, writeReaction } from './events'

type Services = StoreWriter | Invalidation

/** What Slack accepted, by kind. */
export type Acted =
  | { readonly kind: 'edited'; readonly channel: string; readonly message: Message }
  | { readonly kind: 'deleted'; readonly channel: string; readonly ts: string }
  | { readonly kind: 'reacted'; readonly channel: string; readonly ts: string; readonly name: string; readonly added: boolean }
  | { readonly kind: 'broadcast'; readonly channel: string; readonly ts: string }

/**
 * Stores what Slack accepted as the socket event would store it, and runs
 * `alongside` (which ends the outbox row) in the same transaction, so the
 * view goes from the row's intent to the stored message with nothing in
 * between. The event, when it comes, changes nothing more.
 */
export const applyActed = <E>(
  ctx: SyncContext,
  acted: Acted,
  alongside: Effect.Effect<unknown, E, Services>,
): Effect.Effect<void, SqlError | E, Services> =>
  Effect.gen(function* () {
    const eventTs = millisToTs(yield* Clock.currentTimeMillis)
    yield* transaction(
      Effect.gen(function* () {
        switch (acted.kind) {
          case 'edited':
            yield* writeChanged(ctx, acted.channel, acted.message, acted.message.edited?.ts ?? eventTs)
            break
          case 'deleted':
            yield* writeDeleted(ctx, acted.channel, acted.ts, { kind: 'event', eventTs })
            break
          case 'reacted':
            yield* writeReaction(ctx, { channel: acted.channel, ts: acted.ts, name: acted.name, user: ctx.me.userId, added: acted.added }, eventTs)
            break
          case 'broadcast':
            yield* writeBroadcast(ctx, acted.channel, acted.ts)
            break
        }
        yield* alongside
      }),
    )
  })
