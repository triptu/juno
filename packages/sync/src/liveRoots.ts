/**
 * Roots posted while the socket is up (`SyncContext.liveRoots`): a root can
 * have no reply before it, and every reply after it arrives on the same
 * connection, so its thread is proven from the root on (`threadRanges.ts`).
 */
import { isReply, type Message } from '@juno/slack-schema'
import { StoreWriter, type Invalidation, type SqlError } from '@juno/store'
import { Effect } from 'effect'
import type { SyncContext } from './context'
import { addThreadRange } from './write'

type Services = StoreWriter | Invalidation

/** Live roots `SyncContext.liveRoots` keeps at most. */
const LIVE_ROOTS_MAX = 2000

/**
 * A root posted while the socket was up: it can have no reply before it, and
 * every reply after it arrives on the same connection, so its thread is
 * proven from the root on (`threadRanges.ts`). The range is written when the
 * thread gets its first reply, or at once when it already has one (Juno's
 * own reply can land before the root's echo).
 */
export const noteLiveRoot = (ctx: SyncContext, channel: string, message: Message): Effect.Effect<void, SqlError, Services> =>
  Effect.gen(function* () {
    if (isReply(message) || !ctx.socket.connected) return
    const key = `${channel}:${message.ts}`
    ctx.liveRoots.delete(key)
    ctx.liveRoots.add(key)
    if (ctx.liveRoots.size > LIVE_ROOTS_MAX) ctx.liveRoots.delete(ctx.liveRoots.keys().next().value!)
    const sql = yield* StoreWriter
    const replies = yield* sql<{ n: number }>`SELECT count(*) AS n FROM messages WHERE channel = ${channel} AND thread_ts = ${message.ts} AND ts <> ${message.ts}`
    if ((replies[0]?.n ?? 0) > 0) yield* liveRootRange(ctx, channel, message.ts)
  })

/** The thread of a root `noteLiveRoot` saw on this connection gets its live range from the root. */
export const liveRootRange = (ctx: SyncContext, channel: string, rootTs: string): Effect.Effect<void, SqlError, Services> =>
  Effect.gen(function* () {
    const key = `${channel}:${rootTs}`
    if (!ctx.liveRoots.has(key) || !ctx.socket.connected) return
    ctx.liveRoots.delete(key)
    yield* addThreadRange(channel, rootTs, { from_ts: rootTs, to_ts: rootTs, tail: 'live' })
  })
