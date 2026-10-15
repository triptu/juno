/**
 * Ids the chat surfaces carry back to the agent. Each is a string the agent
 * minted (UUIDv7 for ops, actions and jobs; dense integers as strings for
 * archive messages). The views never parse them.
 */
import { Schema } from 'effect'

// Card and chat ids share one schema and brand in the pure catalogue.
export {
  ChatMessageId, OpId, CardId, ProposedMessageId, QuestionOptionId,
  JobId, ScheduleId, RunId, PinId, ConnectionId,
} from '@juno/agent-cards/presentation'

/** One Juno bubble: the run and the bubble's place in it, `<runId>:<n>`. */
export const BubbleId = Schema.String.pipe(Schema.brand('BubbleId'))
export type BubbleId = typeof BubbleId.Type
