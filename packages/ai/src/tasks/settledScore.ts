import type { TopicId } from '@juno/domain'
import { Type } from '../schema'
import { defineStructuredTask } from '../task'
import { prompt } from './settledScore.prompt'
import { renderMessages, type AiMessage } from './shared'

export interface SettledScoreInput {
  readonly topicId: TopicId
  readonly title: string
  readonly channel: string
  /** ISO time, so the quiet since the last message counts. */
  readonly now: string
  /** The last messages, oldest first. */
  readonly messages: ReadonlyArray<AiMessage>
}

export const SettledScoreOutput = Type.Object({
  score: Type.Number({ minimum: 0, maximum: 1 }),
  reason: Type.String({ maxLength: 120 }),
})

/** Decision. Runs once a topic has been idle for 2 minutes, not per message. */
export const settledScore = defineStructuredTask<SettledScoreInput, typeof SettledScoreOutput>({
  name: 'settledScore',
  version: 1,
  tier: 'decision',
  prompt,
  tool: { name: 'score_settled', description: 'Report how settled the conversation is.' },
  output: SettledScoreOutput,
  render: (input) => `Topic: ${input.title} (${input.channel})\nNow: ${input.now}\n\nMessages:\n${renderMessages(input.messages)}`,
  key: (input) => input.topicId,
})
