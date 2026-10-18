import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import { AccountId, ActionId, AuthorizationId, AttemptId, Digest, ExecutableIdentity } from '@juno/agent-cards'
import { OpenTarget, Place, TopicLink } from '../chat/place'
import { HostHelloRpcs } from './port'

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
/** `senderName` and `channelName` are what the owner sees in Juno ("Maya Chen", "#eng"), so Juno can say names, not ids. */
export const HostMessage = Schema.Struct({
  channelId: HostChannelId, ts: HostMessageTs, threadTs: Schema.optionalKey(HostMessageTs),
  senderId: HostUserId, text: Schema.String, editedAt: Schema.optionalKey(HostMessageTs),
  clientMessageId: Schema.optionalKey(ActionId),
  senderName: Schema.optionalKey(Schema.String), channelName: Schema.optionalKey(Schema.String),
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
/**
 * The people the owner exchanged messages with in one-to-one DMs and in
 * threads since `since` (ms), most exchanged first: counts and names only,
 * never message text. `owner` counts the owner's messages to them, `them`
 * theirs to the owner, `lastAt` (ms) the newest. `dm` is their DM, when
 * there is one. Bots and deactivated people are left out (SPEC 13.8).
 */
export const HostInteraction = Schema.Struct({
  id: HostUserId, name: Schema.String, owner: Schema.Int, them: Schema.Int, lastAt: Schema.Number, dm: Schema.optionalKey(HostChannelId),
})
export const hostPeople = Rpc.make('host.slack.people', { payload: { accountId: AccountId, since: Schema.Number, limit },
  success: Schema.Struct({ people: Schema.Array(HostInteraction) }), error: AgentHostError })
/** Workspace members by name (full, display or handle, or a first name), for each name asked: directory metadata only. */
export const hostMembers = Rpc.make('host.slack.members', { payload: { accountId: AccountId, names: Schema.Array(Schema.String.check(Schema.isMaxLength(120))).check(Schema.isMaxLength(200)) },
  success: Schema.Struct({ members: Schema.Array(Schema.Struct({ name: Schema.String, ids: Schema.Array(Schema.Struct({ id: HostUserId, name: Schema.String })) })) }), error: AgentHostError })
/** Channel directory metadata only; `pattern` is a case-insensitive glob (* and ?). */
export const HostChannel = Schema.Struct({ id: HostChannelId, name: Schema.String })
export const hostChannels = Rpc.make('host.slack.channels', { payload: { accountId: AccountId, pattern: Schema.String, cursor: Schema.optionalKey(HostCursor), limit },
  success: Schema.Struct({ channels: Schema.Array(HostChannel), next: Schema.optionalKey(HostCursor) }), error: AgentHostError })
export const HostReadRpcs = RpcGroup.make(hostSearch, hostHistory, hostReplies, hostTopics, hostTopic, hostPerson, hostChannels, hostPeople, hostMembers)

/** Metadata only: reply watches never send message content to a model to check replies. */
export const WatchConversation = Schema.Struct({ channelId: Schema.String, ts: Schema.String, threadTs: Schema.optionalKey(Schema.String) })
export const WatchReply = Schema.Struct({ channelId: Schema.String, ts: Schema.String, threadTs: Schema.optionalKey(Schema.String), userId: Schema.String })
export const WatchSnapshot = Schema.Struct({ owner: Schema.String, ownMessage: Schema.Boolean, messages: Schema.Array(WatchReply) })
export const WatchHours = Schema.Struct({ timeZone: Schema.String, weekdays: Schema.Array(Schema.Int), start: Schema.Int, end: Schema.Int })
export const hostWatchCheck = Rpc.make('host.schedule.check', { payload: { accountId: AccountId, conversation: WatchConversation, refresh: Schema.Boolean }, success: WatchSnapshot, error: AgentHostError })
export const hostWatchHours = Rpc.make('host.schedule.hours', { payload: { accountId: AccountId }, success: WatchHours, error: AgentHostError })
export const hostWatchChanges = Rpc.make('host.schedule.changes', { success: Schema.Void, stream: true })
export const HostScheduleRpcs = RpcGroup.make(hostWatchCheck, hostWatchHours, hostWatchChanges)

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
export const hostUndoResolve = Rpc.make('host.topics.undoResolve', { payload: { accountId: AccountId, actionId: ActionId }, success: Schema.Void, error: AgentHostError })
export const HostActionRpcs = RpcGroup.make(hostSend, hostResolve, hostUndoResolve, hostCancel, hostReconcileSend)

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

/** Local sidebar settings. Icons are validated by the host against the app's icon set. */
export const HostViewDraft = Schema.Struct({ name: Schema.String, icon: Schema.optionalKey(Schema.String),
  channels: Schema.Array(Schema.String), keepOutOfAll: Schema.Boolean })
export const HostView = Schema.Struct({ ...HostViewDraft.fields, id: Schema.String, position: Schema.Int })
export const HostViewUndo = Schema.Struct({ id: Schema.String, expected: Schema.NullOr(HostView), restore: Schema.NullOr(HostView) })
export const HostViewChange = Schema.Struct({ id: Schema.String, undo: HostViewUndo })
export const hostViewsList = Rpc.make('host.views.list', { payload: { accountId: AccountId }, success: Schema.Array(HostView), error: AgentHostError })
export const hostViewsCreate = Rpc.make('host.views.create', { payload: { accountId: AccountId, view: HostViewDraft }, success: HostViewChange, error: AgentHostError })
export const hostViewsUpdate = Rpc.make('host.views.update', { payload: { accountId: AccountId, id: Schema.String, view: HostViewDraft }, success: HostViewChange, error: AgentHostError })
export const hostViewsDelete = Rpc.make('host.views.delete', { payload: { accountId: AccountId, id: Schema.String }, success: HostViewChange, error: AgentHostError })
export const hostViewsUndo = Rpc.make('host.views.undo', { payload: { accountId: AccountId, undo: HostViewUndo }, success: Schema.Void, error: AgentHostError })
export const HostViewRpcs = RpcGroup.make(hostViewsList, hostViewsCreate, hostViewsUpdate, hostViewsDelete, hostViewsUndo)

/** The whole AgentHost group, protocol `AGENT_HOST_PROTOCOL` (2). */
/**
 * The engine's own model calls (topic art, titles, Home, send checks) use the
 * owner's OpenRouter key, so they spend inside the agent's daily cap (plan v3
 * §5.4) on the `engine` path. Amounts are integer nanodollars. The host
 * offers every open ask, now and on every change, until the agent answers
 * it. The agent applies an ask once by its id, so a repeat is harmless.
 */
export const HostSpendAsk = Schema.Union([
  /**
   * Reserve `amount` under this id. `background` marks the engine's backlog
   * (art for older topics, Home), which may use three quarters of the engine's half.
   */
  Schema.TaggedStruct('reserve', { id: Schema.String, amount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)), background: Schema.optionalKey(Schema.Boolean) }),
  /** Settle the reservation with this id: the reported cost, or null when it is unknown. */
  Schema.TaggedStruct('settle', { id: Schema.String, actual: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))) }),
])
export type HostSpendAsk = typeof HostSpendAsk.Type
export const hostSpendAsks = Rpc.make('host.spend.asks', { success: Schema.Array(HostSpendAsk), stream: true })
/** The agent's answer to one ask: `reserved` or `blocked` for a reservation, `settled` for a settlement. */
export const hostSpendAnswer = Rpc.make('host.spend.answer', {
  payload: { id: Schema.String, ask: Schema.Literals(['reserve', 'settle']), result: Schema.Literals(['reserved', 'blocked', 'settled']) },
  success: Schema.Void,
})
/**
 * The ledger may have room again: the cap went up, the owner allowed another
 * dollar, or a release followed a refusal. The host wakes the background jobs
 * that stopped at the cap, so they do not wait for their timer.
 */
