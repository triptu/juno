/**
 * Ids the chat surfaces carry back to the agent. Each is a string the agent
 * minted (UUIDv7 for ops, actions and jobs; dense integers as strings for
 * archive messages). The views never parse them.
 */
import { Schema } from 'effect'

/** An archive message: an owner bubble, a Juno bubble, a note or a card's anchor. */
export const ChatMessageId = Schema.String.pipe(Schema.brand('ChatMessageId'))
export type ChatMessageId = typeof ChatMessageId.Type

/** The inbox op of an owner send. "Try again" resubmits the same op. */
export const OpId = Schema.String.pipe(Schema.brand('OpId'))
export type OpId = typeof OpId.Type

/** A card (an action intent, or a proposal that is not an action yet). */
export const CardId = Schema.String.pipe(Schema.brand('CardId'))
export type CardId = typeof CardId.Type

/** One row of a Send message card: a child action with its own outcome. */
export const ProposedMessageId = Schema.String.pipe(Schema.brand('ProposedMessageId'))
export type ProposedMessageId = typeof ProposedMessageId.Type

/** One option of a Question card. */
export const QuestionOptionId = Schema.String.pipe(Schema.brand('QuestionOptionId'))
export type QuestionOptionId = typeof QuestionOptionId.Type

/** A background job: a subagent or a T3 Code session. */
export const JobId = Schema.String.pipe(Schema.brand('JobId'))
export type JobId = typeof JobId.Type

export const ScheduleId = Schema.String.pipe(Schema.brand('ScheduleId'))
export type ScheduleId = typeof ScheduleId.Type

/** One Juno bubble: the run and the bubble's place in it, `<runId>:<n>`. */
export const BubbleId = Schema.String.pipe(Schema.brand('BubbleId'))
export type BubbleId = typeof BubbleId.Type

export const RunId = Schema.String.pipe(Schema.brand('RunId'))
export type RunId = typeof RunId.Type

export const PinId = Schema.String.pipe(Schema.brand('PinId'))
export type PinId = typeof PinId.Type

export const ConnectionId = Schema.String.pipe(Schema.brand('ConnectionId'))
export type ConnectionId = typeof ConnectionId.Type
