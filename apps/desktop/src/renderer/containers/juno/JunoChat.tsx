import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from 'react'
import { chatCopy, type BubbleId, type ChatItem, type ChatPage, type ChatWindow, type OpId, type Quote, type ReplyTarget, type SendContext } from '@juno/agent-contract'
import { copyText, junoFocusAtom, nowAtom, openExternal, popupContextMenu } from '@juno/state'
import { agentConnectionStateAtom, chatItemsAtom } from '@juno/state/agent'
import { afterPaint, measure } from '@juno/state/perf'
import { useAtomValue } from '@juno/state/react'
import {
  flashChatRow,
  JunoChatFrame,
  JunoChatList,
  JunoComposer,
  NewMessagesPill,
  type ActivateEvent,
  type ChatActions,
  type ChatMenuTarget,
  type ReactionPickerAt,
  type ReactionTarget,
} from '@juno/views'
import { openSlackMessage, openTopic } from '../navigation'
import { junoCommands, openJunoPage, takePanelOpenStart } from './actions'

type Window = typeof ChatWindow.Type

/** The agent's page limit: the most rows a window holds. */
const WINDOW = 200
/** The rows the panel opens with: more than its column shows. */
const PANEL_WINDOW = 40
/** Rows kept above the anchor when the window moves. */
const OVERLAP = 100
/** Within this of the end counts as at the bottom (performance 3.3). */
const BOTTOM_SLACK = 32
/** Where the "New" divider lands below the header band when the chat opens at it. */
const DIVIDER_GAP = 80
/** The edge slots ask for more this far before they come into view. */
const EDGE_MARGIN = '800px 0px'
/** A Juno bubble is read once fully on screen in the focused chat this long (SPEC 13.1). */
const READ_AFTER_MS = 1000
/** Times change at most at a day boundary; re-render for it this often. */
const TIME_STEP = 10 * 60_000

const latest: Window = { _tag: 'latest', limit: WINDOW }
const empty: ChatPage = { items: [], banner: { _tag: 'none' }, moreAbove: false, moreBelow: false, composerEnabled: true }
/** The agent is off: the chat says so and takes no input. */
const off: ChatPage = { ...empty, banner: { _tag: 'aiOff' }, composerEnabled: false }

/** A row's id the agent can anchor a window on. Separators and the status bubble have none. */
function nextAnchor(items: ReadonlyArray<ChatItem>, index: number): string | undefined {
  const next = items[index + 1]
  return next === undefined ? undefined : anchorOf(next)
}

function bubbleAfterDivider(items: ReadonlyArray<ChatItem>): string | undefined {
  const at = items.findIndex((item) => item._tag === 'newDivider')
  return at < 0 ? undefined : nextAnchor(items, at)
}

function anchorOf(item: ChatItem): string | undefined {
  switch (item._tag) {
    case 'owner':
      return item.id ?? item.opId
    case 'juno':
    case 'note':
    case 'groupLabel':
      return item.id
    case 'card':
      return item.card.id
    default:
      return undefined
  }
}

