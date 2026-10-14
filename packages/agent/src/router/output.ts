/**
 * What the owner sees of Juno's text (plan v3 §8). The chat is not a
 * transcript: only text the model marks for the owner becomes a bubble.
 *
 *   <say>One bubble.</say>
 *   <say reply-to="n12">A bubble that answers owner message n12.</say>
 *   <react to="n12">👍</react>
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

export interface OutputBubble {
  readonly text: string
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

/** The closed blocks in `text`, in order. An empty bubble or a reaction that is not one emoji is dropped. */
export function parseOutput(text: string): Output {
  const bubbles: OutputBubble[] = []
  const reactions: OutputReaction[] = []
  for (const match of text.matchAll(BLOCK)) {
    const [, replyTo, say, to, emoji] = match
    if (say !== undefined) {
      const body = say.trim()
      if (body !== '') bubbles.push({ text: body, ...(replyTo ? { replyTo } : {}) })
    } else if (to !== undefined && emoji !== undefined && isEmoji(emoji.trim())) {
      reactions.push({ to, emoji: emoji.trim() })
    }
  }
  return { bubbles, reactions }
}
