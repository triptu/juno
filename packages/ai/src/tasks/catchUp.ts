import type { TopicId } from '@juno/domain'
import { defineTextTask } from '../task'
import { prompt } from './catchUp.prompt'
import { renderMessages, type AiMessage } from './shared'

export interface CatchUpInput {
  readonly topicId: TopicId
  readonly title: string
  readonly channel: string
  /** A few messages before the divider, for context. */
  readonly before: ReadonlyArray<AiMessage>
  /** The unread messages, oldest first. */
  readonly unread: ReadonlyArray<AiMessage>
}

/** Generation. Runs when a topic opens with 2 or more unread messages. */
export const catchUp = defineTextTask<CatchUpInput>({
  name: 'catchUp',
  version: 1,
  tier: 'generation',
  maxChars: 280,
  prompt,
  render: (input) =>
    `Topic: ${input.title} (${input.channel})\n\nAlready read:\n${renderMessages(input.before)}\n\nNew (${input.unread.length}):\n${renderMessages(input.unread)}`,
  key: (input) => input.topicId,
})