/** The DOM row of a reply target or a chat message, for scrolling to it. */
function rowOf(scroller: HTMLElement, target: ReplyTarget | { readonly _tag: 'message'; readonly id: string }): Element | null {
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

function quoteOf(items: ReadonlyArray<ChatItem>, target: ReactionTarget): Quote {
  const item = items.find((i) => (target._tag === 'bubble' ? i._tag === 'juno' && i.id === target.id : i._tag === 'card' && i.card.id === target.id))
  const preview = item?._tag === 'juno' ? item.body.map((part) => part.text).join('').trim().split('\n', 1)[0] ?? '' : item?._tag === 'card' ? item.card._tag : ''
  return { target, preview }
}

const distanceFromBottom = (scroller: HTMLElement) => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight

export interface JunoChatProps {
  /** `page` in the Juno tab, `panel` beside a topic. */
  readonly column: 'page' | 'panel'
  readonly header: (banner: ChatPage['banner']) => ReactNode
  /** What the next message is about, read at send time (the panel's topic, an About chip). */
  readonly contextOf?: () => SendContext | undefined
  /** Above the composer field: the panel's selection quote, About chip and Catch me up. */
  readonly composerContext?: ReactNode
  /** A message went out, with the context it carried. */
  readonly onSent?: (context: SendContext | undefined) => void
  /** Esc in the empty composer. */
  readonly onEscape?: () => void
  /** For the panel's Catch me up: sends `text` as if typed. */
  readonly sendRef?: RefObject<((text: string) => void) | null>
}

/**
 * The one Juno chat (SPEC 13.1), as the Juno tab and the panel show it.
 *
 * - The window is the agent's page: the tab opens at the "New" divider when
 *   Juno has said something unread, the panel at the bottom. The divider
 *   stays where it was when the chat showed. Near either
 *   edge it moves by `OVERLAP` rows; rows stay in flow, so scroll anchoring
 *   keeps the rows in view still. A window that reaches the newest row
 *   follows it (`latest`).
 * - At the bottom, a new row is scrolled into view before paint; scrolled
 *   up, the "New message" pill shows.
 * - A Juno bubble fully on screen for a second in the focused window is read.
 *   A hidden tab sits in `<Activity>` with its effects gone, so it reads
 *   nothing and takes no focus until shown.
 * - Sends show at once (`chatItemsAtom` holds them as `sending`).
 */
export function JunoChat({ column, header, contextOf, composerContext, onSent, onEscape, sendRef }: JunoChatProps) {
  const agent = useAtomValue(agentConnectionStateAtom)
  // The panel opens in one frame (performance 1), so it mounts a screenful and pages up from there.
  const [window, setWindow] = useState<Window>(() => (column === 'page' ? { _tag: 'unread', limit: WINDOW } : { _tag: 'latest', limit: PANEL_WINDOW }))
  const result = useAtomValue(chatItemsAtom(window))
  // The previous window's page shows until the next one arrives: never an empty list in between (performance 5.3).
  const [held, setHeld] = useState<ChatPage | undefined>(undefined)
  const current = result._tag === 'Success' ? result.value : undefined
  if (current !== undefined && current !== held) setHeld(current)
  // A window that reaches the newest row follows it from then on. Only its own page says so, not the one held from before.
  if (current !== undefined && !current.moreBelow && window._tag !== 'latest') setWindow(latest)
  const page = agent === 'off' ? off : (current ?? held ?? empty)
  const loaded = current !== undefined || held !== undefined || agent === 'off'
  const now = useAtomValue(nowAtom, (time) => Math.floor(time / TIME_STEP) * TIME_STEP)

  const scrollRef = useRef<HTMLElement>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  const topEdgeRef = useRef<HTMLDivElement>(null)
  const bottomEdgeRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // The "New" divider stays before the bubble it sat over when the chat showed, as a topic's does:
  // an answer that arrives while the chat is open gets none. A hidden tab takes it again when shown.
  const [dividerBefore, setDividerBefore] = useState<string | null | undefined>(undefined)
  if (dividerBefore === undefined && current !== undefined) setDividerBefore(bubbleAfterDivider(current.items) ?? null)
  useEffect(() => () => setDividerBefore(undefined), [])
  const items = useMemo(() => page.items.filter((item, i) => item._tag !== 'newDivider' || (dividerBefore != null && nextAnchor(page.items, i) === dividerBefore)), [page.items, dividerBefore])
  const last = items.at(-1)
  const lastKey = last === undefined ? undefined : `${last._tag}:${anchorOf(last) ?? ''}`
  const pageRef = useRef(page)
  useLayoutEffect(() => {
    pageRef.current = page
  })

  // Hold the bottom: true while the owner is at the end, or after a send.
  const pinned = useRef(true)
  const [positioned, setPositioned] = useState(false)
  const [atBottom, setAtBottom] = useState(true)
  // The newest of Juno's rows seen at the bottom; one that arrives while scrolled up shows the pill.
  const newestJuno = items.findLast((item) => item._tag === 'juno' || item._tag === 'card')
  const newestKey = newestJuno === undefined ? undefined : anchorOf(newestJuno)
  const [seenKey, setSeenKey] = useState(newestKey)
  if (atBottom && seenKey !== newestKey) setSeenKey(newestKey)
  const unseen = !atBottom && newestKey !== seenKey

  // The open position, before the first frame with rows is painted.
  useLayoutEffect(() => {
    const scroller = scrollRef.current
    if (scroller === null || positioned || !loaded) return
    const divider = anchorRef.current
    if (column === 'page' && divider !== null) {
      const padding = Number.parseFloat(getComputedStyle(scroller).scrollPaddingTop) || 0
      scroller.scrollTop += divider.getBoundingClientRect().top - scroller.getBoundingClientRect().top - padding - DIVIDER_GAP
      pinned.current = distanceFromBottom(scroller) <= BOTTOM_SLACK
    } else {
      scroller.scrollTop = scroller.scrollHeight
      pinned.current = true
    }
    setAtBottom(pinned.current)
    setPositioned(true)
    const opened = column === 'panel' ? takePanelOpenStart() : undefined
    if (opened !== undefined) afterPaint(() => measure('juno.panel-open', opened))
  }, [column, positioned, loaded])

  // `juno.chat-bubble`: from a send to the first Juno bubble after it, painted.
  // Keyed on the newest bubble, not a count: a full window drops a row for each one that arrives.
  const sentAt = useRef<{ readonly at: number; readonly newest: string | undefined } | undefined>(undefined)
  const newestBubble = items.findLast((item) => item._tag === 'juno')
  const newestBubbleId = newestBubble?._tag === 'juno' ? newestBubble.id : undefined
  useLayoutEffect(() => {
    const sent = sentAt.current
    if (sent === undefined || newestBubbleId === sent.newest) return
    sentAt.current = undefined
    afterPaint(() => measure('juno.chat-bubble', sent.at))
  }, [newestBubbleId])

  // At the bottom, a new row (a bubble, the status bubble, a send) is scrolled into view before paint.
  useLayoutEffect(() => {
    const scroller = scrollRef.current
    if (scroller === null || !positioned) return
    if (pinned.current && !page.moreBelow) scroller.scrollTop = scroller.scrollHeight
  }, [positioned, lastKey, items.length, page.moreBelow])

  // The owner's scrolling lets go of the bottom; where the list comes to rest decides whether it holds again.
  useEffect(() => {
    const scroller = scrollRef.current
    if (scroller === null) return
    const letGo = () => {
      pinned.current = false
    }
    const onScrollEnd = () => {
      const bottom = !pageRef.current.moreBelow && distanceFromBottom(scroller) <= BOTTOM_SLACK
      pinned.current = bottom
      setAtBottom(bottom)
    }
    const inputs = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const
    for (const type of inputs) scroller.addEventListener(type, letGo, { passive: true })
    scroller.addEventListener('scrollend', onScrollEnd)
    return () => {
      for (const type of inputs) scroller.removeEventListener(type, letGo)
      scroller.removeEventListener('scrollend', onScrollEnd)
    }
  }, [])

  // The edges ask for the rows beyond them.
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
  }, [positioned, page.moreAbove, page.moreBelow, firstAnchor, lastAnchor])

  // Read marks: unread Juno bubbles fully on screen for a second, while the window has focus.
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
  }, [positioned, items])

  // The composer: the draft, and the bubble or card a reply quotes.
  const [draft, setDraft] = useState('')
  const [quote, setQuote] = useState<Quote | undefined>(undefined)

  // ⌘J, Ask Juno and the sidebar's item ask for focus; the chat they name takes each request once, now or when it shows.
  const focusRequest = useAtomValue(junoFocusAtom)
  const focusTaken = useRef(0)
  useEffect(() => {
    if (focusRequest.where !== (column === 'page' ? 'tab' : 'panel') || focusRequest.n <= focusTaken.current) return
    focusTaken.current = focusRequest.n
    // After the input that asked: a sidebar item acts on pointerdown, and the mousedown that follows focuses the item.
    const frame = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [column, focusRequest])

  const toBottom = () => {
    pinned.current = true
    setAtBottom(true)
    if (pageRef.current.moreBelow) setWindow(latest)
    const scroller = scrollRef.current
    if (scroller !== null) scroller.scrollTop = scroller.scrollHeight
  }

  const send = (text: string) => {
    const at = performance.now()
    sentAt.current = { at, newest: newestBubbleId }
    afterPaint(() => measure('juno.chat-send', at))
    const context = contextOf?.()
    junoCommands.send(text, { ...(context === undefined ? {} : { context }), ...(quote === undefined ? {} : { replyTo: quote.target }) })
    setQuote(undefined)
    toBottom()
    onSent?.(context)
  }
  const sendRefCurrent = useRef(send)
  useLayoutEffect(() => {
    sendRefCurrent.current = send
  })
  useLayoutEffect(() => {
    if (sendRef === undefined) return
    sendRef.current = (text: string) => sendRefCurrent.current(text)
    return () => {
      sendRef.current = null
    }
  }, [sendRef])

  const [picker, setPicker] = useState<{ readonly target: ReactionTarget; readonly x: number; readonly y: number } | undefined>(undefined)

  const scrollTo = (target: ReplyTarget | { readonly _tag: 'message'; readonly id: string }) => {
    const scroller = scrollRef.current
    const row = scroller === null ? null : rowOf(scroller, target)
    if (row === null) return
    pinned.current = false
    row.scrollIntoView({ block: 'center', behavior: 'instant' })
    flashChatRow(row)
  }

  // Callbacks every row gets, stable for the chat's life (performance 5.1); they read the latest state through refs.
  const itemsRef = useRef(items)
  useLayoutEffect(() => {
    itemsRef.current = items
  })
  const actions = useMemo<ChatActions>(
    () => ({
      // A `signIn` outcome is the container's: main's T3 Code sign-in window, which comes with WP18.
      onCard: (id, command) => void junoCommands.onCard(id, command),
      onOpen: (target, event: ActivateEvent) => {
        switch (target._tag) {
          case 'topic':
            return openTopic(target.topicId, { newTab: event.metaKey })
          case 'chatMessage':
            return scrollTo({ _tag: 'message', id: target.messageId })
          case 'message':
            return void openSlackMessage(target.channelId, target.ts, { newTab: event.metaKey })
          case 'url':
            return openExternal(target.url)
          case 'page':
            return openJunoPage(target.page)
        }
      },
      onRetry: (opId: OpId) => junoCommands.onRetry(opId),
      onReactions: (target, event: MouseEvent<HTMLElement>) => {
        const box = event.currentTarget.getBoundingClientRect()
        setPicker({ target, x: box.right, y: box.bottom })
      },
      onReply: (target) => {
        setQuote(quoteOf(itemsRef.current, target))
        inputRef.current?.focus()
      },
      onQuote: (target) => scrollTo(target),
      // Remembered notes and group labels need the agent's pins and schedules, which it does not serve yet.
      onUndoNote: () => {},
      onGroupLabel: () => {},
      onContextMenu: (target: ChatMenuTarget, event: MouseEvent<HTMLElement>) => {
        event.preventDefault()
        void showChatMenu(target, itemsRef.current, (reaction) => {
          const box = event.currentTarget.getBoundingClientRect()
          setPicker({ target: reaction, x: box.right, y: box.top })
        }, (reply) => {
          setQuote(quoteOf(itemsRef.current, reply))
          inputRef.current?.focus()
        })
      },
    }),
    [],
  )

  const pickerAt: ReactionPickerAt | undefined =
    picker === undefined
      ? undefined
      : {
          x: picker.x,
          y: picker.y,
          ...selectedOf(items, picker.target),
          onPick: (emoji) => {
            setPicker(undefined)
            void junoCommands.react(picker.target, emoji)
          },
          onClose: () => setPicker(undefined),
        }

  return (
    <JunoChatFrame
      header={header(page.banner)}
      pill={positioned && !atBottom && (unseen || page.moreBelow) ? <NewMessagesPill count={0} label={chatCopy.list.newMessage} onJump={toBottom} /> : undefined}
      composer={
        <JunoComposer
          column={column}
          value={draft}
          onChange={setDraft}
          onSend={() => {
            const text = draft.trim()
            if (text === '') return
            setDraft('')
            send(text)
          }}
          {...(onEscape === undefined ? {} : { onEscape })}
          {...(quote === undefined ? {} : { quote, onClearQuote: () => setQuote(undefined) })}
          enabled={page.composerEnabled}
          {...(column === 'panel' ? { placeholder: chatCopy.composer.panelPlaceholder } : {})}
          inputRef={inputRef}
          context={composerContext}
        />
      }
      {...(pickerAt === undefined ? {} : { picker: pickerAt })}
    >
      <JunoChatList
        column={column}
        items={items}
        banner={page.banner}
        moreAbove={page.moreAbove}
        moreBelow={page.moreBelow}
        now={now}
        actions={actions}
        onSuggest={(text) => send(text)}
        scrollRef={scrollRef}
        anchorRef={anchorRef}
        topEdgeRef={topEdgeRef}
        bottomEdgeRef={bottomEdgeRef}
        enterEmpty={loaded && agent !== 'off'}
      />
    </JunoChatFrame>
  )
}

