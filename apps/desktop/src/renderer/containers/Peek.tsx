import { memo, startTransition, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { MessageView } from '@juno/contract'
import { isPeekKey, messageListAtom, nowAtom, openTopic as fetchTopic, peekKeyAtom, registry, setPeekKey, topicAtom, type MessageWindow, type PeekKey } from '@juno/state'
import { afterPaint, measure } from '@juno/state/perf'
import { useAtomValue } from '@juno/state/react'
import { MessageList, PeekKeySetting, PeekView, TopicArt, type MessageListItem, type MessageListStatus } from '@juno/views'
import { hasArt } from './TopicView'

const ROW = '[data-topic-row]'
/** The sidebar's sections: the rows and the gaps and labels between them. Moving through them keeps a peek open. */
const SECTION = '[data-topic-section]'
/** No "Loading messages" line before this (performance 4.4). */
const LOADING_DELAY_MS = 300
/** Message times change at most at a day boundary; re-render the rows for it this often, not every minute. */
const TIME_STEP = 10 * 60_000
/** The shortest a message row can be: the 32px avatar slot and its padding. */
const MIN_ROW_HEIGHT = 40

/** A peek in progress: the topic, and when the input that asked for it happened. */
interface Peeking {
  readonly id: string
  readonly at: number
}

/** Space types a space in these, so it never peeks while one has focus. */
function typingIn(element: Element | null): boolean {
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || (element instanceof HTMLElement && element.isContentEditable)
}

const rowOf = (target: EventTarget | null): HTMLElement | null => (target instanceof Element ? target.closest<HTMLElement>(ROW) : null)

/**
 * The row a peek key press is for: the row under the pointer, or, for ⌥,
 * the row that has keyboard focus. Space on a focused row opens it, as on
 * a button, so Space peeks only by pointer.
 */
function rowToPeek(key: string): string | undefined {
  const hovered = document.querySelector<HTMLElement>(`${ROW}:hover`)
  if (hovered !== null) return hovered.dataset['topicId']
  return key === 'Alt' ? rowOf(document.activeElement)?.dataset['topicId'] : undefined
}

/**
 * Peek (spec section 5): while the peek key is held over a sidebar row, the
 * topic shows in a popover beside the sidebar. Moving to another row
 * switches it; releasing the key, moving off the rows, another key, a click
 * or leaving the window closes it. The wheel over the rows scrolls the
 * peek, not the sidebar.
 *
 * A peek is a read that never marks (`peekNeverMarks` in
 * `specs/readstate.qnt`): it runs no read command, opens no tab and moves
 * no focus. Its first frame comes from the query the row's hover already
 * warmed (`warmTopic`).
 */
export const Peek = memo(function Peek() {
  const peekKey = useAtomValue(peekKeyAtom)
  const [peeking, setPeeking] = useState<Peeking | undefined>(undefined)
  // The key that holds the peek open.
  const held = useRef<string | undefined>(undefined)
  const scrollRef = useRef<HTMLElement>(null)
  // False once the user scrolls the peek; until then it stays at the bottom.
  const stick = useRef(true)

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
      const id = rowToPeek(event.key)
      if (id === undefined) return
      if (event.key === ' ') {
        event.preventDefault()
        event.stopPropagation()
      }
      held.current = event.key
      stick.current = true
      setPeeking({ id, at: event.timeStamp })
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
  const open = peeking !== undefined
  useEffect(() => {
    if (!open) return
    const close = () => {
      held.current = undefined
      setPeeking(undefined)
    }
    const onPointerOver = (event: PointerEvent) => {
      const id = rowOf(event.target)?.dataset['topicId']
      if (id !== undefined) {
        stick.current = true
        setPeeking((current) => (current?.id === id ? current : { id, at: event.timeStamp }))
      } else if (!(event.target instanceof Element && event.target.closest(SECTION) !== null)) {
        close()
      }
    }
    const onWheel = (event: WheelEvent) => {
      const scroller = scrollRef.current
      if (scroller === null || !(event.target instanceof Element) || event.target.closest(SECTION) === null) return
      event.preventDefault()
      stick.current = false
      scroller.scrollBy({ top: event.deltaY, behavior: 'instant' })
    }
    window.addEventListener('pointerover', onPointerOver, true)
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('wheel', onWheel, { capture: true, passive: false })
    return () => {
      window.removeEventListener('pointerover', onPointerOver, true)
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('wheel', onWheel, true)
    }
  }, [open])

  const shown = useWhenReady(peeking)
  if (peeking === undefined || shown === undefined) return null
  return <PeekTopic key={shown.id} id={shown.id} at={shown.at} scrollRef={scrollRef} stick={stick} />
})

/** The topic's header and first window are local (or it failed, or is unknown): a peek at it can paint. */
function canPaint(id: string): boolean {
  const header = registry.get(topicAtom(id))
  if (header._tag === 'Failure') return true
  return header._tag === 'Success' && (header.value === null || registry.get(messageListAtom(id)).ready)
}

/**
 * The peek to draw: `peeking` once its topic can paint. Until then the
 * previous one stays, so moving from row to row never flashes an empty
 * popover. A topic the row's hover warmed can paint at once, before the
 * first frame.
 */
function useWhenReady(peeking: Peeking | undefined): Peeking | undefined {
  const [shown, setShown] = useState<Peeking | undefined>(undefined)
  // The peek whose topic arrived after it was asked for.
  const [arrived, setArrived] = useState<Peeking | undefined>(undefined)
  const ready = peeking !== undefined && (arrived === peeking || canPaint(peeking.id))
  const next = peeking === undefined ? undefined : ready ? peeking : shown
  if (next !== shown) setShown(next)
  useEffect(() => {
    if (peeking === undefined || ready) return
    const check = () => {
      if (canPaint(peeking.id)) setArrived(peeking)
    }
    // Each subscription also looks once now, in case the topic arrived after this render.
    const offs = [registry.subscribe(topicAtom(peeking.id), check, { immediate: true }), registry.subscribe(messageListAtom(peeking.id), check, { immediate: true })]
    return () => {
      for (const off of offs) off()
    }
  }, [peeking, ready])
  return next
}

const items = new WeakMap<MessageView, MessageListItem>()

/** The window's rows with their senders. A row keeps its object while its message and sender do. */
function itemsOf(window: MessageWindow): ReadonlyArray<MessageListItem> {
  return window.order.map((ts) => {
    const message = window.rows.get(ts)!
    const sender = message.senderId === undefined ? undefined : window.refs.people.get(message.senderId)
    const held = items.get(message)
    if (held !== undefined && held.sender === sender) return held
    const item = { message, sender }
    items.set(message, item)
    return item
  })
}

interface PeekTopicProps {
  readonly id: string
  /** The input that asked for this peek, on the `performance.now()` clock. */
  readonly at: number
  readonly scrollRef: RefObject<HTMLElement | null>
  readonly stick: RefObject<boolean>
}

/**
 * One peeked topic, at its newest messages. The list has no actions: no
 * toolbar, no reaction toggles, no thread links and no "new" divider. The
 * first frame draws only the rows that fit above the bottom; the rest
 * follow once it is on screen, in the place the list kept for them.
 */
function PeekTopic({ id, at, scrollRef, stick }: PeekTopicProps) {
  const result = useAtomValue(topicAtom(id))
  const detail = result._tag === 'Success' ? result.value : undefined
  const list = useAtomValue(messageListAtom(id))
  const now = useAtomValue(nowAtom, (time) => Math.floor(time / TIME_STEP) * TIME_STEP)
  const [drawnAll, setDrawnAll] = useState(false)

  // What Slack has that the store lacks. A fetch, never a read mark.
  const [fetchState, setFetchState] = useState<'pending' | 'done' | 'offline'>('pending')
  useEffect(() => {
    let live = true
    void fetchTopic(registry, id).then((exit) => {
      if (live) setFetchState(exit._tag === 'Success' && exit.value.outcome === 'offline' ? 'offline' : 'done')
    })
    return () => {
      live = false
    }
  }, [id])
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (fetchState !== 'pending') return
    const timer = setTimeout(() => setSlow(true), LOADING_DELAY_MS)
    return () => clearTimeout(timer)
  }, [fetchState])

  const shownAny = detail != null && list.ready
  // At the bottom before each paint, until the user scrolls the peek.
  useLayoutEffect(() => {
    const scroller = scrollRef.current
    if (scroller !== null && stick.current) scroller.scrollTop = scroller.scrollHeight
  })

  // `juno.peek-open`: from the key or the pointer to the first frame with the topic's messages.
  const measured = useRef(false)
  useLayoutEffect(() => {
    if (!shownAny || measured.current) return
    measured.current = true
    afterPaint(() => measure('juno.peek-open', at, { detail: { id, rows: list.order.length } }))
  }, [shownAny, at, id, list.order.length])

  useEffect(() => {
    if (shownAny && !drawnAll) afterPaint(() => startTransition(() => setDrawnAll(true)))
  }, [shownAny, drawnAll])

  if (detail == null) return null
  const all = itemsOf(list)
  const rows = Math.ceil(window.innerHeight / MIN_ROW_HEIGHT) + 2
  const from = drawnAll ? 0 : Math.max(0, all.length - rows)
  const shown = from === 0 ? all : all.slice(from)
  const eager = new Set(all.slice(-rows).map((item) => item.message.ts))
  const main = detail.kind === 'main'
  const status: MessageListStatus =
    all.length > 0 ? 'ready' : fetchState === 'offline' ? 'offline' : list.ready && fetchState === 'done' ? 'ready' : slow ? 'loading' : 'pending'

  return (
    <PeekView
      title={main ? detail.channel.label : detail.title}
      {...(main ? {} : { where: detail.channel.label })}
      {...(hasArt(detail) ? { art: <TopicArt topicId={detail.id} recipe={detail.art} size={20} /> } : {})}
    >
      <MessageList items={shown} eager={eager} notDrawnAbove={from} main={main} now={now} status={status} scrollRef={scrollRef} />
    </PeekView>
  )
}

/** The peek key preference, in the account menu until Preferences exists. */
export function PeekKeyPreference() {
  const peekKey = useAtomValue(peekKeyAtom)
  return <PeekKeySetting value={peekKey} onChange={changePeekKey} />
}

function changePeekKey(key: PeekKey): void {
  setPeekKey(registry, key)
}
