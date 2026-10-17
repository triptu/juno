import { Type } from '../schema'
import { defineStructuredTask } from '../task'
import { automatedCriteria, classifierInstructions, prompt } from './automatedChannel.prompt'
import { oneLine, type AiMessage } from './shared'

/** A message as this task reads it: who sent it, and whether an app did. */
export interface SampleMessage extends AiMessage {
  readonly fromApp?: boolean
}

export interface AutomatedChannelInput {
  /** The conversation's id: the cache key, so the answer is kept once per conversation. */
  readonly channelId: string
  /** "#ci-builds". */
  readonly channel: string
  readonly topic?: string
  /** The latest messages, oldest first, at most 20. */
  readonly messages: ReadonlyArray<SampleMessage>
}

export const AutomatedChannelOutput = Type.Object({
  probability: Type.Number({ minimum: 0, maximum: 1 }),
  /** One short clause from a chat model, shown on Home's question. A decision model gives none. */
  reason: Type.Optional(Type.String({ maxLength: 120 })),
})

const render = (input: AutomatedChannelInput): string => {
  const lines = input.messages.map((m) => `[${m.at}] ${m.sender}${m.fromApp === true ? ' (app)' : ''}${m.fromMe === true ? ' (me)' : ''}: ${oneLine(m.text)}`)
  return `Conversation: ${input.channel}${input.topic === undefined || input.topic === '' ? '' : `\nTopic: ${input.topic}`}\n\nMessages:\n${lines.length === 0 ? '(no messages)' : lines.join('\n')}`
}

/**
 * Decision. Runs only for a conversation the rules could not place
 * (`classifyConversation` said ambiguous), once per conversation: the answer
 * is kept in `ai_cache` and never asked again. Nobody waits on it.
 */
export const automatedChannel = defineStructuredTask<AutomatedChannelInput, typeof AutomatedChannelOutput>({
  name: 'automatedChannel',
  version: 2,
  tier: 'decision',
  timeoutMillis: 30_000,
  prompt,
  tool: { name: 'score_automated', description: 'Report how likely the conversation is automated.' },
  output: AutomatedChannelOutput,
  classify: {
    ask: (input) => ({
      state: {
        channel: input.channel,
        ...(input.topic === undefined ? {} : { topic: input.topic }),
        messages: input.messages.map((m) => ({ at: m.at, sender: m.sender, fromApp: m.fromApp ?? false, fromMe: m.fromMe ?? false, text: m.text })),
      },
      questions: { automated: { type: 'bool', instructions: classifierInstructions, criteria: automatedCriteria } },
    }),
    read: (answers) => {
      const a = answers.automated
      return a?.type === 'bool' ? { probability: a.probability } : undefined
    },
  },
  render,
  key: (input) => input.channelId,
})
