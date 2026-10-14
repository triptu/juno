import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import { Digest, Revision } from '@juno/agent-cards'
import * as C from '../chat'
import { CardBinding } from './identity'
import { Accepted, AgentCommandError, PageWindow, operation } from './common'

export const ScheduleDefinition = Schema.Union([
  Schema.TaggedStruct('once', { at: Schema.Number }),
  Schema.TaggedStruct('interval', { everyMs: Schema.Int.check(Schema.isGreaterThan(0)) }),
  Schema.TaggedStruct('wallClock', { time: Schema.String.check(Schema.isPattern(/^([01]\d|2[0-3]):[0-5]\d$/)), timeZone: Schema.String,
    weekdays: Schema.NonEmptyArray(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 7 }))) }),
])
export const scheduledPage = Rpc.make('agent.scheduled.page', { success: Schema.Struct({ page: C.ScheduledPage, revisions: Schema.Array(Schema.Struct({ id: C.ScheduleId, revision: Revision })) }), stream: true })
export const scheduledEdit = Rpc.make('agent.scheduled.edit', { payload: { ...operation, id: C.ScheduleId, revision: Revision,
  what: Schema.String, schedule: ScheduleDefinition, deliver: C.Deliver }, success: Accepted, error: AgentCommandError })
export const scheduledAction = Rpc.make('agent.scheduled.action', { payload: { ...operation, id: C.ScheduleId, revision: Revision,
  action: Schema.Literals(['pause', 'resume', 'delete']) }, success: Accepted, error: AgentCommandError })
export const ScheduledRpcs = RpcGroup.make(scheduledPage, scheduledEdit, scheduledAction)

export const remembersPage = Rpc.make('agent.remembers.page', { success: Schema.Struct({ page: C.RemembersPage, revisions: Schema.Array(Schema.Struct({ id: C.PinId, revision: Revision })) }), stream: true })
export const remembersEdit = Rpc.make('agent.remembers.edit', { payload: { ...operation, id: C.PinId, revision: Revision,
  text: Schema.String }, success: Accepted, error: AgentCommandError })
export const remembersRemove = Rpc.make('agent.remembers.remove', { payload: { ...operation, id: C.PinId, revision: Revision }, success: Accepted, error: AgentCommandError })
export const remembersPin = Rpc.make('agent.remembers.pin', { payload: { ...operation, messageId: C.ChatMessageId, revision: Revision,
  startByte: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)), endByte: Schema.Int.check(Schema.isGreaterThan(0)) }, success: Accepted, error: AgentCommandError })
export const RemembersRpcs = RpcGroup.make(remembersPage, remembersEdit, remembersRemove, remembersPin)
export const memoryPage = Rpc.make('agent.memory.page', { payload: { window: PageWindow }, success: C.MemoryPage, stream: true })
export const MemoryRpcs = RpcGroup.make(memoryPage)
export const activityPage = Rpc.make('agent.activity.page', { payload: { window: PageWindow }, success: C.ActivityPage, stream: true })
export const ActivityRpcs = RpcGroup.make(activityPage)

export const connectionsPage = Rpc.make('agent.connections.page', { success: C.ConnectionsPage, stream: true })
export const connectionsAction = Rpc.make('agent.connections.action', { payload: { ...operation, id: C.ConnectionId,
  action: Schema.Literals(['connect', 'disconnect', 'enable', 'disable', 'refresh']) }, success: Accepted, error: AgentCommandError })
export const connectionsTier = Rpc.make('agent.connections.tier', { payload: { ...operation, id: C.ConnectionId, tool: Schema.String,
  schemaHash: Digest, tier: Schema.Literals([0, 3]) }, success: Accepted, error: AgentCommandError })
export const connectionsAddress = Rpc.make('agent.connections.address', { payload: { ...operation, address: C.T3Address }, success: Accepted, error: AgentCommandError })
export const ConnectionsRpcs = RpcGroup.make(connectionsPage, connectionsAction, connectionsTier, connectionsAddress)
export const reviewPage = Rpc.make('agent.review.page', { success: Schema.Struct({ page: C.ReviewPage, cards: Schema.Array(CardBinding) }), stream: true })
export const reviewActivate = Rpc.make('agent.review.activate', { payload: { ...operation, backupAt: Schema.Number,
  oldDeviceOffOrErased: Schema.Literal(true) }, success: Accepted, error: AgentCommandError })
export const ReviewRpcs = RpcGroup.make(reviewPage, reviewActivate)
