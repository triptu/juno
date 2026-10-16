/**
 * Follows the host's hours-start summaries (SPEC 14): each is appended to the
 * chat with no run (`summaries.ts`), then handed back. A Mac that released
 * Juno writes nothing, so the summary waits for the Mac that owns it. A lost
 * port is followed again after a second, for as long as the agent runs.
 */
import { Effect, Stream } from 'effect'
import { AgentHost } from '../host/client'
import type { Turns } from '../router/open'
import { invalidateChatCaches } from './chat'
import { appendSummary } from './summaries'

export const followHostSummaries = (turns: Turns): Effect.Effect<never, never, AgentHost> => Effect.gen(function* () {
  const client = yield* AgentHost
  yield* client['host.notification.summaries']().pipe(
    Stream.runForEach((summaries) => Effect.forEach(summaries, (summary) => Effect.gen(function* () {
      if (turns.ownership.owner().state === 'released') return
      if (appendSummary(turns.store, summary)) invalidateChatCaches(turns.store)
      yield* client['host.notification.summaryTaken']({ id: summary.id })
    }), { discard: true })),
  )
}).pipe(Effect.ignore, Effect.andThen(Effect.sleep('1 second')), Effect.forever)
