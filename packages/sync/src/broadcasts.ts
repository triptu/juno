/**
 * A thread reply also sent to the channel (SPEC 7, "Also send to the
 * channel"; architecture 5.7). The command queues a `broadcast` outbox row
 * (`queueBroadcast`); when Slack has accepted it, the stored reply becomes
 * `thread_broadcast` in the transaction that ends the row (`writeBroadcast`,
 * through `applyActed`).
 */
import { mainTopicId, type ChannelId } from '@juno/domain'
import { Invalidation, StoreWriter, type SqlError } from '@juno/store'
import { Effect } from 'effect'
import { actionsOn, insertAction, resolveTarget, targetFields, type ActionRefusal, type MessageRef } from './actions'
import { reindexOptions, type SyncContext } from './context'
import { reindexTopics, topicsOfMessages } from './reindex'
import { readMessage, writeMessage } from './write'

type Services = StoreWriter | Invalidation

export interface BroadcastInput {
  readonly ref: MessageRef
  readonly selfId: string
  readonly now: number
}

/**
 * Broadcast: the user's own thread reply is also sent to the channel. Only a
 * reply Slack has, as Slack's own client offers it: not a root, not a reply
 * already sent, not a post still pending. The row's topics are the thread
 * and Main, which shows the reply until Slack has it (`messages.list`). A
 * second broadcast of the same reply writes nothing.
 */
export const queueBroadcast = (input: BroadcastInput): Effect.Effect<ActionRefusal | undefined, SqlError, Services> =>
  Effect.gen(function* () {
    const target = yield* resolveTarget(input.ref)
    if (target === undefined || (target.kind === 'stored' && target.row.deleted === 1)) return 'missing'
    if (target.kind === 'pending') return 'not-sent'
    const { row } = target
    if (row.user_id !== input.selfId) return 'not-own'
    if (row.thread_ts === null || row.thread_ts === row.ts) return 'missing'
    const actions = yield* actionsOn(target)
    if (actions.some((action) => action.kind === 'delete')) return 'missing'
    if (row.subtype === 'thread_broadcast' || actions.some((action) => action.kind === 'broadcast')) return undefined
    const { channel, dependsOn, ...fields } = targetFields(target)
    yield* insertAction('broadcast', channel, dependsOn, { ...fields, topics: [...fields.topics, mainTopicId(channel as ChannelId)] }, input.now)
    return undefined
  })

/**
 * One of the user's replies Slack has also sent to the channel. Only the
 * subtype changes: the reply keeps its content, which the `message_changed`
 * that follows also carries.
 */
export const writeBroadcast = (ctx: SyncContext, channel: string, ts: string): Effect.Effect<void, SqlError, Services> =>
  Effect.gen(function* () {
    const existing = yield* readMessage(channel, ts)
    if (existing === undefined || existing.deleted === 1 || existing.subtype === 'thread_broadcast') return
    const row = { ...existing, subtype: 'thread_broadcast', version: existing.version + 1 }
    yield* writeMessage(row)
    yield* reindexTopics(topicsOfMessages([row]), reindexOptions(ctx))
  })
