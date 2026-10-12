/**
 * Titles: manual, then AI, then the first six or so words of the first
 * message. Main rows show the channel label instead.
 */
import { channelLabel } from './channel'
import type { Topic } from './topic'

export type TitleSource = 'manual' | 'ai' | 'fallback' | 'channel'

export interface ResolvedTitle {
  readonly text: string
  readonly source: TitleSource
}

export const FALLBACK_TITLE_WORDS = 6

/** The first `count` words of a message, with an ellipsis when it was cut. */
export function firstWords(text: string, count = FALLBACK_TITLE_WORDS): string {
  const words = text
    .split('\n')
    .filter((line) => !/^\s*>/.test(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((w) => w.length > 0)
  if (words.length === 0) return ''
  const head = words.slice(0, count).join(' ')
  return words.length > count ? `${head}…` : head
}

export function resolveTitle(topic: Topic): ResolvedTitle {
  if (topic.kind === 'main') return { text: channelLabel(topic.channel), source: 'channel' }
  const manual = topic.overlay.manualTitle?.trim()
  if (manual) return { text: manual, source: 'manual' }
  const ai = topic.overlay.aiTitle?.trim()
  if (ai) return { text: ai, source: 'ai' }
  const fallback = firstWords(topic.firstMessageText ?? '')
  if (fallback) return { text: fallback, source: 'fallback' }
  // A thread whose root has no text (a file, say) falls back to where it lives.
  return { text: channelLabel(topic.channel), source: 'channel' }
}

/** A sparkle shows beside AI titles while no manual title exists and AI assist is on. */
export function showsAiSparkle(topic: Topic, aiAssist: boolean): boolean {
  return aiAssist && resolveTitle(topic).source === 'ai'
}

/**
 * The manual title to store after a rename. Empty input, or the same text
 * as the AI title, clears the manual title so the AI title shows again.
 */
export function manualTitleAfterRename(input: string, aiTitle: string | undefined): string | undefined {
  const text = input.replace(/\s+/g, ' ').trim()
  if (text.length === 0) return undefined
  if (aiTitle !== undefined && text === aiTitle.trim()) return undefined
  return text
}

/** "Use AI title" is offered when a manual title hides an AI title and AI assist is on. */
export function canUseAiTitle(topic: Topic, aiAssist: boolean): boolean {
  return aiAssist && topic.kind !== 'main' && Boolean(topic.overlay.manualTitle?.trim()) && Boolean(topic.overlay.aiTitle?.trim())
}
