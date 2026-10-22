/**
 * Where a topic's message list is scrolled, and the position it holds as
 * rows arrive (spec section 7; performance 3.3, 4.3 and 4.5). `usePosition`
 * owns the state; the hooks after it each keep one rule, and `Topic` calls
 * them in this file's order, which is the order their effects run in.
 *
 * The hooks opt out of the React Compiler (`'use no memo'`): the effects
 * fire by their dependency lists either way, `usePosition` returns state and
 * refs the topic reads one by one, and `useJumpToLatest` keeps its function
 * with `useCallback`. The memo code would only add to the initial bundle
 * (performance 1).
 */
import { startTransition, useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { flushSync } from 'react-dom'
import { bottomWindow, messageFlashAtom, messageWindowSpecAtom, registry, scrollSnapshotAtom, type MessageWindow } from '@juno/state'
import { afterPaint, mark, measure } from '@juno/state/perf'
import { useAtomValue } from '@juno/state/react'
import { flashChatRow } from '@juno/views'
import { onLeaveTab, takeOpenStart } from '../navigation'
import { takeSendMark } from '../sendMark'
import { scrollRest } from '../scrollRest'
import { BOTTOM_SLACK, distanceFromBottom, dividerTop, hold, rowInView, rowSelector, snapshotOf, takeOwnEnd, type Pin } from './scroll'

/** A scroll of the user's that moved the list this recently, in milliseconds, is still going on. */
const GESTURE_IDLE = 100

/** The list's ends. `atEnd`: the window holds the newest message (no anchor). */
function edgesOf(list: MessageWindow) {
  return { first: list.order[0], last: list.order.at(-1), atEnd: list.spec.anchor === undefined }
}

/** The list's scroll state, shared by the hooks below. Its refs and setters keep their identity, so the hooks' dependency lists name them without effect. */
export function usePosition(list: MessageWindow) {
  'use no memo'
  const scrollRef = useRef<HTMLElement>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  const [positioned, setPositioned] = useState(false)
  // Until the first frame is presented, only the rows from `firstRows()` above the open position down are drawn.
  const [drawnAll, setDrawnAll] = useState(false)
  const [atBottom, setAtBottom] = useState(true)
  const [far, setFar] = useState(false)
  // The newest message the user has seen at the bottom; the pill counts those after it.
  const [seenTs, setSeenTs] = useState<string | undefined>(undefined)
  // The position to hold (`Pin`), and the scrollTop it last set.
  const pinRef = useRef<Pin | undefined>(undefined)
  // The row held after a source jump or while an older page went in above it.
  const [heldAt, setHeldAt] = useState<string | undefined>(undefined)
  const pinnedTopRef = useRef(0)
  // The rows and window size the bottom was held for.
  const heldForRef = useRef<{ readonly rows: MessageWindow['rows']; readonly size: string } | undefined>(undefined)
  const { last, atEnd } = edgesOf(list)
  const lastRef = useRef(last)
  const atEndRef = useRef(atEnd)
  useLayoutEffect(() => {
    lastRef.current = last
    atEndRef.current = atEnd
  })
  return { scrollRef, anchorRef, positioned, setPositioned, drawnAll, setDrawnAll, atBottom, setAtBottom, far, setFar, seenTs, setSeenTs, pinRef, pinnedTopRef, heldAt, setHeldAt, heldForRef, lastRef, atEndRef }
}

export type Position = ReturnType<typeof usePosition>

/** The open position, before the first frame with rows is painted. */
export function useOpenPosition(position: Position, view: string, readOnly: boolean, list: MessageWindow, showWindow: boolean): void {
  'use no memo'
  const { scrollRef, anchorRef, pinRef, pinnedTopRef, heldForRef, positioned, setPositioned, setAtBottom, setFar, setSeenTs } = position
  const { last, atEnd } = edgesOf(list)
  useLayoutEffect(() => {
    const scroller = scrollRef.current
    if (scroller === null || positioned || !showWindow || !list.ready || last === undefined) return
    const snapshot = readOnly ? undefined : registry.get(scrollSnapshotAtom(view))
    const row = snapshot === undefined ? null : scroller.querySelector(rowSelector(snapshot.anchorKey))
    pinRef.current =
      snapshot !== undefined && row !== null
        ? { kind: 'row', element: row, offset: snapshot.offset }
        : anchorRef.current !== null
          ? { kind: 'row', element: anchorRef.current, offset: dividerTop(scroller) }
          : { kind: 'bottom' }
    hold(scroller, pinRef, pinnedTopRef)
    const distance = distanceFromBottom(scroller)
    const bottom = atEnd && distance <= BOTTOM_SLACK
    if (bottom) {
      pinRef.current = { kind: 'bottom' }
      pinnedTopRef.current = scroller.scrollTop
      heldForRef.current = { rows: list.rows, size: `${window.innerWidth}x${window.innerHeight}` }
    }
    setAtBottom(bottom)
    setFar(distance > scroller.clientHeight)
    setSeenTs(last)
    setPositioned(true)
  }, [view, readOnly, positioned, showWindow, list.ready, list.rows, last, atEnd, scrollRef, anchorRef, pinRef, pinnedTopRef, heldForRef, setPositioned, setAtBottom, setFar, setSeenTs])
}

/**
 * A Juno source link or a notification asked for a message: once the topic is positioned and the row is in its
 * window, it is scrolled into view if it is not, and flashes. Each request is taken once, so showing a hidden tab
 * again (`<Activity>` runs its effects again) does not jump back to it. A row above the first frame's is not drawn
 * until `drawnAll`, so the request waits for that too.
 */
export function useMessageFlash(position: Position, id: string, readOnly: boolean, list: MessageWindow) {
  'use no memo'
  const { scrollRef, pinRef, pinnedTopRef, positioned, drawnAll, setHeldAt } = position
  const flash = useAtomValue(messageFlashAtom(id))
  const flashTaken = useRef(0)
  useEffect(() => {
    const scroller = scrollRef.current
    if (readOnly || flash === undefined || flash.n <= flashTaken.current || !positioned || scroller === null || !list.rows.has(flash.ts)) return
    afterPaint(() => {
      const row = scroller.querySelector(rowSelector(flash.ts))
      if (row === null || flash.n <= flashTaken.current) return
      flashTaken.current = flash.n
      setHeldAt(flash.ts)
      if (registry.get(messageFlashAtom(id))?.n === flash.n) registry.set(messageFlashAtom(id), undefined)
      const box = row.getBoundingClientRect()
      const view = scroller.getBoundingClientRect()
      if (box.top < view.top || box.bottom > view.bottom) {
        // A source jump releases the hold before any rows can change, like the user's scrolling.
        pinRef.current = undefined
        row.scrollIntoView({ block: 'center', behavior: 'instant' })
      }
      pinRef.current = { kind: 'row', element: row, offset: row.getBoundingClientRect().top - view.top }
      pinnedTopRef.current = scroller.scrollTop
      flashChatRow(row)
    })
  }, [id, readOnly, flash, positioned, drawnAll, list.rows, scrollRef, pinRef, pinnedTopRef, setHeldAt])
  return flash
}

/** Keeps the pinned row or the bottom where it is while rows go in above it or the window resizes. */
export function useHeldPosition(position: Position, list: MessageWindow): void {
  'use no memo'
  const { scrollRef, pinRef, pinnedTopRef, positioned, drawnAll, heldAt } = position
  const { first } = edgesOf(list)
  // Rows added above the ones in view (the rest of the window after the first frame, an older page), and the rows
  // around a held row laid out in full (`heldAt`): scroll anchoring keeps the rows in view still, except at offset 0,
  // where Chromium does not anchor, and on rows still at their size estimate, which it never anchors on.
  // A tab shown again runs this too: rows that changed while it was hidden had no anchoring at all.
  useLayoutEffect(() => {
    const scroller = scrollRef.current
    if (scroller !== null && positioned) hold(scroller, pinRef, pinnedTopRef)
  }, [positioned, first, drawnAll, heldAt, list.rows, scrollRef, pinRef, pinnedTopRef])

  // The list's box changes size (the window, the composer growing, the Juno panel beside it), or its rows do (a
  // reaction, an edit box, an image or unfurl loading); at the bottom, stay there. A row growing with no change to
  // the window's rows, such as the edit box opening, reaches no layout effect, so the observer watches the column of
  // rows as well as the scroller's own box. It runs after layout and before the frame's paint.
  useEffect(() => {
    const scroller = scrollRef.current
    if (scroller === null) return
    const observer = new ResizeObserver(() => {
      if (pinRef.current?.kind === 'bottom') hold(scroller, pinRef, pinnedTopRef)
    })
    observer.observe(scroller)
    for (const column of scroller.children) observer.observe(column)
    return () => observer.disconnect()
  }, [scrollRef, pinRef, pinnedTopRef])
}

/** The first frame: measures the open, then draws the rows above it once it is on screen. */
export function useFirstFrame(position: Position, id: string, list: MessageWindow, showWindow: boolean): void {
  'use no memo'
  const { positioned, drawnAll, setDrawnAll } = position
  // `juno.topic-open` (or `juno.tab-switch` back to an unmounted tab): to the first frame with the header and the list in place.
  useLayoutEffect(() => {
    if (!list.ready || (showWindow && list.order.length > 0 && !positioned)) return
    const started = takeOpenStart(id)
    if (started !== undefined) afterPaint(() => measure(started.name, started.at, { detail: { id, rows: list.order.length } }))
  }, [id, list.ready, list.order.length, positioned, showWindow])

  // The rows above the first frame's, once it is on screen; scroll anchoring keeps the rows in view still.
  useEffect(() => {
    if (positioned && !drawnAll) afterPaint(() => startTransition(() => setDrawnAll(true)))
  }, [positioned, drawnAll, setDrawnAll])
}

/**
 * Stick to the bottom: a message that arrives, or a row that changes (a reaction, an edit), while at the
 * bottom is scrolled into view before paint; a row that grows with no change to the rows is held by
 * `useHeldPosition`'s observer. Rows keep their identity until a row changes, so a tab
 * shown again with nothing new and the same window size is still at the bottom (Chromium keeps a
 * hidden scroller's offset), and skips the layout that reading the position would force.
 */
export function useStickToBottom(position: Position, list: MessageWindow): void {
  'use no memo'
  const { scrollRef, pinRef, pinnedTopRef, heldForRef, positioned, setSeenTs } = position
  const { last, atEnd } = edgesOf(list)
  useLayoutEffect(() => {
    const scroller = scrollRef.current
    if (scroller === null || !positioned || pinRef.current?.kind !== 'bottom' || !atEnd) return
    const size = `${window.innerWidth}x${window.innerHeight}`
    if (heldForRef.current?.rows === list.rows && heldForRef.current.size === size) return
    heldForRef.current = { rows: list.rows, size }
    hold(scroller, pinRef, pinnedTopRef)
    setSeenTs(last)
  }, [positioned, list.rows, last, atEnd, scrollRef, pinRef, pinnedTopRef, heldForRef, setSeenTs])
}

/** `juno.send`: from Enter to the frame that shows the message, pending or, after a very quick answer, settled. */
export function useSendMeasure(list: MessageWindow): void {
  'use no memo'
  const { last } = edgesOf(list)
  useLayoutEffect(() => {
    if (last !== undefined && list.rows.get(last)?.fromMe === true && takeSendMark()) {
      mark('juno.send-commit', undefined, { replace: true })
      afterPaint(() => measure('juno.send', 'juno.send'))
    }
  }, [last, list.rows])
}

/**
 * The user's own scrolling lets go of the pin; where the list comes to rest decides the next one. Input lets go of
 * a held row. The bottom is let go only by a scroll up and away from the end: input that scrolls nothing, such as
 * the wheel turned down at the end or a click on a message, ends no scroll, so nothing would hold the bottom again.
 */
export function useScrollRelease(position: Position, view: string, readOnly: boolean): void {
  'use no memo'
  const { scrollRef, pinRef, pinnedTopRef, setAtBottom, setFar, setSeenTs, setHeldAt, lastRef, atEndRef } = position
  useEffect(() => {
    const scroller = scrollRef.current
    if (scroller === null) return
    const letGo = () => {
      if (pinRef.current?.kind === 'row') pinRef.current = undefined
    }
    // The scrollTop last seen at the bottom. Holding the end and rows growing above only make it larger.
    let bottomTop = scroller.scrollTop
    const rest = scrollRest(scroller, GESTURE_IDLE)
    const onScroll = () => {
      rest.onScroll()
      if (pinRef.current?.kind !== 'bottom') return
      const top = scroller.scrollTop
      if (top < bottomTop - 1 && distanceFromBottom(scroller) > 1) pinRef.current = undefined
      else bottomTop = top
    }
    const onScrollEnd = () => {
      const own = takeOwnEnd(scroller)
      if (rest.pending()) return
      if (pinRef.current?.kind === 'row' && Math.abs(scroller.scrollTop - pinnedTopRef.current) > 1) pinRef.current = undefined
      // Still held with the end away: the end moved under it (an edit box opening). `hold` lets go if the user scrolled up.
      if (pinRef.current?.kind === 'bottom') hold(scroller, pinRef, pinnedTopRef)
      const distance = distanceFromBottom(scroller)
      const bottom = atEndRef.current && distance <= BOTTOM_SLACK
      // At the exact end hold now. Otherwise remember where the user stopped before growth can move the end.
      if (own && pinRef.current?.kind !== 'bottom' && distance > 1) {
        rest.defer(() => {
          if (bottom && atEndRef.current) {
            pinRef.current = { kind: 'bottom' }
            pinnedTopRef.current = scroller.scrollTop
            hold(scroller, pinRef, pinnedTopRef)
          }
          onScrollEnd()
        })
        return
      }
      if (bottom) {
        pinRef.current = { kind: 'bottom' }
        bottomTop = pinnedTopRef.current = scroller.scrollTop
      } else if (pinRef.current?.kind === 'bottom') pinRef.current = undefined
      // Anywhere else, the list holds the row it came to rest on. A jump lands on rows still at their size estimate,
      // and Chromium does not anchor on those, so as they reach their real height a frame or two later the rows in view
      // moved by the difference. Then the rows around the held row are laid out in full in the next commit, and the pin
      // puts it back before that frame is painted. That commit is flushed in this handler: React would render it in a
      // later task, and on a loaded machine Chromium laid the rows out first, for frames on end. A row already laid
      // out is an anchor, and changing the eager rows after every step of a scroll restyled hundreds of elements, so
      // it only gets the pin.
      const inView = holdRestingRow(scroller, pinRef, pinnedTopRef, setHeldAt)
      setAtBottom(bottom)
      setFar(distance > scroller.clientHeight)
      if (bottom) setSeenTs(lastRef.current)
      if (!readOnly) registry.set(scrollSnapshotAtom(view), inView === undefined ? snapshotOf(scroller) : { anchorKey: inView.anchorKey, offset: inView.offset })
    }
    const inputs = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const
    for (const type of inputs) scroller.addEventListener(type, letGo, { passive: true })
    scroller.addEventListener('scroll', onScroll, { passive: true })
    scroller.addEventListener('scrollend', onScrollEnd)
    // After the listeners above, so it sees the bottom let go in the same scroll.
    const gesture = watchGesture(scroller, pinRef)
    const stopLeaving = readOnly ? () => {} : onLeaveTab(view, () => rememberPosition(scroller, view, pinRef, pinnedTopRef, gesture.going()))
    return () => {
      for (const type of inputs) scroller.removeEventListener(type, letGo)
      scroller.removeEventListener('scroll', onScroll)
      scroller.removeEventListener('scrollend', onScrollEnd)
      gesture.stop()
      stopLeaving()
      rest.cancel()
    }
  }, [view, readOnly, scrollRef, pinRef, pinnedTopRef, setAtBottom, setFar, setSeenTs, setHeldAt, lastRef, atEndRef])
}

// As the tab is left, the position is recorded from what is on screen then, since the rows can change after the
// scroll ended (an older page, a reaction), and that row is held while the tab is hidden: input that scrolled
// nothing (a click on a message) let go of the held row and ended no scroll, and what changes while the tab is
// hidden is laid out with nothing to anchor on. A gesture still going on is not held against.
function rememberPosition(scroller: HTMLElement, view: string, pinRef: Position['pinRef'], pinnedTopRef: Position['pinnedTopRef'], moving: boolean): void {
  const inView = rowInView(scroller)
  registry.set(scrollSnapshotAtom(view), inView === undefined ? undefined : { anchorKey: inView.anchorKey, offset: inView.offset })
  if (inView === undefined || pinRef.current !== undefined || moving) return
  pinRef.current = { kind: 'row', element: inView.element, offset: inView.offset }
  pinnedTopRef.current = scroller.scrollTop
}

/** Holds the row at rest, laying out estimated rows before the next paint. */
function holdRestingRow(scroller: HTMLElement, pinRef: Position['pinRef'], pinnedTopRef: Position['pinnedTopRef'], setHeldAt: Position['setHeldAt']) {
  const inView = pinRef.current === undefined ? rowInView(scroller) : undefined
  if (inView !== undefined) {
    pinRef.current = { kind: 'row', element: inView.element, offset: inView.offset }
    pinnedTopRef.current = scroller.scrollTop
    if (inView.element.firstElementChild?.checkVisibility({ contentVisibilityAuto: true }) === false) flushSync(() => setHeldAt(inView.anchorKey))
  }
  return inView
}

/**
 * Watches for a gesture of the user's still going on in the list: their own scroll, which moves the list with no pin
 * held, in the last moment, or a press on the list that has scrolled it (a scrollbar drag, a selection running past
 * the edge). A press that has not, such as one on a thread link that opens a new tab, is no gesture.
 */
function watchGesture(scroller: HTMLElement, pinRef: RefObject<Pin | undefined>): { readonly going: () => boolean; readonly stop: () => void } {
  let pressed = false
  let dragging = false
  let movedAt = Number.NEGATIVE_INFINITY
  const onPress = () => void (pressed = true)
  const onRelease = () => void (pressed = dragging = false)
  const onScroll = () => {
    if (pinRef.current !== undefined) return
    movedAt = performance.now()
    dragging = pressed
  }
  const onScrollEnd = () => void (movedAt = Number.NEGATIVE_INFINITY)
  scroller.addEventListener('pointerdown', onPress, { passive: true })
  addEventListener('pointerup', onRelease, { passive: true })
  addEventListener('pointercancel', onRelease, { passive: true })
  scroller.addEventListener('scroll', onScroll, { passive: true })
  scroller.addEventListener('scrollend', onScrollEnd)
  return {
    going: () => dragging || performance.now() - movedAt < GESTURE_IDLE,
    stop: () => {
      scroller.removeEventListener('pointerdown', onPress)
      removeEventListener('pointerup', onRelease)
      removeEventListener('pointercancel', onRelease)
      scroller.removeEventListener('scroll', onScroll)
      scroller.removeEventListener('scrollend', onScrollEnd)
    },
  }
}

/** Back to the newest message: the pill's jump, and after a send. A new function only when the newest row or the window's end changes (`useCallback`). */
export function useJumpToLatest(position: Position, view: string, list: MessageWindow): () => void {
  'use no memo'
  const { scrollRef, pinRef, pinnedTopRef, setAtBottom, setFar, setSeenTs } = position
  const { last, atEnd } = edgesOf(list)
  return useCallback(() => {
    const scroller = scrollRef.current
    pinRef.current = { kind: 'bottom' }
    setAtBottom(true)
    setFar(false)
    if (!atEnd) registry.set(messageWindowSpecAtom(view), bottomWindow)
    if (scroller !== null) {
      pinnedTopRef.current = scroller.scrollTop
      hold(scroller, pinRef, pinnedTopRef)
    }
    setSeenTs(last)
  }, [view, last, atEnd, scrollRef, pinRef, pinnedTopRef, setAtBottom, setFar, setSeenTs])
}

/** The "N new messages" pill: shown scrolled up, counting the messages after the newest one seen at the bottom. */
export function newMessages(position: Position, list: MessageWindow) {
  const { atEnd } = edgesOf(list)
  const seenAt = position.seenTs === undefined ? -1 : list.order.indexOf(position.seenTs)
  // The user's own messages, sent or still sending, are never new to them.
  const count = seenAt < 0 ? 0 : list.order.slice(seenAt + 1).filter((ts) => list.rows.get(ts)?.fromMe !== true).length
  return { count, show: position.positioned && !position.atBottom && (count > 0 || position.far || !atEnd) }
}
