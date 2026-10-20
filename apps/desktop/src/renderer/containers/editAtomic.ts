import type { BodyBlock, BodyInline, MessageBody } from '@juno/contract'

/** Atomic labels already present in the message, as the edit field displays them. */
export function editAtomic(text: string, body: MessageBody | undefined) {
  const labels = new Set<string>()
  const inline = (elements: ReadonlyArray<BodyInline>) => {
    for (const element of elements) {
      if (element.kind === 'link') labels.add(element.text)
      else if (element.kind === 'user') labels.add(`@${element.name}`)
      else if (element.kind === 'channel') labels.add(`#${element.name}`)
      else if (element.kind === 'usergroup') labels.add(`@${element.handle}`)
      else if (element.kind === 'broadcast') labels.add(`@${element.range}`)
    }
  }
  const walk = (blocks: ReadonlyArray<BodyBlock>): void => {
    for (const block of blocks) {
      if ('children' in block) inline(block.children)
      else if ('items' in block) block.items.forEach(inline)
      else if (block.kind === 'attachment') { inline(block.title); walk(block.blocks); inline(block.footer) }
    }
  }
  walk(body?.blocks ?? [])
  const ranges: Array<{ start: number; end: number }> = []
  for (const label of labels) {
    if (label === '') continue
    for (let at = text.indexOf(label); at >= 0; at = text.indexOf(label, at + label.length)) {
      if (!/[\p{L}\p{N}]/u.test(text[at - 1] ?? '') && !/[\p{L}\p{N}]/u.test(text[at + label.length] ?? '')) ranges.push({ start: at, end: at + label.length })
    }
  }
  return ranges.sort((a, b) => a.start - b.start || b.end - a.end)
}
