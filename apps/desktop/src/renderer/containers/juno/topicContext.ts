/**
 * What the Juno panel reads from the topic beside it (SPEC 7): the owner's
 * text selection in the topic's messages, and the messages on screen. Both
 * are read from the DOM of the visible topic, the selection as it changes
 * and the range only when a message is sent, so the topic's list does no
 * extra work on scroll.
 */
import { useEffect, useRef, useState } from 'react'
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

/** The whole of one message in the visible topic, with its sender, as a quote: Tell Juno in the why popover (SPEC 14). */
export function messageQuote(ts: string): Selection | undefined {
  const row = visibleTopicView()?.querySelector<HTMLElement>(`${ROW}[data-message-row="${CSS.escape(ts)}"]`)
  const text = row?.querySelector('[data-msg-text]')?.textContent?.trim()
  if (row === null || row === undefined || text === undefined || text === '') return undefined
  return selectionOf(text, [row])
}

const rowOf = (node: Node): HTMLElement | null => (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>(ROW) ?? null

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

/** The owner's text selection in the visible topic's messages, if there is one: what Ask Juno and the panel's chip take. */
export function topicSelection(): Selection | undefined {
  const current = document.getSelection()
  if (current === null || current.isCollapsed || current.rangeCount === 0) return undefined
  const range = current.getRangeAt(0)
  const first = rowOf(range.startContainer)
  const view = visibleTopicView()
  if (first === null || view === undefined || first.closest('[data-topic-view]') !== view) return undefined
  const text = current.toString().trim()
  if (text === '') return undefined
  return selectionOf(text, rowsIn(range, view, first))
}

/** Clears the highlight once Ask Juno has taken it, as Quote does. */
export function clearTopicSelection(): void {
  document.getSelection()?.removeAllRanges()
}

const sameSelection = (a: Selection, b: Selection) => a.text === b.text && a.sender === b.sender && a.ts === b.ts && a.messages === b.messages

/**
 * The owner's selection in the topic's messages. A new selection replaces
 * the last, so the chip shows what is highlighted now; a selection that
 * collapses (a click into the panel's composer) keeps it, so it stays
 * until sent or removed. A selection made before the panel opened is taken
 * when it opens. A new topic starts empty. Ask Juno on the selection, and
 * Tell Juno's quote of a message in this topic (`junoQuoteAtom`), replace
 * it the same way.
 */
export function useTopicSelection(topicId: string | undefined): readonly [Selection | undefined, () => void] {
  // Kept with the topic it came from, so another topic starts with none.
  const [held, setHeld] = useState<{ readonly topicId: string; readonly selection: Selection } | undefined>(undefined)
  const quote = useAtomValue(junoQuoteAtom)
  const quoteTaken = useRef(0)
  useEffect(() => {
    if (quote === undefined || quote.n <= quoteTaken.current || quote.topicId !== topicId) return
    quoteTaken.current = quote.n
    registry.set(junoQuoteAtom, undefined)
    setHeld({ topicId, selection: quote.selection })
  }, [quote, topicId])
  useEffect(() => {
    if (topicId === undefined) return
    const onChange = () => {
      const selection = topicSelection()
      if (selection === undefined) return
      setHeld((before) => (before?.topicId === topicId && sameSelection(before.selection, selection) ? before : { topicId, selection }))
    }
    // Text selected before the panel opened counts too.
    onChange()
    document.addEventListener('selectionchange', onChange)
    return () => document.removeEventListener('selectionchange', onChange)
  }, [topicId])
  return [held !== undefined && held.topicId === topicId ? held.selection : undefined, () => setHeld(undefined)]
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
