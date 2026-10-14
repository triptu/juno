import type { ConversationKind } from '@juno/domain'
import { Type } from '../schema'
import { defineStructuredTask } from '../task'
import { messagesState, oneLine, renderMessages, type AiMessage } from './shared'
import { classifierInstructions, prompt, notificationReasons, notificationCriteria } from './urgencyGate.prompt'

export interface UrgencyGateInput {
  /** The owner's notification preferences in their own words. */
  readonly matters?: string
  /** The message's Slack ts, the cache entity. */
  readonly messageTs: string
  readonly channel: string
  readonly channelKind: ConversationKind
  readonly sender: string
  readonly text: string
  readonly mentionsMe: boolean
  readonly now: string
  /** A little context: the messages before it in the same topic, oldest first. */
  readonly before?: ReadonlyArray<AiMessage>
}

/** The decision and its explanation are stored with the notification. */
export const UrgencyGateOutput = Type.Object({
  notify: Type.Boolean(),
  reason: Type.String({ minLength: 1 }),
})

export const urgencyGate = defineStructuredTask<UrgencyGateInput, typeof UrgencyGateOutput>({
  name: 'urgencyGate',
  version: 2,
  tier: 'decision',
  timeoutMillis: 2000,
  prompt,
  tool: { name: 'gate', description: 'Decide whether to notify the owner and explain why.' },
  output: UrgencyGateOutput,
  classify: {
    ask: (input) => ({
      state: {
        matters: input.matters ?? '',
        where: input.channel,
        kind: input.channelKind,
        now: input.now,
        before: messagesState(input.before ?? []),
        message: { sender: input.sender, mentionsMe: input.mentionsMe, text: input.text },
      },
      questions: {
        decision: { type: 'choice', instructions: classifierInstructions, criteria: notificationCriteria },
      },
    }),
    read: (answers) => {
      const answer = answers.decision
      if (answer?.type !== 'choice') return undefined
      return Object.entries(notificationReasons).find(([key]) => key === answer.choice)?.[1]
    },
  },
  render: (input) =>
    [
      `Where: ${input.channel} (${input.channelKind})`,
      `What matters to you: ${input.matters ?? ''}`,
      `Now: ${input.now}`,
      input.before && input.before.length > 0 ? `Before:\n${renderMessages(input.before)}\n` : '',
      `Message from ${input.sender}${input.mentionsMe ? ', mentioning me' : ''}: ${oneLine(input.text)}`,
    ]
      .filter((line) => line !== '')
      .join('\n'),
  key: (input) => input.messageTs,
})
