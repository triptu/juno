/**
 * Where the chat's list is scrolled (see `JunoChat`): the open position,
 * holding the bottom, the edges that move the window, and read marks. `JunoChat` calls these hooks in this file's order,
 * which is the order their effects run in.
 */
import { useEffect, useLayoutEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import type { BubbleId, ChatItem, ChatPage, ReplyTarget } from '@juno/agent-contract'
import { afterPaint, measure } from '@juno/state/perf'
import { flashChatRow } from '@juno/views'
import { scrollingUp, watchUpwardInput } from '../scrollInput'
import { scrollRest } from '../scrollRest'
import { junoCommands, takePanelOpenStart } from './actions'
import { anchorOf, OVERLAP, WINDOW, type Window } from './chatWindow'

/** Within this of the end counts as at the bottom (performance 3.3). */
const BOTTOM_SLACK = 32
/** Where the "New" divider lands below the header band when the chat opens at it. */
const DIVIDER_GAP = 80
/** The edge slots ask for more this far before they come into view. */
const EDGE_MARGIN = '800px 0px'
/** A Juno bubble is read once fully on screen in the focused chat this long (SPEC 13.1). */
const READ_AFTER_MS = 1000
/** The shortest a chat row with a bubble is: one line and its group gap. */
const MIN_ROW_HEIGHT = 32

/**
 * Rows at the end the list lays out in full: enough to fill the window however short they are. At their
 * 38px estimate, rows in view grow as they are first drawn, after the open position is set, and push the
 * newest message below the fold; laid out in full, the bottom set before paint holds. `innerHeight` does
 * not force a layout.
 */
function tailRows(): number {
  return Math.ceil(window.innerHeight / MIN_ROW_HEIGHT) + 2
}

const distanceFromBottom = (scroller: HTMLElement) => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight

/** The scrollTop each chat list last held its bottom at, for `holdEnd`. */
const heldTops = new WeakMap<HTMLElement, number>()
/** Lists whose own scroll to the end has not ended yet: a `scrollend` follows each, also during the owner's scroll. */
const ownEnds = new WeakSet<HTMLElement>()
/** How long nothing scrolls before a scroll's resting place is decided, after the list's own scroll ended. */
const SETTLE_MS = 100

/** Scrolls to the end and remembers where. Anything that starts holding the bottom calls this or records the place. */
export function toEnd(scroller: HTMLElement): void {
  const top = scroller.scrollTop
  scroller.scrollTop = scroller.scrollHeight
  heldTops.set(scroller, scroller.scrollTop)
  if (scroller.scrollTop !== top) ownEnds.add(scroller)
}

/**
 * Holds the bottom, or lets go when the owner is scrolling up (`scrollingUp`) and the list moved up from where it was
 * last held and is away from the end: the owner's scroll is already in `scrollTop` when this runs, but its `scroll`
 * event, which lets go, may come after it in the frame, as when a row grows during a wheel gesture. With no such
 * input the list moved through scroll anchoring, as when a full window drops its first row for a new one, and it
 * holds.
 */
function holdEnd(scroller: HTMLElement, pinnedRef: RefObject<boolean>): void {
  if (!pinnedRef.current) return
  if (scroller.scrollTop < (heldTops.get(scroller) ?? 0) - 1 && distanceFromBottom(scroller) > 1 && scrollingUp(scroller)) pinnedRef.current = false
  else toEnd(scroller)
}

type Scroller = RefObject<HTMLElement | null>
type SetWindow = Dispatch<SetStateAction<Window>>
type ChatTarget = ReplyTarget | { readonly _tag: 'message'; readonly id: string }

/** The DOM row of a reply target or a chat message, for scrolling to it. */
function rowOf(scroller: HTMLElement, target: ChatTarget): Element | null {
  switch (target._tag) {
    case 'bubble':
      return scroller.querySelector(`[data-chat-juno="${CSS.escape(target.id)}"]`)
    case 'card':
      return scroller.querySelector(`[data-chat-card-row="${CSS.escape(target.id)}"]`)
    case 'owner':
      return scroller.querySelector(`[data-chat-owner="${CSS.escape(target.opId)}"]`)
    case 'message':
      return scroller.querySelector(`[data-chat-juno^="${CSS.escape(target.id)}"], [data-chat-owner="${CSS.escape(target.id)}"]`)
  }
}

/** Scrolls a row into view and flashes it; the hold on the bottom lets go. */
export function scrollToRow(scrollRef: Scroller, pinnedRef: RefObject<boolean>, target: ChatTarget): void {
  const scroller = scrollRef.current
  const row = scroller === null ? null : rowOf(scroller, target)
  if (row === null) return
  pinnedRef.current = false
  row.scrollIntoView({ block: 'center', behavior: 'instant' })
  flashChatRow(row)
}

/**
 * Whether the list holds the bottom, where it opened, and the newest Juno row seen there. The open
 * position is set before the first frame with rows is painted: the tab at the "New" divider, else the bottom.
 * `eagerTail` is how many rows at the end are laid out in full, so that position holds (`tailRows`).
 */
export function useChatPosition(column: 'page' | 'panel', loaded: boolean, items: ReadonlyArray<ChatItem>, scrollRef: Scroller, anchorRef: RefObject<HTMLDivElement | null>) {
  // Hold the bottom: true while the owner is at the end, or after a send.
  const pinnedRef = useRef(true)
  const [positioned, setPositioned] = useState(false)
  const [eagerTail] = useState(tailRows)
  const [atBottom, setAtBottom] = useState(true)
  // The newest of Juno's rows seen at the bottom; one that arrives while scrolled up shows the pill.
  const newestJuno = items.findLast((item) => item._tag === 'juno' || item._tag === 'card')
  const newestKey = newestJuno === undefined ? undefined : anchorOf(newestJuno)
  const [seenKey, setSeenKey] = useState(newestKey)
  if (atBottom && seenKey !== newestKey) setSeenKey(newestKey)
  const unseen = !atBottom && newestKey !== seenKey

  useLayoutEffect(() => {
    const scroller = scrollRef.current
    if (scroller === null || positioned || !loaded) return
    const divider = anchorRef.current
    if (column === 'page' && divider !== null) {
      const padding = Number.parseFloat(getComputedStyle(scroller).scrollPaddingTop) || 0
      scroller.scrollTop += divider.getBoundingClientRect().top - scroller.getBoundingClientRect().top - padding - DIVIDER_GAP
      pinnedRef.current = distanceFromBottom(scroller) <= BOTTOM_SLACK
      heldTops.set(scroller, scroller.scrollTop)
    } else {
      toEnd(scroller)
      pinnedRef.current = true
    }
    setAtBottom(pinnedRef.current)
    setPositioned(true)
    const opened = column === 'panel' ? takePanelOpenStart() : undefined
    if (opened !== undefined) afterPaint(() => measure('juno.panel-open', opened))
  }, [column, positioned, loaded, scrollRef, anchorRef])
  return { pinnedRef, positioned, atBottom, setAtBottom, unseen, eagerTail }
}

/**
 * `juno.chat-bubble`: from a send to the first Juno bubble after it, painted. `sentAtRef` is set by the send.
 * Keyed on the newest bubble, not a count: a full window drops a row for each one that arrives.
 */
export function useBubbleMeasure(items: ReadonlyArray<ChatItem>) {
  const sentAtRef = useRef<{ readonly at: number; readonly newest: string | undefined } | undefined>(undefined)
  const newestBubble = items.findLast((item) => item._tag === 'juno')
  const newestBubbleId = newestBubble?._tag === 'juno' ? newestBubble.id : undefined
  useLayoutEffect(() => {
    const sent = sentAtRef.current
    if (sent === undefined || newestBubbleId === sent.newest) return
    sentAtRef.current = undefined
    afterPaint(() => measure('juno.chat-bubble', sent.at))
  }, [newestBubbleId])
  return { sentAtRef, newestBubbleId }
}

/**
 * At the bottom, a change to the rows (a bubble, the status bubble, a send, a reaction) is scrolled into view
 * before paint, and so is the list's box or its column of rows changing size (the window, the composer growing, a
 * row growing after its commit, as a card or an image lays out). The observer runs after layout and before the
 * frame's paint.
 */
export function useStickToBottom(scrollRef: Scroller, pinnedRef: RefObject<boolean>, positioned: boolean, items: ReadonlyArray<ChatItem>, moreBelow: boolean): void {
  useLayoutEffect(() => {
    const scroller = scrollRef.current
    if (scroller === null || !positioned) return
    if (!moreBelow) holdEnd(scroller, pinnedRef)
  }, [positioned, items, moreBelow, scrollRef, pinnedRef])
  useEffect(() => {
    const scroller = scrollRef.current
    if (scroller === null || !positioned || moreBelow) return
    const observer = new ResizeObserver(() => holdEnd(scroller, pinnedRef))
    observer.observe(scroller)
    for (const column of scroller.children) observer.observe(column)
    return () => observer.disconnect()
  }, [positioned, moreBelow, scrollRef, pinnedRef])
}

/**
 * The owner's scrolling lets go of the bottom; where the list comes to rest decides whether it holds again. Only a
 * scroll up and away from the end lets go: input that scrolls nothing, such as the wheel turned down at the end or
 * a click on a bubble, ends no scroll, so nothing would hold the bottom again.
 */
export function useScrollRelease(scrollRef: Scroller, pinnedRef: RefObject<boolean>, pageRef: RefObject<ChatPage>, setAtBottom: Dispatch<SetStateAction<boolean>>): void {
  useEffect(() => {
    const scroller = scrollRef.current
    if (scroller === null) return
    // The scrollTop last seen at the bottom. Holding the end and rows growing above only make it larger.
    let bottomTop = scroller.scrollTop
    const rest = scrollRest(scroller, SETTLE_MS)
    const onScroll = () => {
      rest.onScroll()
      const top = scroller.scrollTop
      // The owner's scroll reached the end: hold it now, not when the scroll ends, which a held scrollbar thumb or
      // fingers resting on the trackpad put off while a bubble arrives.
      if (!pinnedRef.current && !pageRef.current.moreBelow && distanceFromBottom(scroller) <= 1) {
        pinnedRef.current = true
        bottomTop = top
        heldTops.set(scroller, top)
        return
      }
      if (!pinnedRef.current) return
      if (top < bottomTop - 1 && distanceFromBottom(scroller) > 1) pinnedRef.current = false
      else bottomTop = top
    }
    const onScrollEnd = () => {
      const own = ownEnds.delete(scroller)
      if (rest.pending()) return
      // Still held and the end away: the end moved under it, and this event came before the resize observer.
      if (!pageRef.current.moreBelow) holdEnd(scroller, pinnedRef)
      const distance = distanceFromBottom(scroller)
      const bottom = !pageRef.current.moreBelow && distance <= BOTTOM_SLACK
      // At the exact end hold now; a deferred near-bottom rest keeps its decision if rows grow in the meantime.
      if (own && !pinnedRef.current && distance > 1) {
        rest.defer(() => {
          if (bottom && !pageRef.current.moreBelow) {
            pinnedRef.current = true
            toEnd(scroller)
          }
          onScrollEnd()
        })
        return
      }
      pinnedRef.current = bottom
      if (bottom) {
        bottomTop = scroller.scrollTop
        heldTops.set(scroller, bottomTop)
      }
      setAtBottom(bottom)
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    scroller.addEventListener('scrollend', onScrollEnd)
    const stopInput = watchUpwardInput(scroller)
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      scroller.removeEventListener('scrollend', onScrollEnd)
      stopInput()
      rest.cancel()
    }
  }, [scrollRef, pinnedRef, pageRef, setAtBottom])
}

interface Edges {
  readonly scrollRef: Scroller
  readonly topEdgeRef: RefObject<HTMLDivElement | null>
  readonly bottomEdgeRef: RefObject<HTMLDivElement | null>
}

/** The edges ask for the rows beyond them. */
export function useEdges({ scrollRef, topEdgeRef, bottomEdgeRef }: Edges, positioned: boolean, page: ChatPage, items: ReadonlyArray<ChatItem>, setWindow: SetWindow): void {
  const firstAnchor = items.map(anchorOf).find((key) => key !== undefined)
  const lastAnchor = items.map(anchorOf).findLast((key) => key !== undefined)
  useEffect(() => {
    const scroller = scrollRef.current
    const top = topEdgeRef.current
    const bottom = bottomEdgeRef.current
    if (scroller === null || top === null || bottom === null || !positioned) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          if (entry.target === top && page.moreAbove && firstAnchor !== undefined) setWindow({ _tag: 'around', anchor: firstAnchor as BubbleId, before: OVERLAP, limit: WINDOW })
          if (entry.target === bottom && page.moreBelow && lastAnchor !== undefined) setWindow({ _tag: 'around', anchor: lastAnchor as BubbleId, before: OVERLAP, limit: WINDOW })
        }
      },
      { root: scroller, rootMargin: EDGE_MARGIN },
    )
    observer.observe(top)
    observer.observe(bottom)
    return () => observer.disconnect()
  }, [positioned, page.moreAbove, page.moreBelow, firstAnchor, lastAnchor, scrollRef, topEdgeRef, bottomEdgeRef, setWindow])
}