export const hostSpendRoom = Rpc.make('host.spend.room', { success: Schema.Void })
export const HostSpendRpcs = RpcGroup.make(hostSpendAsks, hostSpendAnswer, hostSpendRoom)

/**
 * One model call for the AI activity log in Settings › Juno, or one the cap
 * or a missing key refused. Never prompt or response text: `summary` is at
 * most a short shape such as "reply, 120 words", and `message` an error's
 * short text. The engine stores it in the open workspace's `user.db`.
 */
export const AiCallOutcome = Schema.Literals(['ok', 'error', 'blocked', 'cancelled', 'timeout'])
export type AiCallOutcome = typeof AiCallOutcome.Type
export const HostAiCall = Schema.Struct({
  /** Milliseconds since the epoch, when the call started. */
  at: Schema.Number,
  /** What the call was for: `chat`, `subagent`, `compaction`, or an engine task name. */
  feature: Schema.String,
  /** What it was about: `topic`, `channel`, `chat`, `job`, or '' for nothing in particular. */
  subjectKind: Schema.String,
  subjectId: Schema.String,
  provider: Schema.String,
  model: Schema.String,
  outcome: AiCallOutcome,
  /** Why it was not ok: an error kind or what blocked it. '' when ok. */
  kind: Schema.String,
  message: Schema.String,
  durationMs: Schema.Number,
  inputTokens: Schema.NullOr(Schema.Number),
  outputTokens: Schema.NullOr(Schema.Number),
  costUsd: Schema.NullOr(Schema.Number),
  summary: Schema.String,
})
export type HostAiCall = typeof HostAiCall.Type
export const hostAiRecord = Rpc.make('host.ai.record', { payload: { call: HostAiCall }, success: Schema.Void })
/**
 * The fallback model the owner chose in Settings › Juno, as an OpenRouter
 * slug, or '' for none. The agent sends it on every link and every change;
 * the engine's calls ask it once when their model refuses or is unavailable.
 */
export const hostAiFallback = Rpc.make('host.ai.fallback', { payload: { model: Schema.String.check(Schema.isMaxLength(256)) }, success: Schema.Void })
export const HostAiRpcs = RpcGroup.make(hostAiRecord, hostAiFallback)

export const AgentHostRpcs = HostHelloRpcs.merge(HostReadRpcs, HostActionRpcs, HostPresenceRpcs, HostNotificationRpcs, HostScheduleRpcs, HostViewRpcs, HostSpendRpcs, HostAiRpcs)
