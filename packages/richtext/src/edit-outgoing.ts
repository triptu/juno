/**
 * Unchanged paragraphs keep their Slack structure; changed paragraphs use
 * ordinary markup. Blocks the field does not show (a table, a bot's layout
 * blocks) go back as they were, in their place among the edited ones.
 */
import type { Block, RichTextElement } from '@juno/slack-schema'
import type { MessageContent } from './body'
import type { Lookups } from './model'
import { editMarkup, elementMarkup } from './edit-markup'
import { markupPieces } from './markup'
import { composeOutgoing, type MentionTargets, type OutgoingMessage } from './outgoing'

function change(before: string, after: string) {
  let start = 0
  while (start < Math.min(before.length, after.length) && before[start] === after[start]) start++
  let end = before.length
  let newEnd = after.length
  while (end > start && newEnd > start && before[end - 1] === after[newEnd - 1]) { end--; newEnd-- }
  return { start, end, newEnd, delta: after.length - before.length }
}

/** Prefix and suffix keep their positions; whole blocks between edits match in their original order. */
function unchangedRange(start: number, shown: string, input: string, diff: ReturnType<typeof change>, cursor: number) {
  let at: number
  if (start + shown.length <= diff.start) at = start
  else if (start >= diff.end) at = start + diff.delta
  else {
    if (shown === '') return undefined
    at = input.indexOf(shown, Math.max(cursor, diff.start))
    while (at >= 0 && ((at > 0 && input[at - 1] !== '\n') || (at + shown.length < input.length && input[at + shown.length] !== '\n'))) at = input.indexOf(shown, at + 1)
    if (at < 0 || at + shown.length > diff.newEnd) return undefined
  }
  const end = at + shown.length
  if ((at > 0 && input[at - 1] !== '\n') || (end < input.length && input[end] !== '\n')) return undefined
  return { start: at, end }
}

/** An edit as it goes to Slack: `blocks` may hold the original's blocks the field did not show. */
export interface EditedMessage {
  readonly blocks: ReadonlyArray<Block>
  readonly text: string
}

/**
 * Where a place in the field's first text (`source`) is in what was typed:
 * the same place before the change, moved by the change after it, and inside
 * it after as many line breaks as before it.
 */
function placeInInput(at: number, source: string, input: string, diff: ReturnType<typeof change>): number {
  if (at <= diff.start) return at
  if (at >= diff.end) return at + diff.delta
  let breaks = source.slice(diff.start, at).split('\n').length - 1
  let place = diff.start
  while (breaks > 0 && place < diff.newEnd) if (input[place++] === '\n') breaks--
  return place
}

export function composeEdit(input: string, original: MessageContent, lookups: Lookups = {}, targets: MentionTargets = {}): EditedMessage {
  const source = editMarkup(original, lookups)
  const parsed: OutgoingMessage = composeOutgoing(input, targets)
  if (input === source && original.blocks !== undefined) return { blocks: original.blocks, text: original.text ?? parsed.text }
  const diff = change(source, input)
  const code = markupPieces(input).filter((piece) => piece.kind === 'code' && piece.start + 3 > diff.start && piece.start < diff.newEnd)
  const out: RichTextElement[] = []
  let inputAt = 0
  const parse = (text: string) => out.push(...composeOutgoing(text, targets).blocks.flatMap((block) => block.elements))
  const keep = (element: RichTextElement, start: number): void => {
    const shown = elementMarkup(element, lookups)
    if (shown === undefined) { out.push(element); return }
    const range = unchangedRange(start, shown, input, diff, inputAt)
    if (range !== undefined && range.start >= inputAt && !code.some((piece) => piece.start < range.start && piece.end > range.start)) {
      parse(input.slice(inputAt, range.start).replace(/^\n|\n$/g, ''))
      out.push(element)
      inputAt = range.end
    } else if (element.type === 'rich_text_list' && element.elements.length > 1) {
      let at = start
      for (const [index, item] of element.elements.entries()) {
        const offset = element.style === 'ordered' ? { offset: (element.offset ?? 0) + index } : {}
        keep({ ...element, ...offset, elements: [item] }, at)
        at += (elementMarkup(item, lookups)?.length ?? 0) + 1
      }
    }
  }
  const blocks: Block[] = []
  const flush = () => { if (out.length > 0) blocks.push({ type: 'rich_text', elements: out.splice(0) }) }
  let at = 0
  for (const block of original.blocks ?? []) {
    if (block.type !== 'rich_text') {
      // Not in the field: the words typed before its place go before it, then it goes back unchanged.
      const place = placeInInput(at, source, input, diff)
      if (place > inputAt) {
        parse(input.slice(inputAt, place).replace(/^\n|\n$/g, ''))
        inputAt = place
      }
      flush()
      blocks.push(block)
      continue
    }
    for (const element of block.elements) {
      keep(element, at)
      const shown = elementMarkup(element, lookups)
      if (shown !== undefined) at += shown.length + 1
    }
  }
  parse(input.slice(inputAt).replace(/^\n/, ''))
  flush()
  return { blocks: blocks.length === 0 ? parsed.blocks : blocks, text: parsed.text }
}
