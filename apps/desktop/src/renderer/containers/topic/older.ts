import { useEffect, useState } from 'react'
import { MESSAGE_WINDOW_MAX } from '@juno/contract'
import { loadOlderMessages, messageWindowSpecAtom, registry, topicStartKnownAtom, type MessageWindow } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import type { OlderStatus } from '@juno/views'
import type { Position } from './position'
import { rowInView, rowSelector } from './scroll'

/** Rows each older page adds to the window. */
const OLDER_PAGE = 100
/** The next page is asked for when the first row comes this close to the top. */
const OLDER_MARGIN = '1000px 0px 0px 0px'

/**
 * Older pages: near the top, the next older page is fetched, one request at a time, and the window
 * widens; scroll anchoring keeps the rows in view still. A thread whose root is in the window has nothing older,
 * and neither has a topic whose start an earlier page reached (`topicStartKnownAtom`): the list then keeps no
 * slot above its first row. When the start becomes known while that slot is on screen, the slot stays, empty,
 * until the topic opens again, so the rows under the reader never move.
 * Out of the React Compiler, as the effect-only hooks in `position.ts` are.
 */
export function useOlderPages(position: Position, id: string, view: string, list: MessageWindow): OlderStatus {
  'use no memo'
  const { scrollRef, pinRef, pinnedTopRef, drawnAll, setHeldAt } = position
  const first = list.order[0]
  const complete = useAtomValue(topicStartKnownAtom(id))
  // The topic whose slot stays this open (see above); a tab that shows another topic starts afresh.
  const [keptFor, setKeptFor] = useState<string | undefined>(undefined)
  const kept = keptFor === id
  const [loadingOlder, setLoadingOlder] = useState(false)
  const rootShown = first !== undefined && list.rows.get(first)?.root === true
  const windowFull = list.order.length >= list.spec.limit
  const older: OlderStatus = loadingOlder ? 'loading' : rootShown || (complete && !windowFull) ? (kept ? 'ended' : 'none') : 'more'
  useEffect(() => {
    const scroller = scrollRef.current
    if (scroller === null || !drawnAll || older !== 'more' || first === undefined) return
    const row = scroller.querySelector(rowSelector(first))
    if (row === null) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        observer.disconnect()
        setLoadingOlder(true)
        void loadOlderMessages(registry, id, first).then((exit) => {
          if (exit._tag === 'Success' && exit.value.complete) {
            if (slotInView(scroller)) setKeptFor(id)
            registry.set(topicStartKnownAtom(id), true)
          }
          const spec = registry.get(messageWindowSpecAtom(view))
          // Up to the cap the window grows at the top; past it, it holds the 500 rows from the new page down.
          const next =
            spec.anchor === undefined && spec.limit + OLDER_PAGE <= MESSAGE_WINDOW_MAX
              ? { limit: spec.limit + OLDER_PAGE }
              : { anchor: first, before: OLDER_PAGE, limit: MESSAGE_WINDOW_MAX }
          // Scroll anchoring keeps the rows in view still, except at offset 0, where Chromium does not anchor; the pin covers both.
          // A list that reached its end while the page loaded (the pill, End) keeps holding the bottom.
          const inView = pinRef.current?.kind === 'bottom' ? undefined : rowInView(scroller)
          if (inView !== undefined) {
            pinRef.current = { kind: 'row', element: inView.element, offset: inView.offset }
            pinnedTopRef.current = scroller.scrollTop
            setHeldAt(inView.anchorKey)
          }
          registry.set(messageWindowSpecAtom(view), next)
          setLoadingOlder(false)
        })
      },
      { root: scroller, rootMargin: OLDER_MARGIN },
    )
    observer.observe(row)
    return () => observer.disconnect()
  }, [id, view, drawnAll, older, first, scrollRef, pinRef, pinnedTopRef, setHeldAt])
  return older
}

/** Whether any of the slot above the first row is inside the list's visible area. */
function slotInView(scroller: HTMLElement): boolean {
  const slot = scroller.querySelector('[data-older-line]')
  if (slot === null) return false
  const box = slot.getBoundingClientRect()
  const area = scroller.getBoundingClientRect()
  return box.bottom > area.top && box.top < area.bottom
}
