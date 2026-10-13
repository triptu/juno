import type { ConversationKind } from '@juno/domain'
import { Type } from '../schema'
import { defineStructuredTask } from '../task'
import { messagesState, oneLine, renderMessages, type AiMessage } from './shared'
import { chatterCriteria, classifierInstructions, prompt, urgentCriteria } from './urgencyGate.prompt'

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

/**
 * Decision. Runs per candidate after the user's rules did not match (spec
 * section 14). A notification may arrive 2 s late; past that it goes to the
 * digest. Covers the classifier's 0.9 s p95 with room for one retry.
 */
export const urgencyGate = defineStructuredTask<UrgencyGateInput, typeof UrgencyGateOutput>({
  name: 'urgencyGate',
  version: 1,
  tier: 'decision',
  timeoutMillis: 2000,
  prompt,
  tool: { name: 'gate', description: 'Report how urgent the message is and how much it is chatter.' },
  output: UrgencyGateOutput,
  classify: {
    ask: (input) => ({
      state: {
        where: input.channel,
        kind: input.channelKind,
        now: input.now,
        before: messagesState(input.before ?? []),
        message: { sender: input.sender, mentionsMe: input.mentionsMe, text: input.text },
      },
      questions: {
        urgent: { type: 'bool', instructions: classifierInstructions, criteria: urgentCriteria },
        chatter: { type: 'bool', instructions: 'Is this message chatter: social or low-value content?', criteria: chatterCriteria },
      },
    }),
    read: (answers) => {
      const u = answers.urgent
      const c = answers.chatter
      return u?.type === 'bool' && c?.type === 'bool' ? { urgent: u.probability, chatter: c.probability } : undefined
    },
  },
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
