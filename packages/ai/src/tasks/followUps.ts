import type { TopicId } from '@juno/domain'
import { Type } from '../schema'
import { defineStructuredTask } from '../task'
import { prompt } from './followUps.prompt'
import { oneLine, type AiMessage } from './shared'

/** A message the model can point back at: its Slack ts is the id. */
export interface FollowUpMessage extends AiMessage {
  readonly id: string
}

export interface FollowUpsInput {
  readonly topicId: TopicId
  readonly title: string
  readonly channel: string
  /** ISO time. */
  readonly now: string
  /** The latest messages, oldest first, the user's own marked `fromMe`. */
  readonly messages: ReadonlyArray<FollowUpMessage>
}

export const FollowUpsOutput = Type.Object({
  followUps: Type.Array(
    Type.Object({
      messageId: Type.String(),
      text: Type.String({ minLength: 1, maxLength: 120 }),
    }),
    { maxItems: 3 },
  ),
})

/**
 * Decision that extracts text, so a chat model answers. Home's Follow-up
 * item (SPEC section 12): runs in the background on topics the user wrote
 * in, never while anyone waits; 45 s leaves room for a slow call and a retry.
 */
export const followUps = defineStructuredTask<FollowUpsInput, typeof FollowUpsOutput>({
  name: 'followUps',
  version: 1,
  tier: 'decision',
  timeoutMillis: 45_000,
  prompt,
  tool: { name: 'follow_ups', description: 'Report what the user said they would do and has not done yet.' },
  output: FollowUpsOutput,
  // Only the user's own messages can hold their promises.
  accept: (out, input) => out.followUps.every((item) => input.messages.some((m) => m.id === item.messageId && m.fromMe === true)),
  render: (input) =>
    `Topic: ${input.title} (${input.channel})\nNow: ${input.now}\n\nMessages:\n${input.messages
      .map((m) => `(${m.id}) [${m.at}] ${m.sender}${m.fromMe ? ' (me)' : ''}: ${oneLine(m.text)}`)
      .join('\n')}`,
  key: (input) => input.topicId,
})
