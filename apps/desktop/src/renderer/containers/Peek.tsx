import { memo, Suspense, useEffect, useRef, useState } from 'react'
import { isPeekKey, messageListAtom, openTopic, peekKeyAtom, refreshMessages, registry, tickWelcome, topicAtom } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import type { PeekPlacement } from '@juno/views'
import { chunk } from './chunks'

// The peeked topic shows only while a key is held, so it loads when idle, after the first paint.
const peekTopic = chunk(() => import('./PeekTopic'))
const PeekTopic = peekTopic.component((module) => module.PeekTopic)

const ROW = '[data-topic-row]'
/** The sidebar's sections: the rows and the gaps and labels between them. Moving through them keeps a peek open. */
const SECTION = '[data-topic-section]'
/** A Main message that has a thread, with its "3 replies" link; `data-thread` is the thread's topic id. */
const THREAD = '[data-message-row][data-thread]'
const PEEK = '[data-peek]'
/** The peek's message list, which the wheel over the rows (or the Main) scrolls. */
const PEEK_SCROLLER = '[data-peek] [data-scroll]'
/** A thread peek goes below its message unless less than this fits there and more fits above. */
const ROOM_BELOW = 320

/** A peek in progress: the topic, where it shows, and when the input that asked for it happened. */
interface Peeking {
  readonly id: string
  readonly placement: PeekPlacement
  readonly at: number
}

const SIDEBAR: PeekPlacement = { at: 'sidebar' }

/** Space types a space in these, so it never peeks while one has focus. */
function typingIn(element: Element | null): boolean {
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || (element instanceof HTMLElement && element.isContentEditable)
}

const rowOf = (target: EventTarget | null): HTMLElement | null => (target instanceof Element ? target.closest<HTMLElement>(ROW) : null)

/** The Main message with a thread that `target` is in, outside the peek itself (a peek does not peek its own threads). */
function threadOf(target: EventTarget | null): HTMLElement | null {
  const message = target instanceof Element ? target.closest<HTMLElement>(THREAD) : null
  return message === null || message.closest(PEEK) !== null ? null : message
}

/**
 * Where a thread peek shows: below its message, its left edge at the
 * message's, or above the message when the window has more room there and
 * too little below. One layout read, when the peek starts or switches.
 */
function placeAt(message: HTMLElement): PeekPlacement {
  const box = message.getBoundingClientRect()
  const below = window.innerHeight - box.bottom
  const at = below >= ROOM_BELOW || below >= box.top ? 'below' : 'above'
  const y = Math.round(at === 'below' ? box.bottom : box.top)
  return { at, x: Math.round(box.left), y, room: at === 'below' ? window.innerHeight - y : y }
}

/** The peek for an element under the pointer or with focus: a sidebar row's topic, or a Main message's thread. */
function peekOf(target: EventTarget | null, at: number): Peeking | undefined {
  const id = rowOf(target)?.dataset['topicId']
  if (id !== undefined) return { id, placement: SIDEBAR, at }
  const message = threadOf(target)
  const thread = message?.dataset['thread']
  return message == null || thread === undefined ? undefined : { id: thread, placement: placeAt(message), at }
}

/**
 * What a peek key press is for: the row or the Main message under the
 * pointer, or, for ⌥, the one that has keyboard focus. Space on a focused
 * row opens it, as on a button, so Space peeks only by pointer.
 */
function toPeek(key: string, at: number): Peeking | undefined {
  const hovered = document.querySelector(`${ROW}:hover`) ?? Array.from(document.querySelectorAll(`${THREAD}:hover`)).find((message) => threadOf(message) !== null)
  if (hovered !== undefined) return peekOf(hovered, at)
  return key === 'Alt' ? peekOf(document.activeElement, at) : undefined
}

/**
 * Peek (spec section 5): while the peek key is held over a sidebar row, the
 * topic shows in a popover beside the sidebar; held over a Main message
 * that has a thread, the thread shows below (or above) the message. Moving
 * to another row or threaded message switches it; releasing the key,
 * moving off them, another key, a click or leaving the window closes it;
 * a press on a person in a thread peek leaves it open for their click.
 * A thread peek stays open while the pointer is on it. The wheel over the
 * rows (or the Main) scrolls the peek, not what is under the pointer.
 *
 * A peek is a read that never marks (`peekNeverMarks` in
 * `specs/readstate.qnt`): it runs no read command, opens no tab and moves
 * no focus. Its first frame comes from the query the row's hover already
 * warmed (`warmTopic`).
 */
