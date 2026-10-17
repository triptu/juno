import type { TopicId } from '@juno/domain'
import { Type } from '../schema'
import { defineStructuredTask } from '../task'
import { classifierInstructions, mainCriterion, prompt, topicCriterion } from './routeCheck.prompt'
import { messagesState, oneLine, renderMessages, type AiMessage } from './shared'

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

/**
 * Decision. Runs while typing pauses in a Main thread (spec section 8), and
 * Enter uses the answer only if it is already stored, so nobody waits on it.
 * Jev 1.13 answers in about 0.5 s (p95 0.9 s, plus about 0.3 s for a cold
 * connection); a chat model in its place takes about 1.5 s. 5 s lets either
 * answer, with room for one retry; an answer that comes after Enter is unused
 * for that send, and Enter never waits for it.
 */
export const routeCheck = defineStructuredTask<RouteCheckInput, typeof RouteCheckOutput>({
  name: 'routeCheck',
  version: 1,
  tier: 'decision',
  timeoutMillis: 5000,
  prompt,
  tool: { name: 'route', description: 'Report which topic the draft replies to, or null for Main.' },
  output: RouteCheckOutput,
  accept: (out, input) => out.replyTo === null || input.topics.some((t) => t.id === out.replyTo),
  classify: {
    ask: (input) => ({
      state: { channel: input.channel, draft: input.draft, topics: input.topics.map((t) => ({ id: t.id, title: t.title, recent: messagesState(t.recent) })) },
      questions: {
        replyTo: {
          type: 'choice',
          instructions: classifierInstructions,
          criteria: { main: mainCriterion, ...Object.fromEntries(input.topics.map((t) => [t.id, topicCriterion(t.title)])) },
        },
      },
    }),
    read: (answers) => {
      const a = answers.replyTo
      return a?.type === 'choice' ? { replyTo: a.choice === 'main' ? null : a.choice, confidence: a.confidence } : undefined
    },
  },
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
