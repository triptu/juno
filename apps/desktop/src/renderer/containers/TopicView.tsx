import { memo, startTransition, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { MESSAGE_WINDOW_MAX, readsMarkRead, type MessageView, type TopicDetail } from '@juno/contract'
import {
  bottomWindow,
  channelThreadsAtom,
  dividerIndex,
  loadOlderMessages,
  messageListAtom,
  messageWindowSpecAtom,
  nowAtom,
  openExternal,
  openTopic as fetchTopic,
  registry,
  runCommand,
  scrollSnapshotAtom,
  shouldMarkRead,
  sidebarFilterAtom,
  topicAtom,
  type MessageWindow,
  type ScrollSnapshot,
} from '@juno/state'
import { afterPaint, measure } from '@juno/state/perf'
import { useAtomValue } from '@juno/state/react'
import {
  ActiveThreads,
  ComposerSlot,
  hueFor,
  MessageList,
  NewMessagesPill,
  TopicArt,
  TopicHeader,
  TopicView as TopicViewFrame,
  type ActivateEvent,
  type MessageListItem,
  type MessageListStatus,
  type OlderStatus,
} from '@juno/views'
import { markFilterChange } from './filterMark'
import { closeTopicTab, onLeaveTab, openTopic, takeOpenStart } from './navigation'

/** Within this of the end counts as at the bottom (performance 3.3). */
const BOTTOM_SLACK = 32
/** The "N new" divider's distance from the top of the list when a topic opens at it. */
const DIVIDER_TOP = 80
/** Rows each older page adds to the window. */
const OLDER_PAGE = 100
/** The next page is asked for when the first row comes this close to the top. */
const OLDER_MARGIN = '1000px 0px 0px 0px'
/** No "Loading messages" line before this (performance 4.4). */
const LOADING_DELAY_MS = 300
/** Message times change at most at a day boundary; re-render the rows for it this often, not every minute. */
const TIME_STEP = 10 * 60_000
/** The shortest a message row can be: the 32px avatar slot and its padding. */
const MIN_ROW_HEIGHT = 40

/**
 * Rows above the open position that the first frame draws: enough to fill
 * the window however short the rows are. The rest of the window is drawn
 * after that frame. `innerHeight` does not force a layout.
 */
function firstRows(): number {
  return Math.ceil(window.innerHeight / MIN_ROW_HEIGHT) + 2
}

const ROW = '[data-message-row]'

// Callbacks every row gets, created once and taking ids (performance 5.1).

function openThread(id: string, event: ActivateEvent): void {
  openTopic(id, { newTab: event.metaKey })
}

/** A #channel chip scopes the sidebar to that channel. */
function scopeToChannel(channel: string): void {
  markFilterChange()
  registry.set(sidebarFilterAtom, { ...registry.get(sidebarFilterAtom), scope: channel })
}

const markRead = (id: string) => runCommand(registry, readsMarkRead, { id })

const items = new WeakMap<MessageView, MessageListItem>()

/** The window's rows with their senders. A row keeps its object while its message and sender do, so `Message` stays memoized. */
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

const rowSelector = (ts: string) => `[data-message-row="${CSS.escape(ts)}"]`

/** The first row in view and its offset from the top of the scroller. */
function rowInView(scroller: HTMLElement): { readonly element: HTMLElement; readonly anchorKey: string; readonly offset: number } | undefined {
  const box = scroller.getBoundingClientRect()
  const element = document.elementFromPoint(box.left + box.width / 2, box.top + 1)?.closest<HTMLElement>(ROW) ?? scroller.querySelector<HTMLElement>(ROW)
  const anchorKey = element?.dataset['messageRow']
  if (element == null || anchorKey === undefined) return undefined
  return { element, anchorKey, offset: element.getBoundingClientRect().top - box.top }
}

function snapshotOf(scroller: HTMLElement): ScrollSnapshot | undefined {
  const row = rowInView(scroller)
  return row === undefined ? undefined : { anchorKey: row.anchorKey, offset: row.offset }
}

/**
 * The position the list goes back to whenever it changes under the user:
 * rows added above or below, the window resized. `bottom` keeps the end in
 * view; `row` keeps an element at an offset from the top (the divider on
 * open, a snapshot's row on restore, the row in view during a prepend)
 * until the user scrolls. It is applied in layout effects and the resize
 * event, before paint, and only ever writes `scrollTop`.
 */
type Pin = { readonly kind: 'bottom' } | { readonly kind: 'row'; readonly element: Element; readonly offset: number }

/** Puts the pinned row or the bottom back, and remembers the scrollTop it set. A row that left the list ends the pin. */
function hold(scroller: HTMLElement, pin: RefObject<Pin | undefined>, pinnedTop: RefObject<number>): void {
  const held = pin.current
  if (held === undefined) return
  if (held.kind === 'row' && !held.element.isConnected) {
    pin.current = undefined
    return
  }
  if (held.kind === 'bottom') scroller.scrollTop = scroller.scrollHeight
  else scroller.scrollTop += held.element.getBoundingClientRect().top - scroller.getBoundingClientRect().top - held.offset
  pinnedTop.current = scroller.scrollTop
}

/**
 * The rows laid out in full rather than at their size estimate, so the
 * position set before the first paint is where they end up: a window's
 * worth around the open position, and the last window's worth, where new
 * messages arrive and the bottom is held. Everywhere else the browser's
 * scroll anchoring absorbs rows growing as they come into view.
 */
function eagerRows(order: ReadonlyArray<string>, openAt: number, rows: number): ReadonlySet<string> {
  const eager = new Set<string>()
  for (let i = Math.max(0, openAt - rows); i < Math.min(order.length, openAt + rows); i++) eager.add(order[i]!)
  for (let i = Math.max(0, order.length - rows); i < order.length; i++) eager.add(order[i]!)
  return eager
}

/** The row the open position shows at the top: the snapshot's row, the first unread one, or the end. */
function openIndex(list: MessageWindow, divider: number, snapshot: ScrollSnapshot | undefined): number {
  const restored = snapshot === undefined ? -1 : list.order.indexOf(snapshot.anchorKey)
  return restored >= 0 ? restored : divider > 0 ? divider : list.order.length
}

function distanceFromBottom(scroller: HTMLElement): number {
  return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
}

function useWindowFocused(): boolean {
  const [focused, setFocused] = useState(() => document.hasFocus())
  useEffect(() => {
    const onFocus = () => setFocused(true)
    const onBlur = () => setFocused(false)
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
    }
  }, [])
  return focused
}

