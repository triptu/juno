import type { TopicId } from '@juno/domain'
import { parseRecipe, serialiseRecipe } from '@juno/topic-art'
import { defineTextTask } from '../task'
import { prompt, retryPrompt, topicBlock } from './topicArt.prompt'

/** What the previous drawing was, so a redraw can be asked to differ. */
export interface TopicArtAvoid {
  readonly hue: string
  /** One line: the object the last drawing showed, or the title it was drawn from. */
  readonly summary: string
}

/** A thread: its title, where it lives, and its first and latest messages. */
export interface ThreadArtInput {
  readonly kind: 'thread'
  readonly topicId: TopicId
  readonly title: string
  /** "#eng", "Maya Chen". */
  readonly channel: string
  readonly first: string
  readonly last: string
  readonly avoid?: TopicArtAvoid
}

/** A channel's Main: what the channel is for and what it has been about lately. */
export interface MainArtInput {
  readonly kind: 'main'
  readonly topicId: TopicId
  /** "#eng". */
  readonly channel: string
  readonly purpose?: string
  readonly topic?: string
  /** The latest top-level messages, newest last. A few are enough. */
  readonly recent: ReadonlyArray<string>
  readonly avoid?: TopicArtAvoid
}

export type TopicArtInput = ThreadArtInput | MainArtInput

/**
 * Art: a recipe in the topic art vocabulary (`@juno/topic-art`). The output
 * is the canonical recipe text, rebuilt from the checked drawing; the reply's
 * own bytes are discarded. `data-confident="false"` in it means the model had
 * nothing to draw and the app keeps its placeholder. Runs in the background
 * when a topic is first seen; one retry with the checker's reason.
 */
export const topicArt = defineTextTask<TopicArtInput>({
  name: 'topicArt',
  version: 1,
  tier: 'art',
  maxChars: 4000,
  prompt,
  render: (input) => `Draw the icon for this topic.\n\n${topicBlock(input)}`,
  key: (input) => input.topicId,
  check: (text) => {
    const parsed = parseRecipe(text)
    return parsed.ok ? { ok: true, value: serialiseRecipe(parsed.recipe) } : { ok: false, message: parsed.reason }
  },
  retry: retryPrompt,
})
