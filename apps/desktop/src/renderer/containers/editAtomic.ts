import type { BodyBlock, BodyInline, LinkRange, MessageBody } from '@juno/contract'

function bodyInlines(body: MessageBody | undefined, take: (elements: ReadonlyArray<BodyInline>) => void): void {
  const walk = (blocks: ReadonlyArray<BodyBlock>): void => {
    for (const block of blocks) {
      if ('children' in block) take(block.children)
      else if ('items' in block) block.items.forEach(take)
      else if (block.kind === 'attachment') { take(block.title); walk(block.blocks); take(block.footer) }
    }
  }
  walk(body?.blocks ?? [])
}

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
  bodyInlines(body, inline)
  const ranges: Array<{ start: number; end: number }> = []
  for (const label of labels) {
    if (label === '') continue
    for (let at = text.indexOf(label); at >= 0; at = text.indexOf(label, at + label.length)) {
      if (!/[\p{L}\p{N}]/u.test(text[at - 1] ?? '') && !/[\p{L}\p{N}]/u.test(text[at + label.length] ?? '')) ranges.push({ start: at, end: at + label.length })
    }
  }
  return ranges.toSorted((a, b) => a.start - b.start || b.end - a.end)
}

/** Linked labels already present in the message, at their places in the edit field. */
export function editLinks(text: string, body: MessageBody | undefined): ReadonlyArray<LinkRange> {
  const targets: Array<{ readonly text: string; readonly url: string }> = []
  bodyInlines(body, (elements) => {
    for (const element of elements) if (element.kind === 'link' && element.text !== '') targets.push({ text: element.text, url: element.url })
  })
  const ranges: LinkRange[] = []
  for (const target of targets) {
    for (let at = text.indexOf(target.text); at >= 0; at = text.indexOf(target.text, at + target.text.length)) {
      const end = at + target.text.length
      if (ranges.some((range) => at < range.end && end > range.start)) continue
      if (!/[\p{L}\p{N}]/u.test(text[at - 1] ?? '') && !/[\p{L}\p{N}]/u.test(text[end] ?? '')) ranges.push({ start: at, end, url: target.url })
    }
  }
  return ranges.toSorted((left, right) => left.start - right.start || right.end - left.end)
}