/** Main's "Threads" popover: the channel's active threads. Mounted only while open. */
function MainThreads({ channel, onClose }: { readonly channel: string; readonly onClose: () => void }) {
  const result = useAtomValue(channelThreadsAtom(channel))
  const now = useAtomValue(nowAtom)
  const window = result._tag === 'Success' ? result.value : undefined
  const threads = window === undefined ? [] : window.order.map((id) => window.rows.get(id)!)
  const open = (id: string, event: ActivateEvent) => {
    onClose()
    openTopic(id, { newTab: event.metaKey })
  }
  return <ActiveThreads threads={threads} now={now} status={window === undefined ? 'loading' : 'ready'} onOpen={open} />
}

/** Every topic draws its art (or the Tide placeholder) except a DM's Main, which keeps the person, as the sidebar tile does. */
export function hasArt(detail: TopicDetail): boolean {
  return !(detail.kind === 'main' && (detail.channel.kind === 'im' || detail.channel.kind === 'mpim'))
}

export interface TopicTabProps {
  readonly id: string
}

/**
 * One topic tab (spec section 7; performance 3.3, 4.3 and 4.5). The tab
 * lives in an `<Activity>`: while hidden its effects are gone, so it marks
 * nothing and asks for nothing, and its DOM keeps the scroll position.
 *
 * - Opens at the "N new" divider, 80px from the top, or at the bottom, in
 *   the layout effect of the first frame that has rows. A tab that was
 *   unmounted comes back at its `ScrollSnapshot` instead.
 * - The divider sits where the read pointer was when the tab first showed
 *   the topic, so marking read does not move it.
 * - At the bottom, a new message is scrolled into view before paint;
 *   scrolled up, the "N new messages" pill counts them.
 * - Near the top, the next older page is fetched, one request at a time,
 *   and the window widens; scroll anchoring keeps the rows in view still.
 * - Marks read by `shouldMarkRead`: on open and when shown, then at the
 *   bottom of a focused window.
 */
