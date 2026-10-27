import { Effect, FiberSet } from 'effect'
import { trackFetch } from '../context'
import { applyActed } from '../acted'
import { applyMembership, applyOpened, applySent } from '../events'
import { fetchAt, fetchNewer, fetchOlder, fetchTopic, type FetchLane, type FetchReport, type OpenError } from '../open'
import { wantUsers } from '../users'
import { fetchFullReactions } from '../whoReacted'
import { queueTopicFiles } from './files'

import type { SyncServices, TopicFetcher } from '../sync'
import { isNotAuth, type SyncRuntime } from './runtime'

export const makeTopicFetcher = (runtime: SyncRuntime) => Effect.gen(function* () {
  const { ctx, background } = runtime
  /** Names the senders an open fetch found unknown, through `nameUsers`. */
  const nameSenders = (report: FetchReport) => Effect.sync(() => wantUsers(ctx, report.unknownUsers))
  const services = yield* Effect.context<SyncServices>()
  const fetched = (fetch: (lane: FetchLane) => Effect.Effect<FetchReport, OpenError, SyncServices>, label: string): Effect.Effect<FetchReport, OpenError> => {
    const run = (lane: FetchLane) => trackFetch(ctx, fetch(lane))
    return run('interactive').pipe(
      Effect.tap(nameSenders),
      Effect.tapError((error) =>
        error._tag === 'SlackRateLimited'
          ? FiberSet.run(
            background,
            run('background').pipe(
              Effect.tap(nameSenders),
              Effect.asVoid,
              Effect.catchIf(isNotAuth, (retry) => Effect.logWarning(`sync: ${label} failed on the background lane`, { cause: retry })),
            ),
          ).pipe(Effect.asVoid)
          : Effect.void,
      ),
      Effect.provide(services),
    )
  }
  // Share only pending reads. Effect.cached cancels the read when its last waiter leaves.
  const reactorFetches = new Map<string, ReturnType<TopicFetcher['reactors']>>()
  const reactors = Effect.fn('TopicFetcher.reactors')(function* (channel: string, ts: string) {
    const key = `${channel}:${ts}`
    const pending = reactorFetches.get(key)
    if (pending !== undefined) return yield* pending
    const fetch = yield* Effect.cached(
      trackFetch(ctx, fetchFullReactions(ctx, channel, ts)).pipe(
        Effect.provide(services),
        Effect.tapError((error) => error._tag === 'SlackAuthRequired' ? FiberSet.run(background, Effect.fail(error)).pipe(Effect.asVoid) : Effect.void),
        Effect.ensuring(Effect.sync(() => { reactorFetches.delete(key) })),
      ),
    )
    reactorFetches.set(key, fetch)
    return yield* fetch
  })
  const fetcher: TopicFetcher = {
    // After the fetch, the topic's stored files Slack had not filled in are asked about, so an old card becomes the picture.
    open: (topicId) =>
      fetched((lane) => fetchTopic(ctx, topicId, lane), 'open').pipe(
        // Forked: the open's answer does not wait for the check.
        Effect.tap(() =>
          FiberSet.run(background, queueTopicFiles(ctx, topicId).pipe(Effect.catchCause((cause) => Effect.logWarning('sync: topic files not checked', { cause })), Effect.provide(services))).pipe(Effect.asVoid),
        ),
      ),
    older: (topicId, before) => fetched((lane) => fetchOlder(ctx, topicId, before, lane), 'older page'),
    newer: (topicId, after) => fetched((lane) => fetchNewer(ctx, topicId, after, lane), 'newer page'),
    at: (topicId, ts) => fetched((lane) => fetchAt(ctx, topicId, ts, lane), 'message page'),
    opened: (channel) => applyOpened(ctx.metadata, channel).pipe(Effect.provide(services)),
    membership: (channel, member) => applyMembership(ctx.metadata, channel, member).pipe(Effect.provide(services)),
    sent: (sent) => applySent(ctx, sent).pipe(Effect.provide(services)),
    acted: (acted, alongside) => applyActed(ctx, acted, alongside).pipe(Effect.provide(services)),
    wantUsers: (ids) => Effect.sync(() => wantUsers(ctx, ids)),
    reactors,
  }
  return fetcher
})
