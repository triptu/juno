/**
 * What the Juno panel reads from the topic beside it (SPEC 7): the owner's
 * text selection in the topic's messages, and the messages on screen. Both
 * are read from the DOM of the visible topic, the selection as it changes
 * and the range only when a message is sent, so the topic's list does no
 * extra work on scroll.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { MAX_SELECTION_CHARS, type Selection } from '@juno/agent-contract'
import { junoQuoteAtom, registry } from '@juno/state'
import { useAtomValue } from '@juno/state/react'

const ROW = '[data-message-row]'

/** The topic view on screen. Hidden tabs keep their DOM in `<Activity>`, with no layout box. */
function visibleTopicView(): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>('[data-topic-view]')].find((view) => view.offsetParent !== null)
}

/** The sender of the message `row` shows: its own header, or the header of the group it belongs to. Never a mention in its text. */
function senderOf(row: Element): string | undefined {
  for (let at: Element | null = row; at !== null; at = at.previousElementSibling) {
    if (!at.matches(ROW)) continue
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

const rowOf = (node: Node): HTMLElement | null => (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>(ROW) ?? null

/** Whether the topic view holding `row` is on screen. A layout read, so it is asked once per row a selection starts in. */
const shown = (row: HTMLElement): boolean => (row.closest<HTMLElement>('[data-topic-view]')?.offsetParent ?? null) !== null

/** How many characters of a selection the chip keeps: enough for its snippet and its 400-character tooltip. */
const CHIP_CHARS = 420

/**
 * The messages a selection takes text from, in order: the rows from the one
 * it starts in to the one it ends in whose text it touches. A triple click
 * ends at the start of the next row, which it does not touch.
 */
function rowsIn(range: Range, view: HTMLElement, first: HTMLElement): readonly [HTMLElement, ...HTMLElement[]] {
  const last = rowOf(range.endContainer)
  if (last === null || last === first || !view.contains(last)) return [first]
  const all = [...view.querySelectorAll<HTMLElement>(ROW)]
  const touched = all.slice(all.indexOf(first), all.indexOf(last) + 1).filter((row) => range.intersectsNode(row.querySelector('[data-msg-text]') ?? row))
  const [head, ...rest] = touched
  return head === undefined ? [first] : [head, ...rest]
}

/**
 * How many messages `rowsIn` would answer with, without testing each row:
 * every row between the first and the last is inside the selection, so
 * only the last can be left out (a triple click ends at its start).
 */
function rowsSpanned(range: Range, first: HTMLElement, last: HTMLElement | null): number {
  if (last === null || last === first || first.parentElement === null || last.parentElement !== first.parentElement) {
    const view = first.closest<HTMLElement>('[data-topic-view]')
    return view === null ? 1 : rowsIn(range, view, first).length
  }
  const rows = [...first.parentElement.querySelectorAll<HTMLElement>(`:scope > ${ROW}`)]
  const between = rows.indexOf(last) - rows.indexOf(first)
  return between <= 0 ? 1 : between + (range.intersectsNode(last.querySelector('[data-msg-text]') ?? last) ? 1 : 0)
}

const BLOCKS = new Set(['P', 'DIV', 'LI', 'PRE', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TR', 'UL', 'OL', 'TABLE'])

/**
 * The text of the messages a selection covers, up to `max` characters,
 * read from the DOM with no layout: only message text (`[data-msg-text]`),
 * a line break between blocks inside a message, and a blank line between
 * messages. It walks from the selection's start and stops at `max`, so
 * the chip's summary costs the same whatever the selection's length.
 */
function selectedText(range: Range, max: number): string {
  const root = range.commonAncestorContainer
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  const start = range.startContainer
  walker.currentNode = start instanceof CharacterData ? start : (start.childNodes[range.startOffset] ?? start)
  let text = ''
  let body: Element | null = null
  let block: Element | null = null
  for (let node: Node | null = walker.currentNode; node !== null && text.length < max; node = walker.nextNode()) {
    // Past the end of the selection.
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

/** The owner's text selection in the visible topic's messages, if there is one, with all its text: what Ask Juno takes. */
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

const sameSelection = (a: Selection, b: Selection) => a.text === b.text && a.sender === b.sender && a.ts === b.ts && a.messages === b.messages

/**
 * The selection as a range, from its anchor and focus. `getRangeAt` makes
 * the selection canonical first, which lays out the page; the anchor and
 * focus are what the selection holds, with no layout.
 */
function selectedRange(): Range | undefined {
  const current = document.getSelection()
  const { anchorNode, focusNode } = current ?? {}
  if (current === null || current.isCollapsed || anchorNode == null || focusNode == null) return undefined
  const range = document.createRange()
  range.setStart(anchorNode, current.anchorOffset)
  // Before the anchor when the drag went up: setEnd collapses the range there, so the anchor is set again as the end.
  range.setEnd(focusNode, current.focusOffset)
  if (range.collapsed) {
    range.setStart(focusNode, current.focusOffset)
    range.setEnd(anchorNode, current.anchorOffset)
  }
  return range
}

/**
 * Follows the document's selection for the chip, at most once a frame.
 * Each read is cheap: nothing when the selection's ends have not moved,
 * the sender and whether the topic is on screen once per row the
 * selection starts in, the messages it spans once per row it ends in, and
 * the first `CHIP_CHARS` characters of its text, read again only while it
 * has fewer, or when the selection's start moved or its end came back.
 * The selection's range is kept, so its whole text is read once, when the
 * message is sent.
 */
function selectionFollower(onSelection: (selection: Selection, range: Range) => void): () => void {
  let frame: number | undefined
  let ends: readonly [Node, number, Node, number] | undefined
  let start: { readonly row: HTMLElement; readonly shown: boolean; readonly sender: string | undefined } | undefined
  let span: { readonly first: HTMLElement; readonly last: HTMLElement | null; readonly rows: number } | undefined
  let chip: { readonly range: Range; readonly text: string } | undefined
  const read = () => {
    frame = undefined
    const range = selectedRange()
    if (range === undefined) return
    const now = [range.startContainer, range.startOffset, range.endContainer, range.endOffset] as const
    if (ends !== undefined && now.every((part, i) => part === ends![i])) return
    ends = now
    const first = rowOf(range.startContainer)
    if (first === null) return
    if (start?.row !== first) start = { row: first, shown: shown(first), sender: senderOf(first) }
    if (!start.shown) return
    const last = rowOf(range.endContainer)
    if (span?.first !== first || span.last !== last) span = { first, last, rows: rowsSpanned(range, first, last) }
    // The start of the text holds while the selection only grows at its end once the chip has all it shows.
    const shownBefore = chip
    const grew = shownBefore !== undefined && shownBefore.text.length >= CHIP_CHARS && shownBefore.range.startContainer === range.startContainer && shownBefore.range.startOffset === range.startOffset && shownBefore.range.compareBoundaryPoints(Range.END_TO_END, range) <= 0
    const text = grew ? shownBefore.text : selectedText(range, CHIP_CHARS)
    chip = { range, text }
    if (text === '') return
    const ts = first.dataset['messageRow']
    onSelection({
      text,
      ...(start.sender === undefined ? {} : { sender: start.sender }),
      ...(ts === undefined || ts === '' ? {} : { ts }),
      ...(span.rows > 1 ? { messages: span.rows } : {}),
    }, range)
  }
  const onChange = () => {
    frame ??= requestAnimationFrame(read)
  }
  // Text selected before the panel opened counts too.
  read()
  document.addEventListener('selectionchange', onChange)
  return () => {
    document.removeEventListener('selectionchange', onChange)
    if (frame !== undefined) cancelAnimationFrame(frame)
  }
}

type Held = { readonly topicId: string; readonly selection: Selection }

/** The selection a Juno panel holds for its topic, and what reads it. */
export interface TopicSelectionHold {
  /** What the chip shows for `topicId`: the selection with the start of its text. */
  readonly get: (topicId: string) => Selection | undefined
  readonly subscribe: (listener: () => void) => () => void
  /** The whole selection to send for `topicId`: its full text is read from its range now. */
  readonly take: (topicId: string) => Selection | undefined
  readonly clear: () => void
}

function createHold(): TopicSelectionHold & { readonly hold: (held: Held, range: Range | undefined) => void } {
  let held: Held | undefined
  // The held selection's range, when it came from the page; a quote has all its text already.
  let range: Range | undefined
  const listeners = new Set<() => void>()
  const set = (next: Held | undefined) => {
    if (next === held) return
    held = next
    for (const listener of listeners) listener()
  }
  const get = (topicId: string) => (held !== undefined && held.topicId === topicId ? held.selection : undefined)
  return {
    get,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    hold: (next, at) => {
      range = at
      set(held?.topicId === next.topicId && sameSelection(held.selection, next.selection) ? held : next)
    },
    take: (topicId) => {
      const current = get(topicId)
      if (current === undefined || range === undefined) return current
      // A range whose messages left the page reads as empty: the chip's text is what is left.
      const text = selectedText(range, MAX_SELECTION_CHARS)
      return text === '' ? current : { ...current, text }
    },
    clear: () => {
      range = undefined
      set(undefined)
    },
  }
}

/**
 * The owner's selection in the topic's messages, held for the Juno panel.
 * A new selection replaces the last, so the chip shows what is highlighted
 * now; a selection that collapses (a click into the panel's composer)
 * keeps it, so it stays until sent or removed. A selection made before the
 * panel opened is taken when it opens. Another topic starts with none.
 * Ask Juno on the selection, and Tell Juno's quote of a message in this
 * topic (`junoQuoteAtom`), replace it the same way.
 *
 * The hold is the same object for the panel's life, and only what reads
 * it with `useHeldSelection` renders when the selection changes, so a drag
 * re-renders the chip, not the chat.
 */
export function useTopicSelection(topicId: string | undefined): TopicSelectionHold {
  const [hold] = useState(createHold)
  const quote = useAtomValue(junoQuoteAtom)
  const quoteTaken = useRef(0)
  useEffect(() => {
    if (quote === undefined || quote.n <= quoteTaken.current || quote.topicId !== topicId) return
    quoteTaken.current = quote.n
    registry.set(junoQuoteAtom, undefined)
    hold.hold({ topicId, selection: quote.selection }, undefined)
  }, [hold, quote, topicId])
  useEffect(() => {
    if (topicId === undefined) return
    return selectionFollower((selection, range) => hold.hold({ topicId, selection }, range))
  }, [hold, topicId])
  return hold
}

/** What the chip shows of `hold` for `topicId`, rendering when it changes. */
export function useHeldSelection(hold: TopicSelectionHold, topicId: string): Selection | undefined {
  return useSyncExternalStore(hold.subscribe, () => hold.get(topicId))
}

/** The first and last message on screen in the visible topic, as Slack `ts`. Read once, at send time. */
export function visibleRange(): { readonly from: string; readonly to: string } | undefined {
  const scroller = visibleTopicView()?.querySelector<HTMLElement>('[data-scroll]')
  if (scroller === undefined || scroller === null) return undefined
  const box = scroller.getBoundingClientRect()
  const padding = Number.parseFloat(getComputedStyle(scroller).scrollPaddingTop) || 0
  const x = box.left + box.width / 2
  const at = (y: number) => document.elementFromPoint(x, y)?.closest<HTMLElement>(ROW)?.dataset['messageRow']
  const rows = scroller.querySelectorAll<HTMLElement>(ROW)
  const from = at(box.top + padding + 1) ?? rows[0]?.dataset['messageRow']
  const to = at(box.bottom - 2) ?? rows[rows.length - 1]?.dataset['messageRow']
  return from === undefined || to === undefined ? undefined : { from, to }
}

/** Focus back to the topic's composer when the panel closes from its own Esc. */
export function focusTopicComposer(): void {
  visibleTopicView()?.querySelector<HTMLElement>('textarea, [contenteditable="true"]')?.focus()
}