export const TopicTab = memo(function TopicTab({ id }: TopicTabProps) {
  const result = useAtomValue(topicAtom(id))
  const detail = result._tag === 'Success' ? result.value : undefined
  // A topic the store does not know (a saved tab whose topic is gone) closes its tab.
  useEffect(() => {
    if (detail === null) closeTopicTab(id)
  }, [id, detail])
  if (detail == null) return null
  return <Topic id={id} detail={detail} />
})

function Topic({ id, detail }: { readonly id: string; readonly detail: TopicDetail }) {
  const list = useAtomValue(messageListAtom(id))
  const now = useAtomValue(nowAtom, (time) => Math.floor(time / TIME_STEP) * TIME_STEP)
  const focused = useWindowFocused()
  const scrollRef = useRef<HTMLElement>(null)
  const anchorRef = useRef<HTMLDivElement>(null)

  // The read pointer when this tab first showed the topic, for the divider.
  const [readAtOpen] = useState(() => ({ lastReadTs: detail.lastReadTs }))
  const at = dividerIndex(list.order, readAtOpen.lastReadTs)
  const dividerBefore = at > 0 ? list.order[at] : undefined

  const [positioned, setPositioned] = useState(false)
  // Until the first frame is presented, only the rows from `firstRows()` above the open position down are drawn.
  const [drawnAll, setDrawnAll] = useState(false)
  const [atBottom, setAtBottom] = useState(true)
  const [far, setFar] = useState(false)
  // The newest message the user has seen at the bottom; the pill counts those after it.
  const [seenTs, setSeenTs] = useState<string | undefined>(undefined)
  // The position to hold (`Pin`), and the scrollTop it last set.
  const pin = useRef<Pin | undefined>(undefined)
  const pinnedTop = useRef(0)
  // The last message and window size the bottom was held for.
  const heldFor = useRef<string | undefined>(undefined)
  const last = list.order.at(-1)
  const first = list.order[0]
  // The window holds the newest message: no anchor.
  const atEnd = list.spec.anchor === undefined
  const lastRef = useRef(last)
  const atEndRef = useRef(atEnd)
  useLayoutEffect(() => {
    lastRef.current = last
    atEndRef.current = atEnd
  })

  // The open position, before the first frame with rows is painted.
  useLayoutEffect(() => {
    const scroller = scrollRef.current
    if (scroller === null || positioned || !list.ready || last === undefined) return
    const snapshot = registry.get(scrollSnapshotAtom(id))
    const row = snapshot === undefined ? null : scroller.querySelector(rowSelector(snapshot.anchorKey))
    pin.current =
      snapshot !== undefined && row !== null
        ? { kind: 'row', element: row, offset: snapshot.offset }
        : anchorRef.current !== null
          ? { kind: 'row', element: anchorRef.current, offset: DIVIDER_TOP }
          : { kind: 'bottom' }
    hold(scroller, pin, pinnedTop)
    const distance = distanceFromBottom(scroller)
    const bottom = atEnd && distance <= BOTTOM_SLACK
    if (bottom) {
      pin.current = { kind: 'bottom' }
      heldFor.current = `${last} ${window.innerWidth}x${window.innerHeight}`
    }
    setAtBottom(bottom)
    setFar(distance > scroller.clientHeight)
    setSeenTs(last)
    setPositioned(true)
  }, [id, positioned, list.ready, last, atEnd])

  // Rows added above the ones in view (the rest of the window after the first frame, an older page):
  // scroll anchoring keeps the rows in view still, except at offset 0, where Chromium does not anchor.
  useLayoutEffect(() => {
    const scroller = scrollRef.current
    if (scroller !== null && positioned) hold(scroller, pin, pinnedTop)
  }, [positioned, first, drawnAll])

  // A wider or narrower window reflows the rows; at the bottom, stay there. Resize runs before the frame's paint.
  useEffect(() => {
    const scroller = scrollRef.current
    if (scroller === null) return
    const onResize = () => {
      if (pin.current?.kind === 'bottom') hold(scroller, pin, pinnedTop)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // `juno.topic-open` (or `juno.tab-switch` back to an unmounted tab): to the first frame with the header and the list in place.
  useLayoutEffect(() => {
    if (!list.ready || (list.order.length > 0 && !positioned)) return
    const started = takeOpenStart(id)
    if (started !== undefined) afterPaint(() => measure(started.name, started.at, { detail: { id, rows: list.order.length } }))
  }, [id, list.ready, list.order.length, positioned])

  // The rows above the first frame's, once it is on screen; scroll anchoring keeps the rows in view still.
  useEffect(() => {
    if (positioned && !drawnAll) afterPaint(() => startTransition(() => setDrawnAll(true)))
  }, [positioned, drawnAll])

  // Stick to the bottom: a message that arrives while at the bottom is scrolled into view before paint.
  // A tab shown again with no new message and the same window size is still at the bottom (Chromium
  // keeps a hidden scroller's offset), so it skips the layout that reading the position would force.
  useLayoutEffect(() => {
    const scroller = scrollRef.current
    if (scroller === null || !positioned || pin.current?.kind !== 'bottom' || !atEnd) return
    const key = `${last} ${window.innerWidth}x${window.innerHeight}`
    if (heldFor.current === key) return
    heldFor.current = key
    hold(scroller, pin, pinnedTop)
    setSeenTs(last)
  }, [positioned, last, atEnd])

  // The user's own scrolling lets go of the pin; where the list comes to rest decides the next one.
  useEffect(() => {
    const scroller = scrollRef.current
    if (scroller === null) return
    const letGo = () => {
      pin.current = undefined
    }
    const record = () => registry.set(scrollSnapshotAtom(id), snapshotOf(scroller))
    const onScrollEnd = () => {
      if (pin.current?.kind === 'row' && Math.abs(scroller.scrollTop - pinnedTop.current) > 1) pin.current = undefined
      const distance = distanceFromBottom(scroller)
      const bottom = atEndRef.current && distance <= BOTTOM_SLACK
      if (bottom) pin.current = { kind: 'bottom' }
      else if (pin.current?.kind === 'bottom') pin.current = undefined
      setAtBottom(bottom)
      setFar(distance > scroller.clientHeight)
      if (bottom) setSeenTs(lastRef.current)
      record()
    }
    const inputs = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const
    for (const type of inputs) scroller.addEventListener(type, letGo, { passive: true })
    scroller.addEventListener('scrollend', onScrollEnd)
    // After a jump (End, a scrollbar drag, a script) the rows it brought near the view reach their real
    // height frames after the scroll ended, and Chromium does not always anchor that; so the position is
    // also recorded as the tab is left, from what is on screen then.
    const stopLeaving = onLeaveTab(id, record)
    return () => {
      for (const type of inputs) scroller.removeEventListener(type, letGo)
      scroller.removeEventListener('scrollend', onScrollEnd)
      stopLeaving()
    }
  }, [id])

  // Older pages. A thread whose root is in the window has nothing older.
  const [complete, setComplete] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const rootShown = first !== undefined && list.rows.get(first)?.root === true
  const windowFull = list.order.length >= list.spec.limit
  const older: OlderStatus = loadingOlder ? 'loading' : rootShown || (complete && !windowFull) ? 'none' : 'more'
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
          if (exit._tag === 'Success' && exit.value.complete) setComplete(true)
          const spec = registry.get(messageWindowSpecAtom(id))
          // Up to the cap the window grows at the top; past it, it holds the 500 rows from the new page down.
          const next =
            spec.anchor === undefined && spec.limit + OLDER_PAGE <= MESSAGE_WINDOW_MAX
              ? { limit: spec.limit + OLDER_PAGE }
              : { anchor: first, before: OLDER_PAGE, limit: MESSAGE_WINDOW_MAX }
          // Scroll anchoring keeps the rows in view still, except at offset 0, where Chromium does not anchor; the pin covers both.
          const inView = rowInView(scroller)
          if (inView !== undefined) {
            pin.current = { kind: 'row', element: inView.element, offset: inView.offset }
            pinnedTop.current = scroller.scrollTop
          }
          registry.set(messageWindowSpecAtom(id), next)
          setLoadingOlder(false)
        })
      },
      { root: scroller, rootMargin: OLDER_MARGIN },
    )
    observer.observe(row)
    return () => observer.disconnect()
  }, [id, drawnAll, older, first])

  // What Slack has that the store lacks, once per mount; a hidden tab coming back does not ask again.
  const [fetchState, setFetchState] = useState<'pending' | 'done' | 'offline'>('pending')
  const fetched = useRef(false)
  useEffect(() => {
    if (fetched.current) return
    fetched.current = true
    void fetchTopic(registry, id).then((exit) => setFetchState(exit._tag === 'Success' && exit.value.outcome === 'offline' ? 'offline' : 'done'))
  }, [id])
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (fetchState !== 'pending') return
    const timer = setTimeout(() => setSlow(true), LOADING_DELAY_MS)
    return () => clearTimeout(timer)
  }, [fetchState])

  // The read rule. Opening, and showing the tab again, marks the topic read.
  useEffect(() => {
    if (shouldMarkRead('open', { active: true, focused: true, atBottom: false })) void markRead(id)
  }, [id])
  const unread = detail.unreadCount
  useEffect(() => {
    if (unread === 0 || !positioned) return
    if (shouldMarkRead('bottom', { active: true, focused, atBottom })) void markRead(id)
  }, [id, unread, positioned, focused, atBottom])

  const jumpToLatest = () => {
    const scroller = scrollRef.current
    pin.current = { kind: 'bottom' }
    setAtBottom(true)
    setFar(false)
    if (!atEnd) registry.set(messageWindowSpecAtom(id), bottomWindow)
    if (scroller !== null) hold(scroller, pin, pinnedTop)
    setSeenTs(last)
  }

  const [threadsOpen, setThreadsOpen] = useState(false)
  const main = detail.kind === 'main'
  const channel = detail.channel.id
  // Main keeps its threads query live while shown, from after its first frame, so the Threads
  // popover opens with its rows in the first frame instead of "Loading threads".
  useEffect(() => (main && drawnAll ? registry.mount(channelThreadsAtom(channel)) : undefined), [main, drawnAll, channel])

  const people = list.refs.people
  const hueOf = (personId: string) => hueFor(people.get(personId)?.color ?? '', personId)

  const items = itemsOf(list)
  const rows = firstRows()
  const openAt = drawnAll ? list.order.length : openIndex(list, at, registry.get(scrollSnapshotAtom(id)))
  const from = drawnAll ? 0 : Math.max(0, openAt - rows)
  const shown = from === 0 ? items : items.slice(from)
  const eager = eagerRows(list.order, openAt, rows)

  const seenAt = seenTs === undefined ? -1 : list.order.indexOf(seenTs)
  const newCount = seenAt < 0 ? 0 : list.order.length - seenAt - 1
  const showPill = positioned && !atBottom && (newCount > 0 || far || !atEnd)

  // An empty list says nothing until Slack has answered or 300 ms have passed.
  const status: MessageListStatus =
    list.order.length > 0 ? 'ready' : fetchState === 'offline' ? 'offline' : list.ready && fetchState === 'done' ? 'ready' : slow ? 'loading' : 'pending'

  return (
    <TopicViewFrame
      header={
        <TopicHeader
          detail={detail}
          {...(hasArt(detail) ? { art: <TopicArt topicId={detail.id} recipe={detail.art} size={20} /> } : {})}
          threadsOpen={threadsOpen}
          onThreads={main ? setThreadsOpen : undefined}
          threads={threadsOpen ? <MainThreads channel={detail.channel.id} onClose={() => setThreadsOpen(false)} /> : null}
        />
      }
      pill={showPill ? <NewMessagesPill count={newCount} onJump={jumpToLatest} /> : undefined}
      composer={<ComposerSlot placeholder={main ? `Message ${detail.channel.label}` : 'Reply'} />}
    >
      <MessageList
        items={shown}
        eager={eager}
        notDrawnAbove={from}
        main={main}
        now={now}
        status={status}
        older={list.order.length === 0 ? 'none' : older}
        {...(dividerBefore === undefined ? {} : { dividerBefore })}
        scrollRef={scrollRef}
        anchorRef={anchorRef}
        hueOf={hueOf}
        onOpenThread={openThread}
        onChannel={scopeToChannel}
        onLink={openExternal}
      />
    </TopicViewFrame>
  )
}