export const Peek = memo(function Peek() {
  const peekKey = useAtomValue(peekKeyAtom)
  useEffect(() => {
    const idle = requestIdleCallback(() => void peekTopic.load(), { timeout: 5_000 })
    return () => cancelIdleCallback(idle)
  }, [])
  const [peeking, setPeeking] = useState<Peeking | undefined>(undefined)
  // The key that holds the peek open.
  const held = useRef<string | undefined>(undefined)

  useEffect(() => {
    const close = () => {
      held.current = undefined
      setPeeking(undefined)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (held.current !== undefined) {
        if (event.key === held.current) {
          // A held Space repeats; it must not scroll the page or reach a focused row.
          if (event.key === ' ') {
            event.preventDefault()
            event.stopPropagation()
          }
          return
        }
        // Escape, or a chord such as ⌥E while typing: the peek ends and the key does what it does.
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
        }
        close()
        return
      }
      if (event.repeat || !isPeekKey(peekKey, event.key, typingIn(document.activeElement))) return
      const next = toPeek(event.key, event.timeStamp)
      if (next === undefined) return
      if (event.key === ' ') {
        event.preventDefault()
        event.stopPropagation()
      }
      held.current = event.key
      setPeeking(next)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === held.current) close()
    }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', close)
    }
  }, [peekKey])

  // While a peek is open: follow the pointer from row to row, and send the wheel to the peek.
  const open = peeking === undefined ? undefined : peeking.placement.at === 'sidebar' ? 'sidebar' : 'thread'
  useEffect(() => {
    if (open === undefined) return
    const close = () => {
      held.current = undefined
      setPeeking(undefined)
    }
    // Where the pointer may go without closing the peek: the sidebar's sections, or a thread peek itself.
    const keeps = (target: Element) => target.closest(open === 'sidebar' ? SECTION : PEEK) !== null
    const onPointerOver = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return close()
      const row = rowOf(target)
      const message = row === null ? threadOf(target) : null
      const id = row?.dataset['topicId'] ?? message?.dataset['thread']
      if (id !== undefined) {
        setPeeking((current) => (current?.id === id ? current : (peekOf(row ?? message, event.timeStamp) ?? current)))
      } else if (!keeps(target)) {
        close()
      }
    }
    const onWheel = (event: WheelEvent) => {
      const scroller = document.querySelector<HTMLElement>(PEEK_SCROLLER)
      if (scroller === null || !(event.target instanceof Element)) return
      // Over the rows for a sidebar peek; anywhere off the peek for a thread peek, so the Main under it holds still.
      const route = open === 'sidebar' ? event.target.closest(SECTION) !== null : event.target.closest(PEEK) === null
      if (!route) return
      event.preventDefault()
      scroller.scrollBy({ top: event.deltaY, behavior: 'instant' })
    }
    window.addEventListener('pointerover', onPointerOver, true)
    // A press on a person or picture in a thread peek lets its click or context menu act before navigation closes the peek.
    const onPress = (event: PointerEvent) => (event.target instanceof Element && event.target.closest(`${PEEK} :is([data-opens-person], [data-thumbnail])`)) || close()
    window.addEventListener('pointerdown', onPress, true)
    window.addEventListener('wheel', onWheel, { capture: true, passive: false })
    return () => {
      window.removeEventListener('pointerover', onPointerOver, true)
      window.removeEventListener('pointerdown', onPress, true)
      window.removeEventListener('wheel', onWheel, true)
    }
  }, [open])

  const shown = useWhenReady(peeking)
  // A peek on screen: the welcome card's first hint (SPEC 4).
  const peeked = shown !== undefined
  useEffect(() => {
    if (peeked) tickWelcome(registry, 'peek')
  }, [peeked])
  if (peeking === undefined || shown === undefined) return null
  // Shown only once the chunk has loaded, so this never suspends; the boundary keeps it that way.
  return (
    <Suspense fallback={null}>
      <PeekTopic key={shown.id} id={shown.id} at={shown.at} placement={shown.placement} />
    </Suspense>
  )
})

/**
 * The topic's header and first window are local and covered (or it failed, or is unknown): a peek at it
 * can paint. A window of search matches is not covered (performance.md 3.3) and would grow when the
 * replies page lands, so the peek waits for the fetch it makes anyway.
 */
function canPaint(id: string): boolean {
  const header = registry.get(topicAtom(id))
  if (header._tag === 'Failure') return true
  if (header._tag !== 'Success') return false
  if (header.value === null) return true
  const list = registry.get(messageListAtom(id))
  return list.ready && list.meta.windowCovered !== false
}

/**
 * The peek to draw: `peeking` once its topic can paint and its chunk has
 * loaded. Until then the previous one stays, so moving from row to row
 * never flashes an empty popover. A topic the row's hover warmed can paint
 * at once, before the first frame.
 */
function useWhenReady(peeking: Peeking | undefined): Peeking | undefined {
  const [shown, setShown] = useState<Peeking | undefined>(undefined)
  // The peek whose topic arrived after it was asked for.
  const [arrived, setArrived] = useState<Peeking | undefined>(undefined)
  const loaded = peekTopic.useReady()
  const ready = peeking !== undefined && (arrived === peeking || canPaint(peeking.id))
  const next = peeking === undefined ? undefined : ready && loaded ? peeking : shown
  if (next !== shown) setShown(next)
  // A peek before the idle preload: the chunk comes now.
  useEffect(() => {
    if (peeking !== undefined && !loaded) void peekTopic.load()
  }, [peeking, loaded])
  useEffect(() => {
    if (peeking === undefined || ready) return
    // After the fetch: the window update it brings, whether or not that covers the window.
    let fetchedMeta: object | undefined
    const check = () => {
      if (canPaint(peeking.id) || (fetchedMeta !== undefined && registry.get(messageListAtom(peeking.id)).meta !== fetchedMeta)) setArrived(peeking)
    }
    // Each subscription also looks once now, in case the topic arrived after this render.
    const offs = [registry.subscribe(topicAtom(peeking.id), check, { immediate: true }), registry.subscribe(messageListAtom(peeking.id), check, { immediate: true })]
    // An uncovered window waits for Slack: the fetch the peeked list makes on mount, started here. Its answer
    // reaches the window in a later update, which is asked for again as `useTopicFetch` does. Offline, the
    // peek shows what is stored.
    let live = true
    void openTopic(registry, peeking.id).then((exit) => {
      if (!live) return
      const done = exit._tag === 'Success' && (exit.value.outcome === 'fetched' || exit.value.outcome === 'cached')
      if (!done) return setArrived(peeking)
      // The list keeps its last value while the subscription starts again, so a new `meta` is a new answer.
      fetchedMeta = registry.get(messageListAtom(peeking.id)).meta
      refreshMessages(registry, peeking.id)
      check()
    })
    return () => {
      live = false
      for (const off of offs) off()
    }
  }, [peeking, ready])
  return next
}
