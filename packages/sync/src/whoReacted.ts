/**
 * Fetch everyone who reacted to one message. Compare the stored snapshot
 * before and after the request so a socket event or page cannot be undone
 * by an older answer. A superseded answer asks the open dialog to try again.
 */
import type { Ts } from '@juno/domain'
import { SlackApi } from '@juno/slack'
import { StoreWriter, transaction } from '@juno/store'
import { Effect } from 'effect'
import type { SyncContext } from './context'
import type { OpenError, OpenServices } from './open'
import { readMessage, replaceReactions } from './write'

/** The stored reaction snapshot after a settled read; undefined when a concurrent write superseded it. */
export const fetchFullReactions = (ctx: SyncContext, channel: string, ts: string): Effect.Effect<string | undefined, OpenError, OpenServices> =>
  Effect.gen(function* () {
    const api = yield* SlackApi
    const sql = yield* StoreWriter
    const snapshot = transaction(Effect.gen(function* () {
      const message = yield* readMessage(channel, ts)
      const reactions = yield* sql<{ name: string; count: number; user_ids_json: string | null }>`
        SELECT name, count, user_ids_json FROM reactions WHERE channel = ${channel} AND ts = ${ts} ORDER BY rowid`
      return { message, reactions, revision: JSON.stringify([message?.version, reactions]) }
    }))
    const before = yield* snapshot
    if (before.message === undefined || before.message.deleted === 1) return JSON.stringify(before.reactions)
    if (before.reactions.every((reaction) => JSON.parse(reaction.user_ids_json ?? '[]').length >= reaction.count)) return JSON.stringify(before.reactions)
    const answer = yield* api.call('reactions.get', { channel, timestamp: ts as Ts, full: true }, { lane: 'interactive', reason: 'reactors' })
    if (answer.message === undefined) return JSON.stringify(before.reactions)
    const reactions = answer.message.reactions ?? []
    return yield* transaction(
      Effect.gen(function* () {
        const current = yield* snapshot
        if (current.message === undefined || current.message.deleted === 1) return JSON.stringify(current.reactions)
        if (current.revision !== before.revision) return undefined
        yield* replaceReactions(current.message, reactions, ctx.me.userId)
        return JSON.stringify((yield* snapshot).reactions)
      }),
    )
  })
