import type { TopicId } from '@juno/domain'
import { Type } from '../schema'
import { defineStructuredTask } from '../task'
import { classifierInstructions, prompt, settledCriteria } from './settledScore.prompt'
import { messagesState, renderMessages, type AiMessage } from './shared'

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
  /** One short clause from a chat model. A decision model gives none. */
  reason: Type.Optional(Type.String({ maxLength: 120 })),
})

/**
 * Decision. Runs once a topic has been idle for 2 minutes, not per message, so
 * nobody waits. 3 s leaves room for one retry of a 0.9 s p95 classifier call.
 */
export const settledScore = defineStructuredTask<SettledScoreInput, typeof SettledScoreOutput>({
  name: 'settledScore',
  version: 2,
  tier: 'decision',
  timeoutMillis: 3000,
  prompt,
  tool: { name: 'score_settled', description: 'Report how settled the conversation is.' },
  output: SettledScoreOutput,
  classify: {
    ask: (input) => ({
      state: { topic: input.title, channel: input.channel, now: input.now, messages: messagesState(input.messages) },
      questions: { settled: { type: 'bool', instructions: classifierInstructions, criteria: settledCriteria } },
    }),
    read: (answers) => {
      const a = answers.settled
      return a?.type === 'bool' ? { score: a.probability } : undefined
    },
  },
  render: (input) => `Topic: ${input.title} (${input.channel})\nNow: ${input.now}\n\nMessages:\n${renderMessages(input.messages)}`,
  key: (input) => input.topicId,
})
