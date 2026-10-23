import { mainTopicId, millisToTs, type ChannelId, type Ts } from '@juno/domain'
import { SlackApi } from '@juno/slack'
import { transaction } from '@juno/store'
import { Clock, Effect, Queue } from 'effect'
import { reindexOptions, trackFetch, wantMembers, type SyncContext } from '../context'
import { patchMetadata, readMetadata, storeMetadata } from '../metadata'
import { applyPage, mainTopicOf } from '../pages'
import { reindexTopics } from '../reindex'
import { observeRead, toConversationRow } from '../write'


export const fetchRoots = (ctx: SyncContext) => Effect.gen(function* () {
  const api = yield* SlackApi
  while (true) {
    const { channel, ts } = yield* Queue.take(ctx.rootFetches)
    const fetchRoot = Effect.gen(function* () {
      const requestedAt = yield* Effect.map(Clock.currentTimeMillis, (now) => millisToTs(now))
      const result = yield* Effect.result(
        api.call('conversations.replies', { channel, ts: ts as Ts, oldest: ts, inclusive: true, limit: 1 }, { lane: 'background', reason: 'root' }),
      )
      if (result._tag === 'Failure') {
        if (result.failure._tag === 'SlackAuthRequired') return yield* result.failure
        return yield* Effect.logDebug('sync: root fetch failed', { cause: result.failure })
      }
      // The root carries `subscribed` and `last_read`, so a thread older than the window is a row as soon as it is followed.
      yield* applyPage(ctx, channel, result.success.messages, { kind: 'page', requestedAt }).pipe(
        Effect.catchCause((cause) => Effect.logError('sync: root not applied', { cause })),
      )
    })
    yield* trackFetch(ctx, fetchRoot)
  }
})

/**
 * Main's read pointer when Slack must settle it (specs/readstate.qnt):
 * `conversations.info` carries `last_read`, and its answer is a page.
 * A failure is dropped: the next counts call (a reconnect or the
 * periodic catch-up) brings the pointer too.
 */
export const lookUpReads = (ctx: SyncContext) => Effect.gen(function* () {
  const api = yield* SlackApi
  while (true) {
    const channel = yield* Queue.take(ctx.readLookups)
    const requestedAt = yield* Effect.map(Clock.currentTimeMillis, (now) => millisToTs(now))
    const result = yield* Effect.result(api.call('conversations.info', { channel }, { lane: 'background', reason: 'conversation' }))
    if (result._tag === 'Failure') {
      if (result.failure._tag === 'SlackAuthRequired') return yield* result.failure
      yield* Effect.logDebug('sync: read lookup failed', { cause: result.failure })
      continue
    }
    const lastRead = result.success.channel.last_read
    if (lastRead === undefined) continue
    yield* transaction(
      Effect.gen(function* () {
        const topic = mainTopicId(channel as ChannelId)
        const outcome = yield* observeRead(topic, { kind: 'page', lastReadTs: lastRead, requestedAt })
        if (outcome === 'applied') yield* reindexTopics([topic], reindexOptions(ctx))
        // Something newer was observed while it was in flight and Slack still disagrees: ask again.
        if (outcome === 'lookup') yield* Queue.offer(ctx.readLookups, channel)
      }),
    ).pipe(Effect.catchCause((cause) => Effect.logError('sync: read lookup not applied', { cause })))
  }
})

/**
 * A conversation a live message arrived in that the store has never seen:
 * its metadata from `conversations.info`, and membership when it is a DM or
 * group DM (`noteMember` in `events.ts`) unless an event said otherwise
 * meanwhile. A failure is dropped: the next counts call brings it.
 */
export const lookUpConversations = (ctx: SyncContext) => Effect.gen(function* () {
  const api = yield* SlackApi
  while (true) {
    const channel = yield* Queue.take(ctx.conversationLookups)
    yield* readMetadata(ctx.metadata, (observed) => Effect.gen(function* () {
      const result = yield* Effect.result(api.call('conversations.info', { channel }, { lane: 'background', reason: 'conversation' }))
      if (result._tag === 'Failure') {
        if (result.failure._tag === 'SlackAuthRequired') return yield* result.failure
        return yield* Effect.logDebug('sync: conversation lookup failed', { cause: result.failure })
      }
      const row = toConversationRow(result.success.channel)
      yield* transaction(
        Effect.gen(function* () {
          yield* storeMetadata(observed, [row])
          const member = row.kind === 'im' || row.kind === 'mpim' || result.success.channel.is_member === true
          if (member && observed.get(channel)?.is_member === undefined) yield* patchMetadata(ctx.metadata, channel, { is_member: 1 })
          wantMembers(ctx, row)
          yield* reindexTopics([mainTopicOf(channel)], reindexOptions(ctx))
        }),
      ).pipe(Effect.catchCause((cause) => Effect.logError('sync: conversation lookup not applied', { cause })))
    }))
  }
})
