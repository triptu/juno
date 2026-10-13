import type { TopicId } from '@juno/domain'
import { Type } from '../schema'
import { defineStructuredTask } from '../task'
import { prompt } from './forYou.prompt'
import { renderMessages, type AiMessage } from './shared'

export interface ForYouTopic {
  readonly id: TopicId
  readonly title: string
  readonly channel: string
  readonly unread: number
  /** The last messages, oldest first. */
  readonly messages: ReadonlyArray<AiMessage>
}

export interface ForYouInput {
  /** The reader's display name, so "me" in messages has a name. */
  readonly me: string
  readonly now: string
  /** The topics with recent activity, most recent first, about 10 to 20. */
  readonly topics: ReadonlyArray<ForYouTopic>
}

export const ForYouCardType = Type.Union([
  Type.Literal('coding_agent'),
  Type.Literal('waiting_on_you'),
  Type.Literal('reply_ideas'),
  Type.Literal('follow_up'),
  Type.Literal('tidy_up'),
])

export const ForYouOutput = Type.Object({
  cards: Type.Array(
    Type.Object({
      type: ForYouCardType,
      topicId: Type.String(),
      title: Type.String({ minLength: 1, maxLength: 80 }),
      body: Type.String({ minLength: 1, maxLength: 600 }),
      /** Reply directions, a few words each. Only for waiting_on_you and reply_ideas. */
      options: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 60 }), { maxItems: 3 })),
    }),
    { maxItems: 5 },
  ),
})

/** Structured output on the generation tier: cards need judgment, and run in the background every 15 minutes. */
export const forYou = defineStructuredTask<ForYouInput, typeof ForYouOutput>({
  name: 'forYou',
  version: 1,
  tier: 'generation',
  prompt,
  tool: { name: 'cards', description: 'Report the For you cards, most useful first. An empty list is allowed.' },
  output: ForYouOutput,
  accept: (out, input) => {
    const known = new Set<string>(input.topics.map((t) => t.id))
    return out.cards.every((card) => known.has(card.topicId))
  },
  render: (input) =>
    [
      `Reader: ${input.me}`,
      `Now: ${input.now}`,
      '',
      ...input.topics.map((t) => `Topic ${t.id}: ${t.title} (${t.channel}, ${t.unread} unread)\n${renderMessages(t.messages)}`),
    ].join('\n'),
  key: (input) => input.me,
})
