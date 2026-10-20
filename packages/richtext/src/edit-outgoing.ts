/** Edits retain original Slack elements wherever their displayed source was not changed. */
import type { RichTextElement, RichTextInline } from '@juno/slack-schema'
import type { MessageContent } from './body'
import type { Lookups } from './model'
import { editMarkup, elementMarkup, inlineMarkup } from './edit-markup'
import { composeOutgoing, type MentionTargets, type OutgoingMessage } from './outgoing'

/** One contiguous text edit, with unchanged prefix and suffix. */
function change(before: string, after: string) {
  let start = 0
  while (start < Math.min(before.length, after.length) && before[start] === after[start]) start++
  let end = before.length
  let newEnd = after.length
  while (end > start && newEnd > start && before[end - 1] === after[newEnd - 1]) { end--; newEnd-- }
  return { start, end, newEnd, delta: after.length - before.length }
}

/** Original spans outside the edit keep their source positions, even when labels repeat. */
function keptRange(start: number, end: number, diff: ReturnType<typeof change>) {
  if (end <= diff.start) return { start, end }
  if (start >= diff.end) return { start: start + diff.delta, end: end + diff.delta }
  return undefined
}

/** Match intact elements inside a wider edit too, in their original order. */
function retainedRange(start: number, end: number, diff: ReturnType<typeof change>, before: string, after: string, cursor: number) {
  const outside = keptRange(start, end, diff)
  if (outside !== undefined) return outside
  const fragment = before.slice(start, end)
  if (fragment === '') return undefined
  const found = after.indexOf(fragment, Math.max(cursor, diff.start))
  return found >= 0 && found + fragment.length <= diff.newEnd ? { start: found, end: found + fragment.length } : undefined
}

function editSection(input: string, original: Extract<RichTextElement, { type: 'rich_text_section' }>, lookups: Lookups, targets: MentionTargets): ReadonlyArray<RichTextElement> {
  const source = inlineMarkup(original.elements, lookups)
  const diff = change(source, input)
  const preserved: Array<{ text: string; element: RichTextInline }> = []
  let prefix = '\uE000'
  while (input.includes(prefix)) prefix += '\uE000'
  let at = 0
  let cursor = 0
  const ranges = original.elements.flatMap((element) => {
    const text = inlineMarkup([element], lookups)
    const range = retainedRange(at, at + text.length, diff, source, input, cursor)
    at += text.length
    if (range === undefined || text === '') return []
    cursor = range.end
    const marker = `${prefix}${preserved.length}\uE001`
    preserved.push({ text: marker, element })
    return [{ ...range, marker }]
  })
  let patched = input
  for (const range of ranges.toReversed()) patched = patched.slice(0, range.start) + range.marker + patched.slice(range.end)
  return composeOutgoing(patched, { ...targets, preserved }).blocks.flatMap((block) => block.elements)
}

/**
 * Parse edited source with its original blocks. Slack structures without a markup
 * spelling (lists, styled spaces, dates, adjacent styles) survive while untouched.
 * Changing such a structure replaces only that structure with the typed markup.
 */
export function composeEdit(input: string, original: MessageContent, lookups: Lookups = {}, targets: MentionTargets = {}): OutgoingMessage {
  const source = editMarkup(original, lookups)
  const fallback = composeOutgoing(input, targets)
  if (input === source && original.blocks !== undefined) return { blocks: original.blocks.filter((block) => block.type === 'rich_text'), text: original.text ?? fallback.text }
  const diff = change(source, input)
  const out: RichTextElement[] = []
  let sourceAt = 0
  let inputAt = 0
  const elements = (original.blocks ?? []).flatMap((block) => block.type === 'rich_text' ? block.elements : [])
  for (const element of elements) {
    const shown = elementMarkup(element, lookups)
    if (shown === undefined) { out.push(element); continue }
    const start = sourceAt
    const end = start + shown.length
    sourceAt = end + 1
    const kept = retainedRange(start, end, diff, source, input, inputAt)
    if (element.type === 'rich_text_section' && diff.start >= start && diff.end <= end) {
      out.push(...editSection(input.slice(start, end + diff.delta), element, lookups, targets))
      inputAt = end + diff.delta
    } else if (kept !== undefined && (element.type === 'rich_text_preformatted' || ((kept.start === 0 || input[kept.start - 1] === '\n') && (kept.end === input.length || input[kept.end] === '\n')))) {
      const preceding = input.slice(inputAt, kept.start).replace(/^\n|\n$/g, '')
      if (preceding !== '') out.push(...composeOutgoing(preceding, targets).blocks.flatMap((block) => block.elements))
      out.push(element)
      inputAt = kept.end
    }
  }
  const rest = input.slice(inputAt).replace(/^\n/, '')
  if (rest !== '') out.push(...composeOutgoing(rest, targets).blocks.flatMap((block) => block.elements))
  return out.length === 0 ? fallback : { blocks: [{ type: 'rich_text', elements: out }], text: fallback.text }
}
