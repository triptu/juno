import { memo, startTransition, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { MESSAGE_WINDOW_MAX, readsMarkRead, type MessageView, type TopicDetail } from '@juno/contract'
import {
  bottomWindow,
  catchUpDoneAtom,
  channelThreadsAtom,
  discardMessage,
  dividerIndex,
  headerRenamingAtom,
  junoAgentOnAtom,
  junoPanelOpenAtom,
  loadOlderMessages,
  messageFlashAtom,
  messageListAtom,
  messageWindowSpecAtom,
  nowAtom,
  openExternal,
  openedAtNewAtom,
  openTopic as fetchTopic,
  registry,
  retryMessage,
  runCommand,
  scrollSnapshotAtom,
  shouldMarkRead,
  topicAtom,
  type MessageWindow,
  type ScrollSnapshot,
} from '@juno/state'
import { afterPaint, measure } from '@juno/state/perf'
import { useAtomValue } from '@juno/state/react'
import {
  ActiveThreads,
  flashChatRow,
  hueFor,
  MessageList,
  NewMessagesPill,
  TopicHeader,
  TopicView as TopicViewFrame,
  type ActivateEvent,
  type MenuAnchor,
  type MessageListItem,
  type MessageListStatus,
  type OlderStatus,
} from '@juno/views'
import { toggleJunoPanel } from './juno/actions'
import { closeTabById, onLeaveTab, openTopic, takeOpenStart } from './navigation'
import { useMessageActions, type ComposerHandle } from './messageActions'
import { showPersonMenu } from './notifyActions'
import { scopeToChannel, showChannelMenu } from './placeMenus'
import { takeSendMark } from './sendMark'
import { TopicComposer } from './TopicComposer'
import { cancelRename, renameTopic, showTopicMenu, toggleResolved } from './topicActions'

/**
 * The divider's offset from the scroller's top on open: 80px below the
 * header band, which the list runs under (inventory 5). The band's height
 * is the scroller's `scroll-padding-top`, so the token stays the one source.
 */
function dividerTop(scroller: HTMLElement): number {
  return (Number.parseFloat(getComputedStyle(scroller).scrollPaddingTop) || 0) + DIVIDER_GAP
}

/** Within this of the end counts as at the bottom (performance 3.3). */
const BOTTOM_SLACK = 32
/** How far below the header band the "N new" divider lands when a topic opens at it. */
const DIVIDER_GAP = 80
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

const personMenu = (person: { readonly id: string; readonly name: string }) => void showPersonMenu(person)

const markRead = (id: string) => runCommand(registry, readsMarkRead, { id })
const retry = (clientMsgId: string) => void retryMessage(registry, clientMsgId)
const discard = (clientMsgId: string) => void discardMessage(registry, clientMsgId)

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
  /** The tab that shows the topic. */
  readonly tabId: string
  /** The topic. */
  readonly id: string
}

/**
 * One topic tab (spec section 7; performance 3.3, 4.3 and 4.5). The tab
 * lives in an `<Activity>`: while hidden its effects are gone, so it marks
 * nothing and asks for nothing, and its DOM keeps the scroll position.
 *
 * - Opens at the "N new" divider, 80px below the header band, or at the bottom, in
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
export const TopicTab = memo(function TopicTab({ tabId, id }: TopicTabProps) {
  const result = useAtomValue(topicAtom(id))
  const detail = result._tag === 'Success' ? result.value : undefined
  // A topic the store does not know (a saved tab whose topic is gone) closes its tab.
  useEffect(() => {
    if (detail === null) closeTabById(tabId)
  }, [tabId, detail])
  if (detail == null) return null
  return <Topic id={id} detail={detail} />
})

/** Thread links in a preview open in a new tab, so the New chat and its draft stay. */
function openThreadInNewTab(id: string): void {
  openTopic(id, { newTab: true })
}

/**
 * A topic's latest messages, read-only: New chat's preview (spec section 9),
 * and the same for peek (section 5). The list alone, with no header or
 * composer, in `readOnly` mode (see `TopicProps`).
 */
export const TopicPreview = memo(function TopicPreview({ id, underHeader = true }: { readonly id: string; readonly underHeader?: boolean }) {
  const result = useAtomValue(topicAtom(id))
  const detail = result._tag === 'Success' ? result.value : undefined
  if (detail == null) return null
  return <Topic key={id} id={id} detail={detail} readOnly underHeader={underHeader} />
})

interface TopicProps {
  readonly id: string
  readonly detail: TopicDetail
  /**
   * Read-only: the message list alone, opened at the bottom, with no "N new"
   * divider; nothing is marked read, the tab's scroll snapshot is neither
   * read nor written, and thread links open in a new tab. Otherwise the
   * topic as a tab shows it, with its header and composer.
   */
  readonly readOnly?: boolean
  /** The list runs under a floating header. Default true; peek has none. */
  readonly underHeader?: boolean
}

