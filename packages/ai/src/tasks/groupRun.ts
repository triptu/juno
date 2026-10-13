import type { ChannelId } from '@juno/domain'
import { Type } from '../schema'
import { defineStructuredTask } from '../task'
import { prompt } from './groupRun.prompt'
import { oneLine, type AiMessage } from './shared'

export interface GroupRunMessage extends AiMessage {
  /** The Slack ts, so the client can point at the exact messages. */
  readonly ts: string
}

export interface GroupRunInput {
  readonly channelId: ChannelId
  readonly channel: string
  /** The recent Main window, oldest first, about 12 messages. */
  readonly messages: ReadonlyArray<GroupRunMessage>
}

export const GroupRunOutput = Type.Object({
  group: Type.Union([
    Type.Object({
      messageTs: Type.Array(Type.String(), { minItems: 3 }),
      title: Type.String({ minLength: 1, maxLength: 60 }),
    }),
    Type.Null(),
  ]),
  confidence: Type.Number({ minimum: 0, maximum: 1 }),
})

/**
 * Decision. Runs in the background on each new Main message (spec section 15),
 * once the window has 3 or more. No classifier fits (it names messages and
 * writes a title), so a chat model answers: GPT-6 Luna p50 1.8 s, p95 2.9 s.
 */
export const groupRun = defineStructuredTask<GroupRunInput, typeof GroupRunOutput>({
  name: 'groupRun',
  version: 1,
  tier: 'decision',
  timeoutMillis: 5000,
  prompt,
  tool: { name: 'group', description: 'Report the run of messages that form one conversation, or null.' },
  output: GroupRunOutput,
  accept: (out, input) => {
    if (out.group === null) return true
    const known = new Set(input.messages.map((m) => m.ts))
    return new Set(out.group.messageTs).size === out.group.messageTs.length && out.group.messageTs.every((ts) => known.has(ts))
  },
  render: (input) =>
    `Channel: ${input.channel}\n\nMain messages:\n${input.messages.map((m) => `[ts ${m.ts}] [${m.at}] ${m.sender}: ${oneLine(m.text)}`).join('\n')}`,
  key: (input) => input.channelId,
})