/** Read marks: unread Juno bubbles fully on screen for a second, while the window has focus. */
export function useReadMarks(scrollRef: Scroller, positioned: boolean, items: ReadonlyArray<ChatItem>): void {
  useEffect(() => {
    const scroller = scrollRef.current
    if (scroller === null || !positioned) return
    const shown = new Set<Element>()
    let timer: ReturnType<typeof setTimeout> | undefined
    const read = () => {
      timer = undefined
      if (!document.hasFocus() || document.visibilityState !== 'visible') return
      // The newest bubble on screen, in list order; the mark covers everything before it.
      const through = [...scroller.querySelectorAll('[data-chat-juno][data-unread]')].findLast((row) => shown.has(row))?.getAttribute('data-chat-juno')
      if (through) void junoCommands.read(through)
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.intersectionRatio >= 1) shown.add(entry.target)
          else shown.delete(entry.target)
        }
        if (shown.size > 0 && timer === undefined) timer = setTimeout(read, READ_AFTER_MS)
      },
      { root: scroller, threshold: 1 },
    )
    for (const row of scroller.querySelectorAll('[data-chat-juno][data-unread]')) observer.observe(row)
    const onFocus = () => {
      if (shown.size > 0 && timer === undefined) timer = setTimeout(read, READ_AFTER_MS)
    }
    globalThis.addEventListener('focus', onFocus)
    return () => {
      observer.disconnect()
      globalThis.removeEventListener('focus', onFocus)
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [positioned, items, scrollRef])
}