function Topic({ id, detail, readOnly = false, underHeader = true }: TopicProps) {
  const list = useAtomValue(messageListAtom(id))
  const now = useAtomValue(nowAtom, (time) => Math.floor(time / TIME_STEP) * TIME_STEP)
  const focused = useWindowFocused()
  const scrollRef = useRef<HTMLElement>(null)
  const anchorRef = useRef<HTMLDivElement>(null)

  // The read pointer when this tab first showed the topic, for the divider.
  const [readAtOpen] = useState(() => ({ lastReadTs: detail.lastReadTs }))
  const at = readOnly ? -1 : dividerIndex(list.order, readAtOpen.lastReadTs, (ts) => list.rows.get(ts)?.fromMe === true)
  const dividerBefore = at > 0 ? list.order[at] : undefined

  // The Juno panel offers Catch me up while the topic opened at a "new" divider (SPEC 7); a new divider offers it again.
  useEffect(() => {
    if (readOnly || registry.get(openedAtNewAtom(id)) === dividerBefore) return
    registry.set(openedAtNewAtom(id), dividerBefore)
    registry.set(catchUpDoneAtom(id), false)
  }, [id, readOnly, dividerBefore])
  const agentOn = useAtomValue(junoAgentOnAtom)
  const panelOpen = useAtomValue(junoPanelOpenAtom)

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
  // The rows and window size the bottom was held for.
  const heldFor = useRef<{ readonly rows: MessageWindow['rows']; readonly size: string } | undefined>(undefined)
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
    const snapshot = readOnly ? undefined : registry.get(scrollSnapshotAtom(id))
    const row = snapshot === undefined ? null : scroller.querySelector(rowSelector(snapshot.anchorKey))
    pin.current =
      snapshot !== undefined && row !== null
        ? { kind: 'row', element: row, offset: snapshot.offset }
        : anchorRef.current !== null
          ? { kind: 'row', element: anchorRef.current, offset: dividerTop(scroller) }
          : { kind: 'bottom' }
    hold(scroller, pin, pinnedTop)
    const distance = distanceFromBottom(scroller)
    const bottom = atEnd && distance <= BOTTOM_SLACK
    if (bottom) {
      pin.current = { kind: 'bottom' }
      heldFor.current = { rows: list.rows, size: `${window.innerWidth}x${window.innerHeight}` }
    }
    setAtBottom(bottom)
    setFar(distance > scroller.clientHeight)
    setSeenTs(last)
    setPositioned(true)
  }, [id, readOnly, positioned, list.ready, list.rows, last, atEnd])

  // A Juno source link asked for a message: once the topic is positioned, it is scrolled into view if it is not, and flashes.
  const flash = useAtomValue(messageFlashAtom(id))
  useEffect(() => {
    const scroller = scrollRef.current
    if (readOnly || flash === undefined || !positioned || scroller === null) return
    afterPaint(() => {
      const row = scroller.querySelector(rowSelector(flash.ts))
      if (row === null) return
      const box = row.getBoundingClientRect()
      const view = scroller.getBoundingClientRect()
      if (box.top < view.top || box.bottom > view.bottom) row.scrollIntoView({ block: 'center', behavior: 'instant' })
      flashChatRow(row)
    })
  }, [readOnly, flash, positioned])

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

  // Stick to the bottom: a message that arrives, or a row that grows (a reaction, an edit), while at the
  // bottom is scrolled into view before paint. Rows keep their identity until a row changes, so a tab
  // shown again with nothing new and the same window size is still at the bottom (Chromium keeps a
  // hidden scroller's offset), and skips the layout that reading the position would force.
  useLayoutEffect(() => {
    const scroller = scrollRef.current
    if (scroller === null || !positioned || pin.current?.kind !== 'bottom' || !atEnd) return
    const size = `${window.innerWidth}x${window.innerHeight}`
    if (heldFor.current?.rows === list.rows && heldFor.current.size === size) return
    heldFor.current = { rows: list.rows, size }
    hold(scroller, pin, pinnedTop)
    setSeenTs(last)
  }, [positioned, list.rows, last, atEnd])

  // `juno.send`: from Enter to the frame that shows the message, pending or, after a very quick answer, settled.
  useLayoutEffect(() => {
    if (last !== undefined && list.rows.get(last)?.fromMe === true && takeSendMark()) afterPaint(() => measure('juno.send', 'juno.send'))
  }, [last, list.rows])

  // The user's own scrolling lets go of the pin; where the list comes to rest decides the next one.
  useEffect(() => {
    const scroller = scrollRef.current
    if (scroller === null) return
    const letGo = () => {
      pin.current = undefined
    }
    const record = () => {
      if (!readOnly) registry.set(scrollSnapshotAtom(id), snapshotOf(scroller))
    }
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
    const stopLeaving = readOnly ? () => {} : onLeaveTab(id, record)
    return () => {
      for (const type of inputs) scroller.removeEventListener(type, letGo)
      scroller.removeEventListener('scrollend', onScrollEnd)
      stopLeaving()
    }
  }, [id, readOnly])

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

  // The read rule. Opening, and showing the tab again, marks the topic read. A preview never does.
  useEffect(() => {
    if (!readOnly && shouldMarkRead('open', { active: true, focused: true, atBottom: false })) void markRead(id)
  }, [id, readOnly])
  const unread = detail.unreadCount
  useEffect(() => {
    if (readOnly || unread === 0 || !positioned) return
    if (shouldMarkRead('bottom', { active: true, focused, atBottom })) void markRead(id)
  }, [id, readOnly, unread, positioned, focused, atBottom])

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
  // The title's native menu: the title shows it open until the menu closes.
  const [menuOpen, setMenuOpen] = useState(false)
  const openMenu = (at: MenuAnchor) => {
    setMenuOpen(true)
    void showTopicMenu(detail, 'header', at).finally(() => setMenuOpen(false))
  }
  const renaming = useAtomValue(headerRenamingAtom(detail.id))
  const channel = detail.channel.id
  // Main keeps its threads query live while shown, from after its first frame, so the Threads
  // popover opens with its rows in the first frame instead of "Loading threads".
  useEffect(() => (main && drawnAll && !readOnly ? registry.mount(channelThreadsAtom(channel)) : undefined), [main, drawnAll, readOnly, channel])

  const composer = useRef<ComposerHandle>(null)
  const messageActions = useMessageActions({ detail, list, scrollRef, composer })

  const people = list.refs.people
  const hueOf = (personId: string) => hueFor(people.get(personId)?.color ?? '', personId)

  const items = itemsOf(list)
  const rows = firstRows()
  const openAt = drawnAll ? list.order.length : openIndex(list, at, readOnly ? undefined : registry.get(scrollSnapshotAtom(id)))
  const from = drawnAll ? 0 : Math.max(0, openAt - rows)
  const shown = from === 0 ? items : items.slice(from)
  const eager = eagerRows(list.order, openAt, rows)

  const seenAt = seenTs === undefined ? -1 : list.order.indexOf(seenTs)
  // The user's own messages, sent or still sending, are never new to them.
  const newCount = seenAt < 0 ? 0 : list.order.slice(seenAt + 1).filter((ts) => list.rows.get(ts)?.fromMe !== true).length
  const showPill = positioned && !atBottom && (newCount > 0 || far || !atEnd)

  // An empty list says nothing until Slack has answered or 300 ms have passed.
  const status: MessageListStatus =
    list.order.length > 0 ? 'ready' : fetchState === 'offline' ? 'offline' : list.ready && fetchState === 'done' ? 'ready' : slow ? 'loading' : 'pending'

  const messages = (
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
      underHeader={underHeader}
      anchorRef={anchorRef}
      hueOf={hueOf}
      onOpenThread={readOnly ? openThreadInNewTab : openThread}
      onChannel={scopeToChannel}
      onLink={openExternal}
      {...(readOnly
        ? {}
        : {
            onRetry: retry,
            onDiscard: discard,
            onMessageMenu: messageActions.onMessageMenu,
            actions: messageActions.actions,
            confirmingDelete: messageActions.confirmingDelete,
            editing: messageActions.editing,
            onRowKey: messageActions.onRowKey,
            onToggleReaction: messageActions.onToggleReaction,
            onPersonMenu: personMenu,
            onChannelMenu: (chip: { readonly id: string; readonly name: string }) => {
              const known = list.refs.channels.get(chip.id)
              void showChannelMenu(known ?? { id: chip.id, kind: 'public', name: chip.name, label: `#${chip.name}`, tint: 'public' })
            },
          })}
    />
  )
  if (readOnly) return messages

  const sent = () => {
    jumpToLatest()
    void markRead(id)
  }

  return (
    <TopicViewFrame
      header={
        <TopicHeader
          detail={detail}
          menuOpen={menuOpen}
          onMenu={openMenu}
          onPill={() => scopeToChannel(detail.channel.id)}
          onPillMenu={() => void showChannelMenu(detail.channel)}
          {...(agentOn ? { juno: { open: panelOpen, onToggle: toggleJunoPanel } } : {})}
          {...(renaming ? { rename: { onSave: (title: string) => renameTopic(detail.id, title), onCancel: cancelRename } } : {})}
          {...(main ? {} : { onResolve: () => toggleResolved(detail.id) })}
          threadsOpen={threadsOpen}
          {...(main ? { onThreads: setThreadsOpen } : {})}
          threads={threadsOpen ? <MainThreads channel={detail.channel.id} onClose={() => setThreadsOpen(false)} /> : null}
        />
      }
      pill={showPill ? <NewMessagesPill count={newCount} onJump={jumpToLatest} /> : undefined}
      composer={<TopicComposer key={id} detail={detail} onSent={sent} handle={composer} onArrowUpEmpty={messageActions.selectNewest} />}
      floating={messageActions.floating}
    >
      {messages}
    </TopicViewFrame>
  )
}
