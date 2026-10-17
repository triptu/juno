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

/**
 * The first `titleTopic` version whose prompt keeps sensitive details out of
 * titles (SPEC section 2, Topic titles). An AI title stored under an older
 * version is titled again, and is blurred in privacy mode until then. A later
 * prompt change that keeps the rule leaves this as it is.
 */
export const TITLE_SAFE_SINCE = 2

/** Generation. Runs once for a new thread, and once more for a title made before `TITLE_SAFE_SINCE`. */
export const titleTopic = defineTextTask<TitleTopicInput>({
  name: 'titleTopic',
  version: 2,
  tier: 'generation',
  maxChars: 60,
  prompt,
  render: (input) => `Channel: ${input.channel}\n\nMessages:\n${renderMessages(input.messages)}`,
  key: (input) => input.topicId,
})
