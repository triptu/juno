import type { ChannelId, ConversationKind, TopicId, UserId } from '@juno/domain'
import { Type } from '../schema'
import { defineStructuredTask } from '../task'
import { prompt } from './parseCommand.prompt'

export interface ParseCommandInput {
  readonly text: string
  readonly people: ReadonlyArray<{ readonly id: UserId; readonly name: string }>
  readonly channels: ReadonlyArray<{ readonly id: ChannelId; readonly name: string; readonly kind: ConversationKind }>
  /** Topics that can be resolved. */
  readonly topics: ReadonlyArray<{ readonly id: TopicId; readonly title: string; readonly channel: string }>
}

const confidence = Type.Number({ minimum: 0, maximum: 1 })

export const ParseCommandOutput = Type.Object({
  command: Type.Union([
    Type.Object({ kind: Type.Literal('send_dm'), userId: Type.String(), text: Type.String({ minLength: 1 }) }),
    Type.Object({ kind: Type.Literal('open_dm'), userId: Type.String() }),
    Type.Object({ kind: Type.Literal('post'), channelId: Type.String(), text: Type.String({ minLength: 1 }) }),
    Type.Object({ kind: Type.Literal('ask'), prompt: Type.String({ minLength: 1 }) }),
    Type.Object({ kind: Type.Literal('resolve'), topicId: Type.String() }),
    Type.Null(),
  ]),
  confidence,
})

/**
 * Decision. The model fallback after `parseCommand` in @juno/domain found
 * nothing (spec section 10). The palette shows search results meanwhile. It
 * extracts text, so a chat model answers: GPT-6 Luna p50 1.5 s, p95 2.3 s,
 * with the odd call near 3 s; 4 s keeps those without waiting for a retry.
 */
export const parseCommand = defineStructuredTask<ParseCommandInput, typeof ParseCommandOutput>({
  name: 'parseCommand',
  version: 1,
  tier: 'decision',
  timeoutMillis: 4000,
  prompt,
  tool: { name: 'command', description: 'Report the command the text means, or null when it is a search.' },
  output: ParseCommandOutput,
  accept: (out, input) => {
    const c = out.command
    if (c === null) return true
    switch (c.kind) {
      case 'send_dm':
      case 'open_dm':
        return input.people.some((p) => p.id === c.userId)
      case 'post':
        return input.channels.some((ch) => ch.id === c.channelId && (ch.kind === 'public' || ch.kind === 'private'))
      case 'resolve':
        return input.topics.some((t) => t.id === c.topicId)
      case 'ask':
        return true
    }
  },
  render: (input) =>
    [
      `Typed: ${input.text}`,
      '',
      `People: ${input.people.map((p) => `${p.name} (${p.id})`).join(', ') || 'none'}`,
      `Channels: ${input.channels.map((c) => `#${c.name} (${c.id}, ${c.kind})`).join(', ') || 'none'}`,
      `Topics: ${input.topics.map((t) => `"${t.title}" in ${t.channel} (${t.id})`).join('; ') || 'none'}`,
    ].join('\n'),
  key: () => '',
})
