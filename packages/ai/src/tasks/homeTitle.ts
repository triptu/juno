import { Type } from '../schema'
import { defineStructuredTask } from '../task'
import { prompt } from './homeTitle.prompt'
import { renderMessages, type AiMessage } from './shared'

export interface HomeTitleInput {
  /** The Home item, `<kind>:<topic id>`. */
  readonly itemId: string
  readonly kind: 'waiting' | 'resume' | 'moved'
  readonly title: string
  readonly channel: string
  /** How many messages are new to the user. */
  readonly newCount: number
  /** The latest messages, oldest first. */
  readonly messages: ReadonlyArray<AiMessage>
}

export const HomeTitleOutput = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 120 }),
  confident: Type.Boolean(),
})

/**
 * Generation, as one tool call so it can say it is not sure. Rewrites the
 * title line of a Home item that the rules already found (SPEC section 12);
 * Home shows the plain title until it arrives and when it is not confident.
 * The user is looking at Home, so 8 s is the most worth waiting for.
 */
export const homeTitle = defineStructuredTask<HomeTitleInput, typeof HomeTitleOutput>({
  name: 'homeTitle',
  version: 1,
  tier: 'generation',
  timeoutMillis: 8000,
  prompt,
  tool: { name: 'item_title', description: 'Report the title line for the Home item.' },
  output: HomeTitleOutput,
  render: (input) =>
    `Kind: ${input.kind}\nTopic: ${input.title} (${input.channel})\nNew messages: ${input.newCount}\n\nMessages:\n${renderMessages(input.messages)}`,
  key: (input) => input.itemId,
})
