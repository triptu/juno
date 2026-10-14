import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import { Revision } from '@juno/agent-cards'
import { CardBinding } from './identity'
import { ChatMessageId, OpId } from '../chat/ids'
import { ChatPage, ChatSummary } from '../chat/page'
import { Place } from '../chat/place'
import { Accepted, AgentCommandError, PageLimit, operation } from './common'

/** First subscription opens the newest window or the first unread row. Anchored windows
 * can page in either direction; every emitted ChatPage carries both edge flags. */
export const ChatWindow = Schema.Union([
  Schema.TaggedStruct('latest', { limit: PageLimit }),
  Schema.TaggedStruct('unread', { limit: PageLimit }),
  Schema.TaggedStruct('around', { anchor: ChatMessageId, before: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)), limit: PageLimit }),
  Schema.TaggedStruct('above', { anchor: ChatMessageId, limit: PageLimit }),
  Schema.TaggedStruct('below', { anchor: ChatMessageId, limit: PageLimit }),
])
/** View data stays WP7-shaped. Approval identities and edit versions travel beside it. */
export const ChatPageSnapshot = Schema.Struct({
  page: ChatPage,
  cards: Schema.Array(CardBinding),
  messages: Schema.Array(Schema.Struct({ id: ChatMessageId, revision: Revision })),
})
export const chatPage = Rpc.make('agent.chat.page', { payload: { window: ChatWindow }, success: ChatPageSnapshot, stream: true, error: AgentCommandError })
export const chatSummary = Rpc.make('agent.chat.summary', { success: ChatSummary, stream: true })
/** The one way to talk to Juno. While a run is live the message joins it at its next step; otherwise it starts one. */
export const chatSend = Rpc.make('agent.chat.send', {
  payload: { ...operation, text: Schema.String, context: Schema.optionalKey(Place) }, success: Accepted, error: AgentCommandError,
})
export const chatRetry = Rpc.make('agent.chat.retry', {
  payload: { ...operation, interruptedOpId: OpId }, success: Accepted, error: AgentCommandError,
})
export const chatRead = Rpc.make('agent.chat.read', { payload: { through: ChatMessageId }, success: Schema.Void })
export const chatRemove = Rpc.make('agent.chat.remove', {
  payload: { ...operation, messageId: ChatMessageId, alsoRemoveReply: Schema.Boolean }, success: Accepted, error: AgentCommandError,
})
export const ChatRpcs = RpcGroup.make(chatPage, chatSummary, chatSend, chatRetry, chatRead, chatRemove)
