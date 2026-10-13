import type { TopicId } from '@juno/domain'
import { defineTextTask } from '../task'
import { renderMessages, type AiMessage } from './shared'
import { prompt } from './titleTopic.prompt'

export interface TitleTopicInput {
  readonly topicId: TopicId
  /** "#eng", "Maya Chen". */
  readonly channel: string
  /** The root and the first replies, oldest first. */
  readonly messages: ReadonlyArray<AiMessage>
}

/** Generation. Runs for a new thread and again when `reply_count` crosses 5 and 20. */
export const titleTopic = defineTextTask<TitleTopicInput>({
  name: 'titleTopic',
  version: 1,
  tier: 'generation',
  maxChars: 60,
  prompt,
  render: (input) => `Channel: ${input.channel}\n\nMessages:\n${renderMessages(input.messages)}`,
  key: (input) => input.topicId,
})
