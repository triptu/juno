/**
 * The host, bound for the turn engine: the Slack read tools' `HostReads`
 * over the AgentHost client, and the latest `host.presence`.
 *
 * Every Slack read names the account it is for. The account is the one the
 * latest presence names, so a read made after the owner switched accounts
 * fails with `stale` at the host instead of reading the other workspace.
 * With no account signed in, a read fails with `signedOut` here. The topic
 * list names no account: it is Juno's own list for the open workspace.
 *
 * While the host port is closed (the engine restarts), presence reads as
 * offline until the next port gives a fresh one.
 */
import { Effect, Stream, SubscriptionRef } from 'effect'
import { AgentHostError, HostChannelId, HostCursor, type HostChannel, HostMessageTs, HostUserId, type HostPresence } from '@juno/agent-contract'
import type { SchedulerOptions } from '../schedule/scheduler'
import type { WatchHost } from '../schedule/commands'
import type { HostReads } from '../router/host-tools'
import { AgentHost } from './client'

export type Presence = typeof HostPresence.Type

/** How many messages one read asks for. The request builder pages long results. */
const READ_LIMIT = 50

export interface BoundHost {
  readonly reads: HostReads
  readonly schedule: Pick<SchedulerOptions, 'replies' | 'cachedReplies' | 'account' | 'enabled'> & WatchHost
  readonly scheduleChanges: Stream.Stream<void, unknown>
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
    Effect.andThen(
      Effect.suspend(() => {
        if (current === undefined || !current.online) return Effect.void
        current = { ...current, online: false }
        return SubscriptionRef.set(latest, current)
      }),
    ),
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
    channels: async (pattern) => {
      const account = current?.accountId
      if (account == null) throw signedOut
      const channels: Array<typeof HostChannel.Type> = []
      let cursor: typeof HostCursor.Type | undefined
      do {
        const page = await withAccount((accountId) => accountId === account
          ? client['host.slack.channels']({ accountId, pattern, limit: 200, ...(cursor === undefined ? {} : { cursor }) })
          : Effect.fail(new AgentHostError({ reason: 'stale', message: 'The Slack account changed.' })))
        channels.push(...page.channels)
        cursor = page.next
      } while (cursor !== undefined)
      return channels
    },
    search: (query, { cursor, limit: count = limit, ...options } = {}) => withAccount((accountId) => client['host.slack.search']({ accountId, query, limit: count, ...options, ...(cursor === undefined ? {} : { cursor: HostCursor.make(cursor) }) })),
    history: (channelId) => withAccount((accountId) => client['host.slack.history']({ accountId, channelId: HostChannelId.make(channelId), limit })),
    replies: (channelId, threadTs) =>
      withAccount((accountId) =>
        client['host.slack.replies']({ accountId, channelId: HostChannelId.make(channelId), threadTs: HostMessageTs.make(threadTs), limit }),
      ),
    topics: () => withAccount(() => client['host.topics.list']({ limit })),
    person: (userId) => withAccount((accountId) => client['host.slack.person']({ accountId, userId: HostUserId.make(userId) })),
    people: (since) => withAccount((accountId) => client['host.slack.people']({ accountId, since, limit: 200 })).then((answer) => answer.people),
    members: (names) => withAccount((accountId) => client['host.slack.members']({ accountId, names: [...names].slice(0, 200) })).then((answer) => answer.members),
  }
  const check = (conversation: import('../schedule/rules').ReplyWatch, refresh: boolean) => {
    if (conversation.accountId !== undefined && conversation.accountId !== current?.accountId) return Promise.reject(new AgentHostError({ reason: 'stale', message: 'Another Slack account is signed in.' }))
    return withAccount((accountId) => client['host.schedule.check']({ accountId, conversation, refresh }))
  }
  return {
    reads,
    schedule: {
      replies: (conversation) => check(conversation, true),
      cachedReplies: (conversation) => check(conversation, false),
      account: () => current?.accountId ?? undefined,
      enabled: () => current?.aiEnabled === true && current.accountId !== null,
      ownMessage: (conversation) => withAccount((accountId) => client['host.schedule.check']({ accountId, conversation, refresh: false })).then((snapshot) => snapshot.ownMessage),
      hours: () => withAccount((accountId) => client['host.schedule.hours']({ accountId })),
    },
    scheduleChanges: client['host.schedule.changes'](),
    presence: () => current,
    presenceChanges: SubscriptionRef.changes(latest),
  } satisfies BoundHost
})
