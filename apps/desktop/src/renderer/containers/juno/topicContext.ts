/**
 * What the Juno panel reads from the topic beside it (SPEC 7): the owner's
 * text selection in the topic's messages, and the messages on screen. Both
 * are read from the DOM of the visible topic, the selection as it changes
 * and the range only when a message is sent, so the topic's list does no
 * extra work on scroll.
 */
import { useEffect, useState } from 'react'
import { MAX_SELECTION_CHARS, type Selection } from '@juno/agent-contract'

const ROW = '[data-message-row]'

/** The topic view on screen. Hidden tabs keep their DOM in `<Activity>`, with no layout box. */
function visibleTopicView(): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>('[data-topic-view]')].find((view) => view.offsetParent !== null)
}

/** The sender of the message `row` shows: its own header, or the header of the group it belongs to. */
function senderOf(row: Element): string | undefined {
  for (let at: Element | null = row; at !== null; at = at.previousElementSibling) {
    if (!at.matches(ROW)) continue
    const name = at.querySelector('[data-person-name]')?.getAttribute('data-person-name')
    if (name) return name
  }
  return undefined
}

/**
 * The owner's selection in the topic's messages. A new selection replaces
 * the last; a selection that collapses (a click into the panel's composer)
 * keeps it, so it stays until sent or removed. A new topic starts empty.
 */
export function useTopicSelection(topicId: string | undefined): readonly [Selection | undefined, () => void] {
  // Kept with the topic it came from, so another topic starts with none.
  const [held, setHeld] = useState<{ readonly topicId: string; readonly selection: Selection } | undefined>(undefined)
  useEffect(() => {
    if (topicId === undefined) return
    const onChange = () => {
      const current = document.getSelection()
      if (current === null || current.isCollapsed || current.rangeCount === 0) return
      const start = current.getRangeAt(0).startContainer
      const row = (start instanceof Element ? start : start.parentElement)?.closest(ROW)
      if (row === null || row === undefined || row.closest('[data-topic-view]') !== visibleTopicView()) return
      const text = current.toString().trim().slice(0, MAX_SELECTION_CHARS)
      if (text === '') return
      const sender = senderOf(row)
      setHeld((before) =>
        before?.topicId === topicId && before.selection.text === text && before.selection.sender === sender ? before : { topicId, selection: { text, ...(sender === undefined ? {} : { sender }) } },
      )
    }
    document.addEventListener('selectionchange', onChange)
    return () => document.removeEventListener('selectionchange', onChange)
  }, [topicId])
  return [held?.topicId === topicId ? held.selection : undefined, () => setHeld(undefined)]
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
