/** One-shot reads of a topic message selection, used before the Juno panel loads. */
import { MAX_SELECTION_CHARS, type Selection } from '@juno/agent-contract'

export const MESSAGE_ROW = '[data-message-row]'

/** The topic view on screen. Hidden tabs keep their DOM in `<Activity>`, with no layout box. */
export function visibleTopicView(): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>('[data-topic-view]')].find((view) => view.offsetParent !== null)
}

/** The sender of the message `row` shows: its own header, or the header of the group it belongs to. Never a mention in its text. */
export function senderOf(row: Element): string | undefined {
  for (let at: Element | null = row; at !== null; at = at.previousElementSibling) {
    if (!at.matches(MESSAGE_ROW)) continue
    const name = at.querySelector('[data-sender][data-person-name]')?.getAttribute('data-person-name')
    if (name) return name
  }
  return undefined
}

/** A selection's text with its source: the sender and `ts` of the first message in it, and how many messages it spans. */
function selectionOf(text: string, rows: readonly [HTMLElement, ...HTMLElement[]]): Selection {
  const first = rows[0]
  const sender = senderOf(first)
  const ts = first.dataset['messageRow']
  return {
    text: text.slice(0, MAX_SELECTION_CHARS),
    ...(sender === undefined ? {} : { sender }),
    ...(ts === undefined || ts === '' ? {} : { ts }),
    ...(rows.length > 1 ? { messages: rows.length } : {}),
  }
}

/** The whole of one message in the visible topic, with its sender, as a quote: Tell Juno in the why popover (SPEC 14). */
export function messageQuote(ts: string): Selection | undefined {
  const row = visibleTopicView()?.querySelector<HTMLElement>(`${MESSAGE_ROW}[data-message-row="${CSS.escape(ts)}"]`)
  const text = row?.querySelector('[data-msg-text]')?.textContent?.trim()
  if (row === null || row === undefined || text === undefined || text === '') return undefined
  return selectionOf(text, [row])
}

export const rowOf = (node: Node): HTMLElement | null => (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>(MESSAGE_ROW) ?? null

/**
 * The messages a selection takes text from, in order: the rows from the one
 * it starts in to the one it ends in whose text it touches. A triple click
 * ends at the start of the next row, which it does not touch.
 */
export function rowsIn(range: Range, view: HTMLElement, first: HTMLElement): readonly [HTMLElement, ...HTMLElement[]] {
  const last = rowOf(range.endContainer)
  if (last === null || last === first || !view.contains(last)) return [first]
  const all = [...view.querySelectorAll<HTMLElement>(MESSAGE_ROW)]
  const touched = all.slice(all.indexOf(first), all.indexOf(last) + 1).filter((row) => range.intersectsNode(row.querySelector('[data-msg-text]') ?? row))
  const [head, ...rest] = touched
  return head === undefined ? [first] : [head, ...rest]
}

const BLOCKS = new Set(['P', 'DIV', 'LI', 'PRE', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TR', 'UL', 'OL', 'TABLE'])

/** Message text covered by `range`, with block and message breaks but no chrome. */
export function selectedText(range: Range, max: number): string {
  const root = range.commonAncestorContainer
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  const start = range.startContainer
  walker.currentNode = start instanceof CharacterData ? start : (start.childNodes[range.startOffset] ?? start)
  let text = ''
  let body: Element | null = null
  let block: Element | null = null
  for (let node: Node | null = walker.currentNode; node !== null && text.length < max; node = walker.nextNode()) {
    if (node !== root && range.comparePoint(node, 0) > 0) break
    if (node instanceof HTMLBRElement) {
      if (body !== null && node.closest('[data-msg-text]') === body) text += '\n'
      continue
    }
    if (!(node instanceof Text) || !range.intersectsNode(node)) continue
    const inBody = node.parentElement?.closest('[data-msg-text]') ?? null
    if (inBody === null) continue
    let nodeBlock: Element | null = node.parentElement
    while (nodeBlock !== null && nodeBlock !== inBody && !BLOCKS.has(nodeBlock.tagName)) nodeBlock = nodeBlock.parentElement
    if (body !== null && inBody !== body) text += '\n\n'
    else if (block !== null && nodeBlock !== block) text += '\n'
    body = inBody
    block = nodeBlock
    const from = node === range.startContainer ? range.startOffset : 0
    const to = node === range.endContainer ? range.endOffset : node.data.length
    text += node.data.slice(from, to)
  }
  return text.slice(0, max).trim()
}

/** The owner's text selection in the visible topic's messages, if there is one, with all its text. */
export function topicSelection(): Selection | undefined {
  const current = document.getSelection()
  if (current === null || current.isCollapsed || current.rangeCount === 0) return undefined
  const range = current.getRangeAt(0)
  const first = rowOf(range.startContainer)
  const view = visibleTopicView()
  if (first === null || view === undefined || first.closest('[data-topic-view]') !== view) return undefined
  const text = selectedText(range, MAX_SELECTION_CHARS)
  if (text === '') return undefined
  return selectionOf(text, rowsIn(range, view, first))
}

/** Clears the highlight once Ask Juno has taken it, as Quote does. */
export function clearTopicSelection(): void {
  document.getSelection()?.removeAllRanges()
}
