import type { TopicId } from '@juno/domain'
import { Type } from '../schema'
import { defineStructuredTask } from '../task'
import { prompt } from './routeCheck.prompt'
import { oneLine, renderMessages, type AiMessage } from './shared'

export interface RouteCheckTopic {
  readonly id: TopicId
  readonly title: string
  /** The last few messages of the topic, oldest first. */
  readonly recent: ReadonlyArray<AiMessage>
}

export interface RouteCheckInput {
  readonly draft: string
  /** The channel whose Main the draft is in. */
  readonly channel: string
  /** The last 3 or 4 topics in that channel. */
  readonly topics: ReadonlyArray<RouteCheckTopic>
}

export const RouteCheckOutput = Type.Object({
  /** The topic id the draft replies to, or null when it belongs in Main. */
  replyTo: Type.Union([Type.String(), Type.Null()]),
  confidence: Type.Number({ minimum: 0, maximum: 1 }),
})

/** Decision. Runs on Enter in a Main thread (spec section 8). */
export const routeCheck = defineStructuredTask<RouteCheckInput, typeof RouteCheckOutput>({
  name: 'routeCheck',
  version: 1,
  tier: 'decision',
  prompt,
  tool: { name: 'route', description: 'Report which topic the draft replies to, or null for Main.' },
  output: RouteCheckOutput,
  accept: (out, input) => out.replyTo === null || input.topics.some((t) => t.id === out.replyTo),
  render: (input) =>
    [
      `Channel: ${input.channel}`,
      `Draft: ${oneLine(input.draft)}`,
      '',
      'Recent topics:',
      ...input.topics.map((t) => `Topic ${t.id}: ${t.title}\n${renderMessages(t.recent)}`),
    ].join('\n'),
  key: (input) => input.topics.map((t) => t.id).join(','),
})
