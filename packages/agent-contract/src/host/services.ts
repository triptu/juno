import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import { AccountId, ActionId, AuthorizationId, AttemptId, Digest, ExecutableIdentity } from '@juno/agent-cards'
import { OpenTarget, Place, TopicLink } from '../chat/place'
import { AgentHostRpcs } from './port'

export const HostChannelId = Schema.String.pipe(Schema.brand('HostChannelId'))
export const HostTopicId = Schema.String.pipe(Schema.brand('HostTopicId'))
export const HostUserId = Schema.String.pipe(Schema.brand('HostUserId'))
export const HostMessageTs = Schema.String.pipe(Schema.brand('HostMessageTs'))
export const HostCursor = Schema.String.pipe(Schema.brand('HostCursor'))
const limit = Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(200))
export class AgentHostError extends Schema.TaggedError<AgentHostError>()('AgentHostError', {
  reason: Schema.Literals(['offline', 'signedOut', 'notFound', 'rateLimited', 'stale', 'unsupported', 'rejected']),
  message: Schema.String,
}) {}
export const HostMessage = Schema.Struct({
  channelId: HostChannelId, ts: HostMessageTs, threadTs: Schema.optionalKey(HostMessageTs),
  senderId: HostUserId, text: Schema.String, editedAt: Schema.optionalKey(HostMessageTs),
  clientMessageId: Schema.optionalKey(ActionId),
})
export const HostMessagePage = Schema.Struct({ messages: Schema.Array(HostMessage), next: Schema.optionalKey(HostCursor) })
export const hostSearch = Rpc.make('host.slack.search', { payload: { accountId: AccountId, query: Schema.String, cursor: Schema.optionalKey(HostCursor), limit }, success: HostMessagePage, error: AgentHostError })
export const hostHistory = Rpc.make('host.slack.history', { payload: { accountId: AccountId, channelId: HostChannelId, cursor: Schema.optionalKey(HostCursor), limit }, success: HostMessagePage, error: AgentHostError })
export const hostReplies = Rpc.make('host.slack.replies', { payload: { accountId: AccountId, channelId: HostChannelId, threadTs: HostMessageTs, cursor: Schema.optionalKey(HostCursor), limit }, success: HostMessagePage, error: AgentHostError })
export const hostTopics = Rpc.make('host.topics.list', { payload: { cursor: Schema.optionalKey(HostCursor), limit },
  success: Schema.Struct({ topics: Schema.Array(TopicLink), next: Schema.optionalKey(HostCursor) }), error: AgentHostError })
export const hostTopic = Rpc.make('host.topics.get', { payload: { topicId: HostTopicId },
  success: Schema.Struct({ topic: TopicLink, place: Place, accountId: AccountId, resolved: Schema.Boolean, messages: HostMessagePage }), error: AgentHostError })
export const hostPerson = Rpc.make('host.slack.person', { payload: { accountId: AccountId, userId: HostUserId },
  success: Schema.Struct({ id: HostUserId, name: Schema.String, displayName: Schema.String }), error: AgentHostError })
export const HostReadRpcs = RpcGroup.make(hostSearch, hostHistory, hostReplies, hostTopics, hostTopic, hostPerson)

/** An already-consumed authorization is the unit of deduplication at the host boundary.
 * Repeating an RPC must return the recorded attempt, never submit it again. */
export const HostDispatch = Schema.Struct({
  actionId: ActionId, authorizationId: AuthorizationId, attemptId: AttemptId,
  digest: Digest, payload: ExecutableIdentity, mode: Schema.Literal('single-attempt'),
})
export const HostDispatchResult = Schema.Union([
  Schema.TaggedStruct('done', { attemptId: AttemptId, receipt: Schema.Json, open: Schema.optionalKey(OpenTarget) }),
  Schema.TaggedStruct('failed', { attemptId: AttemptId, reason: Schema.String }),
  Schema.TaggedStruct('unknown', { attemptId: AttemptId }),
])
/** Transport failure after consumption is an unknown result (or a lost RPC), never a retry. */
export const hostSend = Rpc.make('host.outbox.send', { payload: HostDispatch, success: HostDispatchResult, error: AgentHostError })
export const hostResolve = Rpc.make('host.topics.resolve', { payload: HostDispatch, success: HostDispatchResult, error: AgentHostError })
export const hostCancel = Rpc.make('host.outbox.cancel', { payload: { authorizationId: AuthorizationId, attemptId: AttemptId },
  success: Schema.Union([
    Schema.TaggedStruct('cancel-requested', {}), Schema.TaggedStruct('cancelled', {}), HostDispatchResult,
  ]), error: AgentHostError })
/** A negative lookup is explicitly unknown. It is never proof of non-delivery. */
export const hostReconcileSend = Rpc.make('host.outbox.reconcileSend', { payload: { accountId: AccountId, channelId: HostChannelId,
  actionId: ActionId, attemptId: AttemptId }, success: Schema.Union([
    Schema.TaggedStruct('found', { message: HostMessage }), Schema.TaggedStruct('unknown', {}),
  ]), error: AgentHostError })
export const HostActionRpcs = RpcGroup.make(hostSend, hostResolve, hostCancel, hostReconcileSend)

export const HostPresence = Schema.Struct({
  online: Schema.Boolean, aiEnabled: Schema.Boolean, quietHours: Schema.Boolean,
  ownerActive: Schema.Boolean, accountId: Schema.NullOr(AccountId),
  thisTopic: Schema.NullOr(Schema.Struct({ topicId: HostTopicId, place: Place })),
})
export const hostPresence = Rpc.make('host.presence', { success: HostPresence, stream: true })
export const HostPresenceRpcs = RpcGroup.make(hostPresence)
export const NotificationId = Schema.String.pipe(Schema.brand('AgentNotificationId'))
/** Quiet hours gate OS delivery, never chat admission or action authorization. */
export const hostNotify = Rpc.make('host.notification.deliver', {
  payload: { id: NotificationId, title: Schema.String, body: Schema.String,
    deliver: Schema.Literals(['now', 'digest', 'silent']), open: Schema.optionalKey(OpenTarget) },
  success: Schema.Literals(['delivered', 'held', 'suppressed', 'alreadyDelivered']), error: AgentHostError,
})
export const HostNotificationRpcs = RpcGroup.make(hostNotify)

/** WP13 serves this group once all handlers exist. Protocol 1 remains the hello scaffold. */
export const AGENT_HOST_FULL_PROTOCOL = 2
export const AgentHostFullRpcs = AgentHostRpcs.merge(HostReadRpcs, HostActionRpcs, HostPresenceRpcs, HostNotificationRpcs)
