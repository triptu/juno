/**
 * The host, bound for the turn engine: the Slack read tools' `HostReads`
 * over the AgentHost client, and the latest `host.presence`.
 *
 * Every read names the account it is for. The account is the one the
 * latest presence names, so a read made after the owner switched accounts
 * fails with `stale` at the host instead of reading the other workspace.
 * With no account signed in, a read fails with `signedOut` here.
 */
import { Effect, Stream, SubscriptionRef } from 'effect'
import { AgentHostError, HostChannelId, HostMessageTs, HostUserId, type HostPresence } from '@juno/agent-contract'
import type { HostReads } from '../router/host-tools'
import { AgentHost } from './client'

export type Presence = typeof HostPresence.Type

/** How many messages one read asks for. The request builder pages long results. */
const READ_LIMIT = 50

export interface BoundHost {
  readonly reads: HostReads
  /** The latest presence, or undefined before the first one arrives. */
  readonly presence: () => Presence | undefined
  /** The current presence, then every change. */
  readonly presenceChanges: Stream.Stream<Presence | undefined>
}

/** Follows `host.presence` in the current scope and binds the reads to its account. */
export const bindHost = Effect.gen(function* () {
  const client = yield* AgentHost
  const latest = yield* SubscriptionRef.make<Presence | undefined>(undefined)
  let current: Presence | undefined
  // The stream ends when the host port closes; the client takes the next port, so follow it again.
  yield* client['host.presence']().pipe(
    Stream.runForEach((presence) => Effect.andThen(Effect.sync(() => (current = presence)), SubscriptionRef.set(latest, presence))),
    Effect.ignore,
    Effect.andThen(Effect.sleep('1 second')),
    Effect.forever,
    Effect.forkScoped,
  )

  const signedOut = new AgentHostError({ reason: 'signedOut', message: 'Juno is signed out of Slack.' })
  const withAccount = <A, E>(read: (accountId: NonNullable<Presence['accountId']>) => Effect.Effect<A, E>): Promise<A> => {
    const accountId = current?.accountId
    if (accountId == null) return Promise.reject(signedOut)
    // Reject with the failure itself, so the read tool sees its `reason`.
    return Effect.runPromise(Effect.result(read(accountId))).then((result) =>
      result._tag === 'Success' ? result.success : Promise.reject(result.failure),
    )
  }
  const limit = READ_LIMIT

  const reads: HostReads = {
    search: (query) => withAccount((accountId) => client['host.slack.search']({ accountId, query, limit })),
    history: (channelId) => withAccount((accountId) => client['host.slack.history']({ accountId, channelId: HostChannelId.make(channelId), limit })),
    replies: (channelId, threadTs) =>
      withAccount((accountId) =>
        client['host.slack.replies']({ accountId, channelId: HostChannelId.make(channelId), threadTs: HostMessageTs.make(threadTs), limit }),
      ),
    topics: () => withAccount(() => client['host.topics.list']({ limit })),
    person: (userId) => withAccount((accountId) => client['host.slack.person']({ accountId, userId: HostUserId.make(userId) })),
  }
  return {
    reads,
    presence: () => current,
    presenceChanges: SubscriptionRef.changes(latest),
  } satisfies BoundHost
})
