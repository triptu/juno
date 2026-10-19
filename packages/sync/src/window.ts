/** History coverage when the owner widens the quiet window. */
import { compareTs, millisToTs, type Ts } from '@juno/domain'
import { SlackApi, SlackDecodeError } from '@juno/slack'
import { Clock, Effect } from 'effect'
import { transaction } from '@juno/store'
import { bootState, followPass, type BootError, type BootServices } from './boot'
import type { SyncContext } from './context'
import { activeConversations, loadCounts } from './counts'
import { discoverSince } from './discovery'
import { applyPage, mainTopicOf } from './pages'
import { fillUsers, nameFirst } from './users'
import { addSyncedRange, latestSyncedRange, setSyncState } from './write'

/** Runs under the sync work permit. Every request uses the paced background lane. */
export const backfillWindow = (ctx: SyncContext): Effect.Effect<void, BootError, BootServices> => Effect.gen(function* () {
  const days = ctx.config.quietDays
  const now = yield* Clock.currentTimeMillis
  const startMillis = now - days * 86_400_000
  const start = millisToTs(startMillis)
  const counts = yield* loadCounts(ctx, undefined, 'background')
  for (const conversation of yield* activeConversations(counts.entries, start)) {
    yield* fillHistory(ctx, conversation.id, start, conversation.latest).pipe(
      Effect.catchTag('SlackRejected', (error) => Effect.logWarning('sync: window history refused', { cause: error })),
    )
  }
  yield* followPass(ctx)
  yield* discoverSince(ctx, startMillis, counts.entries, {})
  yield* fillUsers(ctx)
  const previous = yield* bootState()
  if (previous !== undefined) yield* transaction(setSyncState('boot', { ...previous, quietDays: days }))
})

const fillHistory = (ctx: SyncContext, channel: string, start: Ts, latest: Ts): Effect.Effect<void, BootError, BootServices> => Effect.gen(function* () {
  const api = yield* SlackApi
  while (true) {
    const range = yield* latestSyncedRange(channel)
    if (range !== undefined && compareTs(range.from_ts, start) <= 0 && compareTs(range.to_ts, latest) >= 0) return
    // Extend the newest covered range backwards; a retry starts at the last completed page.
    const before = range !== undefined && compareTs(range.to_ts, latest) >= 0 ? range.from_ts : undefined
    const requestedAt = millisToTs(yield* Clock.currentTimeMillis)
    const page = yield* api.call('conversations.history', {
      channel, oldest: start, ...(before === undefined ? {} : { latest: before }),
      inclusive: true, limit: ctx.config.historyPageLimit, ignore_replies: true, no_user_profile: true,
    }, { lane: 'background', reason: 'window-history' })
    yield* nameFirst(ctx, page.messages, 'background')
    const oldest = page.messages.at(-1)?.ts
    if (page.has_more && (oldest === undefined || oldest === before)) {
      // A malformed page must not claim coverage or spin without advancing.
      return yield* new SlackDecodeError({ method: 'conversations.history', message: 'Window history did not advance' })
    }
    yield* transaction(Effect.gen(function* () {
      yield* addSyncedRange(channel, page.has_more && oldest !== undefined ? oldest : start, before ?? requestedAt)
      yield* applyPage(ctx, channel, page.messages, { kind: 'page', requestedAt }, { alsoTouch: [mainTopicOf(channel)] })
    }))
    yield* Effect.yieldNow
  }
})
