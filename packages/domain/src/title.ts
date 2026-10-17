/**
 * Titles: manual, then AI, then the first six or so words of the first
 * message. Main rows show the channel label instead.
 *
 * A title is `sensitive` when it is message text nobody checked for a
 * shared screen: the first words of the first message, or an AI title made
 * before titles left out sensitive details. Privacy mode blurs those
 * (SPEC section 5, Privacy mode). Your own rename and the channel are not.
 */
import { bodyFromMrkdwn, previewText, type Lookups } from '@juno/richtext'
import { channelLabel } from './channel'
import type { Topic } from './topic'

export type TitleSource = 'manual' | 'ai' | 'fallback' | 'channel'

export interface ResolvedTitle {
  readonly text: string
  readonly source: TitleSource
  /** Privacy mode blurs it. */
  readonly sensitive: boolean
}

export const FALLBACK_TITLE_WORDS = 6

/**
 * Slack's `text` (mrkdwn) as one plain line: `&amp;`, `&lt;` and `&gt;`
 * decoded, links as their label, mentions as "@Name" (from `lookups`, else
 * the label Slack sent, else "Someone"), formatting marks and quote lines
 * dropped.
 */
export function slackLine(text: string, lookups: Lookups = {}): string {
  return previewText(bodyFromMrkdwn(text, lookups))
}

/** The users Slack's `text` mentions (`<@U…>`), so a caller can load their names before a title or line is made. */
export function mentionedUserIds(text: string | undefined): ReadonlyArray<string> {
  return text === undefined ? [] : [...text.matchAll(/<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g)].map((match) => match[1]!)
}

/** The user groups Slack's `text` mentions (`<!subteam^S…>`), so a caller can load their handles first. */
export function mentionedUsergroupIds(text: string | undefined): ReadonlyArray<string> {
  return text === undefined ? [] : [...text.matchAll(/<!subteam\^([A-Z0-9]+)(?:\|[^>]*)?>/g)].map((match) => match[1]!)
}

/**
 * The first `count` words of a message's Slack text, with an ellipsis when it was cut.
 * A cut that lands on the end of a sentence keeps the sentence and adds no
 * ellipsis ("Draft plan is in the doc", not "doc.…"); a final full stop is
 * dropped, a question or exclamation mark stays. A cut after a comma, colon
 * or dash drops that mark before the ellipsis.
 */
export function firstWords(text: string, count = FALLBACK_TITLE_WORDS, lookups: Lookups = {}): string {
  const words = slackLine(text, lookups)
    .split(' ')
    .filter((w) => w.length > 0)
  if (words.length === 0) return ''
  const head = words.slice(0, count).join(' ')
  if (words.length <= count) return head
  // A single full stop ends the sentence; "..." and "…" are the writer's own trailing off.
  if (/[^.]\.$/.test(head)) return head.slice(0, -1)
  if (/[?!…]$|\.\.$/.test(head)) return head
  const trimmed = head.replace(/[\s,;:\-–—]+$/, '')
  return `${trimmed.length > 0 ? trimmed : head}…`
}

/** The title a topic shows. `lookups` names the people a fallback title mentions. */
export function resolveTitle(topic: Topic, lookups: Lookups = {}): ResolvedTitle {
  if (topic.kind === 'main') return { text: channelLabel(topic.channel), source: 'channel', sensitive: false }
  const manual = topic.overlay.manualTitle?.trim()
  if (manual) return { text: manual, source: 'manual', sensitive: false }
  const ai = topic.overlay.aiTitle?.trim()
  if (ai) return { text: ai, source: 'ai', sensitive: topic.overlay.aiTitleOld === true }
  const fallback = firstWords(topic.firstMessageText ?? '', FALLBACK_TITLE_WORDS, lookups)
  if (fallback) return { text: fallback, source: 'fallback', sensitive: true }
  // A thread whose root has no text (a file, say) falls back to where it lives.
  return { text: channelLabel(topic.channel), source: 'channel', sensitive: false }
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
