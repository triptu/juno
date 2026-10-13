import type { ConversationKind } from '@juno/domain'
import { Type } from '../schema'
import { defineStructuredTask } from '../task'
import { oneLine, renderMessages, type AiMessage } from './shared'
import { prompt } from './urgencyGate.prompt'

export interface UrgencyGateInput {
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

/** Mirrors `UrgencyScore` in @juno/domain, which the notification decision consumes. */
export const UrgencyGateOutput = Type.Object({
  urgent: Type.Number({ minimum: 0, maximum: 1 }),
  chatter: Type.Number({ minimum: 0, maximum: 1 }),
})

/** Decision. Runs per candidate after the user's rules did not match (spec section 14). */
export const urgencyGate = defineStructuredTask<UrgencyGateInput, typeof UrgencyGateOutput>({
  name: 'urgencyGate',
  version: 1,
  tier: 'decision',
  prompt,
  tool: { name: 'gate', description: 'Report how urgent the message is and how much it is chatter.' },
  output: UrgencyGateOutput,
  render: (input) =>
    [
      `Where: ${input.channel} (${input.channelKind})`,
      `Now: ${input.now}`,
      input.before && input.before.length > 0 ? `Before:\n${renderMessages(input.before)}\n` : '',
      `Message from ${input.sender}${input.mentionsMe ? ', mentioning me' : ''}: ${oneLine(input.text)}`,
    ]
      .filter((line) => line !== '')
      .join('\n'),
  key: (input) => input.messageTs,
})
