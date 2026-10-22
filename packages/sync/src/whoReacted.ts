/**
 * Everyone who reacted to one message, for the "who reacted" dialog.
 * A page may list fewer people than a reaction's count; `reactions.get` with
 * `full` lists them all (research section 10, "Who reacted"). The answer is
 * stored as a page's reactions are (architecture 5.4): only when no event
 * touched the message after the request started, so a reaction added or
 * removed meanwhile is not undone.
 */
import { compareTs, millisToTs, type Ts } from '@juno/domain'
import { SlackApi } from '@juno/slack'
import { transaction } from '@juno/store'
import { Clock, Effect } from 'effect'
import type { SyncContext } from './context'
import type { OpenError, OpenServices } from './open'
import { readMessage, replaceReactions } from './write'

/** Fetches and stores every reactor of a stored message on the interactive lane. True when the store took the answer. */
export const fetchFullReactions = (ctx: SyncContext, channel: string, ts: string): Effect.Effect<boolean, OpenError, OpenServices> =>
  Effect.gen(function* () {
    const api = yield* SlackApi
    const requestedAt = millisToTs(yield* Clock.currentTimeMillis)
    const answer = yield* api.call('reactions.get', { channel, timestamp: ts as Ts, full: true }, { lane: 'interactive', reason: 'reactors' })
    if (answer.message === undefined) return false
    const reactions = answer.message.reactions ?? []
    return yield* transaction(
      Effect.gen(function* () {
        const existing = yield* readMessage(channel, ts)
        if (existing === undefined || existing.deleted === 1) return false
        if (existing.last_event_ts !== null && compareTs(existing.last_event_ts, requestedAt) >= 0) return false
        yield* replaceReactions(existing, reactions, ctx.me.userId)
        return true
      }),
    )
  })