/** The owner's current reaction on a bubble or card, for the picker. */
function selectedOf(items: ReadonlyArray<ChatItem>, target: ReactionTarget): { readonly selected?: string } {
  const item = items.find((i) => (target._tag === 'bubble' ? i._tag === 'juno' && i.id === target.id : i._tag === 'card' && i.card.id === target.id))
  const reactions = item?._tag === 'juno' ? item.reactions : item?._tag === 'card' ? item.reactions : []
  const mine = reactions.find((reaction) => reaction.by === 'owner')
  return mine === undefined ? {} : { selected: mine.emoji }
}

/**
 * The native menu on a chat message (SPEC 13.1): Copy, React and Reply on
 * Juno's, Remember this on the owner's, Remove. Remember this and Remove
 * wait for the agent's pins and removal, so they show disabled.
 */
async function showChatMenu(target: ChatMenuTarget, items: ReadonlyArray<ChatItem>, react: (target: ReactionTarget) => void, reply: (target: ReactionTarget) => void): Promise<void> {
  const copy = chatCopy.contextMenu
  const juno = target.kind !== 'owner'
  const chosen = await popupContextMenu([
    { id: 'copy', label: copy.copy },
    ...(juno ? [{ id: 'react', label: chatCopy.react.react }, { id: 'reply', label: chatCopy.react.reply }] : [{ id: 'remember', label: copy.remember, enabled: false }]),
    { separator: true },
    { id: 'remove', label: copy.remove, enabled: false },
  ])
  const reaction: ReactionTarget | undefined = target.kind === 'juno' ? { _tag: 'bubble', id: target.id } : target.kind === 'card' ? { _tag: 'card', id: target.id } : undefined
  switch (chosen) {
    case 'copy': {
      const selection = globalThis.getSelection()?.toString() ?? ''
      const item = items.find((i) => (target.kind === 'owner' ? i._tag === 'owner' && i.opId === target.opId : target.kind === 'juno' ? i._tag === 'juno' && i.id === target.id : false))
      const text = item?._tag === 'owner' ? item.text : item?._tag === 'juno' ? item.body.map((part) => part.text).join('') : ''
      return copyText(selection !== '' ? selection : text)
    }
    case 'react':
      if (reaction !== undefined) react(reaction)
      return
    case 'reply':
      if (reaction !== undefined) reply(reaction)
      return
  }
}
