import { Effect, FiberSet } from 'effect'
import { trackFetch } from '../context'
import { applyActed, applyOpened, applySent } from '../events'
import { fetchOlder, fetchTopic, type FetchLane, type FetchReport, type OpenError } from '../open'
import { wantUsers } from '../users'

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
              Effect.catchIf(isNotAuth, (retry) => Effect.logWarning(`sync: ${label} failed on the background lane`, { tag: retry._tag })),
            ),
          ).pipe(Effect.asVoid)
          : Effect.void,
      ),
      Effect.provide(services),
    )
  }
  const fetcher: TopicFetcher = {
    open: (topicId) => fetched((lane) => fetchTopic(ctx, topicId, lane), 'open'),
    older: (topicId, before) => fetched((lane) => fetchOlder(ctx, topicId, before, lane), 'older page'),
    opened: (channel) => applyOpened(ctx.metadata, channel).pipe(Effect.provide(services)),
    sent: (sent) => applySent(ctx, sent).pipe(Effect.provide(services)),
    acted: (acted, alongside) => applyActed(ctx, acted, alongside).pipe(Effect.provide(services)),
  }
  return fetcher
})
