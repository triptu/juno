import { useEffect, useState } from 'react'
import { MESSAGE_WINDOW_MAX } from '@juno/contract'
import { loadOlderMessages, messageWindowSpecAtom, registry, topicStartKnownAtom, type MessageWindow } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import type { OlderStatus } from '@juno/views'
import type { Position } from './position'
import { rowInView, rowSelector } from './scroll'
import { useStepStall } from './stall'

/** Rows each older page adds to the window. */
const OLDER_PAGE = 100
/** The next page is asked for when the first row comes this close to the top. */
const OLDER_MARGIN = '1000px 0px 0px 0px'

/**
 * Older pages: near the top, the next older page is fetched, one request at a time, and the window
 * widens; scroll anchoring keeps the rows in view still. A thread whose root is in the window has nothing older,
 * and neither has a topic whose start an earlier page reached this run (`topicStartKnownAtom`), so opening it
 * again asks for nothing, unless its window stops at replies the store cannot prove (`meta.gapBefore`). A thread
 * window grows only once the replies reach its first row, so a wide gap can take a few steps while the top stays
 * in view. A step Slack could not answer waits a few seconds before it is asked again (`useStepStall`).
 * Out of the React Compiler, as the effect-only hooks in `position.ts` are.
 */
export function useOlderPages(position: Position, id: string, view: string, list: MessageWindow): OlderStatus {
  'use no memo'
  const { scrollRef, pinRef, pinnedTopRef, drawnAll, setHeldAt } = position
  const first = list.order[0]
  const complete = useAtomValue(topicStartKnownAtom(id))
  const [loadingOlder, setLoadingOlder] = useState(false)
  const { stalled, settle } = useStepStall()
  const rootShown = first !== undefined && list.rows.get(first)?.root === true
  const windowFull = list.order.length >= list.spec.limit
  const older: OlderStatus = loadingOlder ? 'loading' : rootShown || (complete && !windowFull && list.meta.gapBefore !== true) ? 'none' : 'more'
  useEffect(() => {
    const scroller = scrollRef.current
    if (scroller === null || !drawnAll || older !== 'more' || first === undefined || stalled === first) return
    const row = scroller.querySelector(rowSelector(first))
    if (row === null) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        observer.disconnect()
        setLoadingOlder(true)
        void loadOlderMessages(registry, id, first).then((exit) => {
          if (exit._tag === 'Success' && exit.value.complete) registry.set(topicStartKnownAtom(id), true)
          const outcome = exit._tag === 'Success' ? exit.value.outcome : undefined
          settle(first, outcome === 'fetched' || outcome === 'cached', outcome === 'fetched')
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
  }, [id, view, drawnAll, older, first, stalled, settle, scrollRef, pinRef, pinnedTopRef, setHeldAt])
  return older
}

