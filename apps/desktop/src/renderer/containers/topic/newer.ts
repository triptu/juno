import { useEffect, useState } from 'react'
import { MESSAGE_WINDOW_MAX } from '@juno/contract'
import { loadNewerMessages, messageListAtom, messageWindowSpecAtom, registry, type MessageWindow, type MessageWindowSpec } from '@juno/state'
import type { Position } from './position'
import { rowInView, rowSelector } from './scroll'
import { useStepStall } from './stall'

/** Rows each newer page adds to the window. */
const NEWER_PAGE = 100
/** The replies after the last row are asked for when it comes this close to the bottom. */
const NEWER_MARGIN = '0px 0px 1000px 0px'

/**
 * Newer replies, for a thread window that stops before replies the store cannot prove (`meta.gapAfter`):
 * near the bottom, the replies after the last row are fetched, one request at a time, and the window
 * widens down. They come in below the last row, so the rows in view stay still; past the cap the window
 * lets go of rows at the top, and the row in view is held as `useOlderPages` holds it. A window at the
 * bottom (no anchor) shows the new replies by itself. While a step is out the list shows nothing extra;
 * a step Slack could not answer waits a few seconds before it is asked again (`useStepStall`).
 * Out of the React Compiler, as the effect-only hooks in `position.ts` are.
 */
export function useNewerPages(position: Position, id: string, view: string, list: MessageWindow): void {
  'use no memo'
  const { scrollRef, pinRef, pinnedTopRef, drawnAll, setHeldAt } = position
  // Juno's own replies still sending come last and have no place in Slack's order.
  const last = list.order.findLast((ts) => !ts.startsWith('pending:'))
  const gap = list.meta.gapAfter === true
  const [loading, setLoading] = useState(false)
  const { stalled, settle } = useStepStall()
  useEffect(() => {
    const scroller = scrollRef.current
    if (scroller === null || !drawnAll || !gap || loading || last === undefined || stalled === last) return
    const row = scroller.querySelector(rowSelector(last))
    if (row === null) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        observer.disconnect()
        setLoading(true)
        void loadNewerMessages(registry, id, last).then((exit) => {
          const outcome = exit._tag === 'Success' ? exit.value.outcome : undefined
          const answered = outcome === 'fetched' || outcome === 'cached'
          settle(last, answered, outcome === 'fetched')
          const spec = registry.get(messageWindowSpecAtom(view))
          if (answered && spec.anchor !== undefined) {
            const next = widened(spec, registry.get(messageListAtom(view)).order)
            if (next.anchor !== spec.anchor) {
              const inView = pinRef.current?.kind === 'bottom' ? undefined : rowInView(scroller)
              if (inView !== undefined) {
                pinRef.current = { kind: 'row', element: inView.element, offset: inView.offset }
                pinnedTopRef.current = scroller.scrollTop
                setHeldAt(inView.anchorKey)
              }
            }
            registry.set(messageWindowSpecAtom(view), next)
          }
          setLoading(false)
        })
      },
      { root: scroller, rootMargin: NEWER_MARGIN },
    )
    observer.observe(row)
    return () => observer.disconnect()
  }, [id, view, drawnAll, gap, loading, last, stalled, settle, scrollRef, pinRef, pinnedTopRef, setHeldAt])
}

/** The window a page further down: longer up to the cap, then the newest rows it had and the page after them. */
function widened(spec: MessageWindowSpec, order: ReadonlyArray<string>): MessageWindowSpec {
  if (spec.limit + NEWER_PAGE <= MESSAGE_WINDOW_MAX) return { ...spec, limit: spec.limit + NEWER_PAGE }
  const sent = order.filter((ts) => !ts.startsWith('pending:'))
  const anchor = sent[Math.max(0, sent.length - (MESSAGE_WINDOW_MAX - NEWER_PAGE))]
  return anchor === undefined ? spec : { anchor, before: 0, limit: MESSAGE_WINDOW_MAX }
}
