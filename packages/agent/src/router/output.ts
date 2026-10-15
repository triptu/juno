/**
 * What the owner sees of Juno's text (plan v3 §8). The chat is not a
 * transcript: only text the model marks for the owner becomes a bubble.
 *
 *   <say>One bubble.</say>
 *   <say reply-to="n12">A bubble that answers owner message n12.</say>
 *   <react to="n12">👍</react>
 *   <say>The review moved to <src m="m3">Thursday at 14:00</src>.</say>
 *
 * Inside a bubble, `<src m="m3">` marks words taken from Slack message `m3`
 * of the run's handle table (plan v3 §19.1, `sources.ts`). The owner reads
 * the words without the tags.
 *
 * Everything outside these blocks (reasoning, notes to itself, an input it
 * chose to ignore) is never shown. If the model marks nothing, nothing
 * shows. A block counts once it is closed, so a bubble appears whole as soon
 * as its closing tag streams in, and a half-written one never shows.
 *
 * Why a block format and not a `say` tool: pi answers every tool call with
 * a tool result and calls the model again, so a tool per bubble costs one
 * more request per turn. Blocks cost nothing and work the same on every
 * provider and on Codex.
 *
 * Parsing is deterministic over the text, so the archive's raw text gives
 * back the same bubbles in the same order.
 */
import { isEmoji } from '@juno/agent-contract'

/** A run of a bubble's text. `source` is the handle it cites (`m3`), as the model wrote it. */
export interface Span {
  readonly text: string
  readonly source?: string
}

export interface OutputBubble {
  /** What the owner reads: the spans' text. */
  readonly text: string
  readonly spans: ReadonlyArray<Span>
  /** The handle of the owner message it replies to (`n12`), as the model wrote it. */
  readonly replyTo?: string
}

export interface OutputReaction {
  /** The handle of the owner message (`n12`). */
  readonly to: string
  readonly emoji: string
}

export interface Output {
  readonly bubbles: ReadonlyArray<OutputBubble>
  readonly reactions: ReadonlyArray<OutputReaction>
}

const BLOCK = /<say(?:\s+reply-to="([^"]*)")?\s*>([\s\S]*?)<\/say>|<react\s+to="([^"]*)"\s*>([\s\S]*?)<\/react>/g

/** `<src m="m3">`, or the shorter `<src m3>` that models also write. */
const SRC = /<src\s+(?:m="([^"]*)"|(m\d+))\s*>([\s\S]*?)<\/src>/g
/** Markup that has no place inside a bubble: a `<src>` left open or closed alone, a nested `<say>` tag, a `<react>`. */
const STRAY = /<react\b[^>]*>[\s\S]*?<\/react>|<\/?(?:src|say|react)\b[^>]*>/g

function spansOf(body: string): ReadonlyArray<Span> {
  const spans: Span[] = []
  const plain = (text: string) => {
    const clean = text.replace(STRAY, '')
    if (clean !== '') spans.push({ text: clean })
  }
  let at = 0
  for (const match of body.matchAll(SRC)) {
    plain(body.slice(at, match.index))
    const words = match[3]!.replace(STRAY, '')
    if (words !== '') spans.push({ text: words, source: (match[1] ?? match[2])! })
    at = match.index + match[0].length
  }
  plain(body.slice(at))
  return spans
}

/** The closed blocks in `text`, in order. An empty bubble or a reaction that is not one emoji is dropped. */
export function parseOutput(text: string): Output {
  const bubbles: OutputBubble[] = []
  const reactions: OutputReaction[] = []
  for (const match of text.matchAll(BLOCK)) {
    const [, replyTo, say, to, emoji] = match
    if (say !== undefined) {
      const spans = spansOf(say.trim())
      const body = spans.map((span) => span.text).join('')
      if (body.trim() !== '') bubbles.push({ text: body, spans, ...(replyTo ? { replyTo } : {}) })
    } else if (to !== undefined && emoji !== undefined && isEmoji(emoji.trim())) {
      reactions.push({ to, emoji: emoji.trim() })
    }
  }
  return { bubbles, reactions }
}
