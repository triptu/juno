/** Unchanged paragraphs keep their Slack structure; changed paragraphs use ordinary markup. */
import type { RichTextElement } from '@juno/slack-schema'
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

export function composeEdit(input: string, original: MessageContent, lookups: Lookups = {}, targets: MentionTargets = {}): OutgoingMessage {
  const source = editMarkup(original, lookups)
  const parsed = composeOutgoing(input, targets)
  if (input === source && original.blocks !== undefined) return { blocks: original.blocks.filter((block) => block.type === 'rich_text'), text: original.text ?? parsed.text }
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
  let at = 0
  for (const element of (original.blocks ?? []).flatMap((block) => block.type === 'rich_text' ? block.elements : [])) {
    keep(element, at)
    const shown = elementMarkup(element, lookups)
    if (shown !== undefined) at += shown.length + 1
  }
  parse(input.slice(inputAt).replace(/^\n/, ''))
  return { blocks: out.length === 0 ? parsed.blocks : [{ type: 'rich_text', elements: out }], text: parsed.text }
}
