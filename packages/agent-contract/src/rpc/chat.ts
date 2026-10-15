import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import { Revision } from '@juno/agent-cards'
import { CardBinding } from './identity'
import { BubbleId, CardId, ChatMessageId, OpId } from '../chat/ids'
import { Emoji, ReplyTarget, RemoveSheet } from '../chat/items'
import { ChatPage, ChatSummary } from '../chat/page'
import { SendContext } from '../chat/place'
import { Accepted, AgentCommandError, PageLimit, operation } from './common'

/** First subscription opens the newest window or the first unread row. Anchored windows
 * can page in either direction; every emitted ChatPage carries both edge flags. */
/** What a window is anchored on: any row's own id. An owner bubble has its op id before its archive id. */
export const ChatAnchor = Schema.Union([ChatMessageId, BubbleId, CardId, OpId])
export const ChatWindow = Schema.Union([
  Schema.TaggedStruct('latest', { limit: PageLimit }),
  Schema.TaggedStruct('unread', { limit: PageLimit }),
  Schema.TaggedStruct('around', { anchor: ChatAnchor, before: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)), limit: PageLimit }),
  Schema.TaggedStruct('above', { anchor: ChatAnchor, limit: PageLimit }),
  Schema.TaggedStruct('below', { anchor: ChatAnchor, limit: PageLimit }),
])
/** View data stays WP7-shaped. Approval identities and edit versions travel beside it. */
export const ChatPageSnapshot = Schema.Struct({
  page: ChatPage,
  cards: Schema.Array(CardBinding),
  messages: Schema.Array(Schema.Struct({ id: ChatMessageId, revision: Revision })),
})
export const chatPage = Rpc.make('agent.chat.page', { payload: { window: ChatWindow }, success: ChatPageSnapshot, stream: true, error: AgentCommandError })
export const chatSummary = Rpc.make('agent.chat.summary', { success: ChatSummary, stream: true })
/**
 * A message, maybe a reply to a Juno bubble or card. While a run is live it joins the run at its next
 * step; otherwise it starts one. A reply to a card is not a click.
 */
export const chatSend = Rpc.make('agent.chat.send', {
  payload: { ...operation, text: Schema.String, context: Schema.optionalKey(SendContext), replyTo: Schema.optionalKey(ReplyTarget) },
  success: Accepted, error: AgentCommandError,
})
/**
 * The owner's reaction on a Juno bubble or card; `emoji: null` removes it. A thumbs up or a removal is
 * only recorded. Any other emoji is queued to Juno like a message, and Juno may ignore it. Never a click.
 */
export const chatReact = Rpc.make('agent.chat.react', {
  payload: {
    ...operation,
    target: Schema.Union([Schema.TaggedStruct('bubble', { id: BubbleId }), Schema.TaggedStruct('card', { id: CardId })]),
    emoji: Schema.NullOr(Emoji),
  },
  success: Accepted, error: AgentCommandError,
})
export const chatRetry = Rpc.make('agent.chat.retry', {
  payload: { ...operation, interruptedOpId: OpId }, success: Accepted, error: AgentCommandError,
})
/** Marks Juno's items read through `through`: a Juno bubble, or an archive message. */
export const chatRead = Rpc.make('agent.chat.read', { payload: { through: Schema.Union([ChatMessageId, BubbleId]) }, success: Schema.Void })
export const chatRemove = Rpc.make('agent.chat.remove', {
  payload: { ...operation, messageId: ChatMessageId, alsoRemoveReply: Schema.Boolean }, success: Accepted, error: AgentCommandError,
})
export const MessageMenu = Schema.Struct({ messageId: ChatMessageId, revision: Revision, sheet: RemoveSheet })
export const chatMessage = Rpc.make('agent.chat.message', {
  payload: { target: ReplyTarget }, success: Schema.NullOr(MessageMenu), error: AgentCommandError,
})
export const ChatRpcs = RpcGroup.make(chatPage, chatSummary, chatSend, chatReact, chatRetry, chatRead, chatRemove, chatMessage)
