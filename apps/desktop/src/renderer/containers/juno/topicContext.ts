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
import { MESSAGE_ROW, rowOf, rowsIn, selectedText, senderOf, visibleTopicView } from './topicSelection'

/** Whether the topic view holding `row` is on screen. A layout read, so it is asked once per row a selection starts in. */
const shown = (row: HTMLElement): boolean => (row.closest<HTMLElement>('[data-topic-view]')?.offsetParent ?? null) !== null

/** How many characters of a selection the chip keeps: enough for its snippet and its 400-character tooltip. */
const CHIP_CHARS = 420

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
  const rows = [...first.parentElement.querySelectorAll<HTMLElement>(`:scope > ${MESSAGE_ROW}`)]
  const between = rows.indexOf(last) - rows.indexOf(first)
  return between <= 0 ? 1 : between + (range.intersectsNode(last.querySelector('[data-msg-text]') ?? last) ? 1 : 0)
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
  const at = (y: number) => document.elementFromPoint(x, y)?.closest<HTMLElement>(MESSAGE_ROW)?.dataset['messageRow']
  const rows = scroller.querySelectorAll<HTMLElement>(MESSAGE_ROW)
  const from = at(box.top + padding + 1) ?? rows[0]?.dataset['messageRow']
  const to = at(box.bottom - 2) ?? rows[rows.length - 1]?.dataset['messageRow']
  return from === undefined || to === undefined ? undefined : { from, to }
}

/** Focus back to the topic's composer when the panel closes from its own Esc. */
export function focusTopicComposer(): void {
  visibleTopicView()?.querySelector<HTMLElement>('textarea, [contenteditable="true"]')?.focus()
}
