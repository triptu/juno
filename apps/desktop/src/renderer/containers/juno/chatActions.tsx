/**
 * What the chat's rows and composer do (see `JunoChat`): sending, focus
 * requests, the remove sheet and the row callbacks.
 */
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type MouseEvent, type RefObject, type SetStateAction } from 'react'
import { junoText, type ChatItem, type ChatMention, type ChatPage, type JunoFileInput, type JunoPage, type MessageMenu, type OpId, type Reaction, type Quote, type SendContext } from '@juno/agent-contract'
import { junoFocusAtom, registry } from '@juno/state'
import { junoThumbAtom, messageActions } from '@juno/state/agent'
import { afterPaint, measure } from '@juno/state/perf'
import { useAtomValue } from '@juno/state/react'
import { openOnRelease, OwnerImage, ReactionBadge, RemoveSheet, SheetLayer, type ActivateEvent, type ChatActions, type ChatMenuTarget, type OwnerImageFile, type ReactionTarget } from '@juno/views'
import { openSlackMessage, openTopic } from '../navigation'
import { chunk } from '../chunks'
import { withMenus } from '../messageMenu'
import type { ChatSpan } from './chatMenu'
import { openWebLink } from '../slackLinks'
import { junoCommands } from './actions'
import { scrollToRow, toEnd } from './chatScroll'
import { latest, type Window } from './chatWindow'

const messages = messageActions(registry)

type Removal = typeof MessageMenu.Type

interface SendInput {
  readonly contextOf: (() => SendContext | undefined) | undefined
  readonly onSent: ((context: SendContext | undefined) => void) | undefined
  readonly quote: Quote | undefined
  readonly setQuote: Dispatch<SetStateAction<Quote | undefined>>
  readonly sentAtRef: RefObject<{ readonly at: number; readonly newest: string | undefined } | undefined>
  readonly newestBubbleId: string | undefined
  readonly scrollRef: RefObject<HTMLElement | null>
  readonly pinnedRef: RefObject<boolean>
  readonly pageRef: RefObject<ChatPage>
  readonly setAtBottom: Dispatch<SetStateAction<boolean>>
  readonly setWindow: Dispatch<SetStateAction<Window>>
}

/** Sending: the message goes out with its context and quote, and the list goes to the bottom. */
export function useChatSend({ contextOf, onSent, quote, setQuote, sentAtRef, newestBubbleId, scrollRef, pinnedRef, pageRef, setAtBottom, setWindow }: SendInput) {
  const toBottom = () => {
    pinnedRef.current = true
    setAtBottom(true)
    if (pageRef.current.moreBelow) setWindow(latest)
    const scroller = scrollRef.current
    if (scroller !== null) toEnd(scroller)
  }

  const send = (text: string, files: ReadonlyArray<JunoFileInput> = [], mentions: ReadonlyArray<ChatMention> = []) => {
    const at = performance.now()
    sentAtRef.current = { at, newest: newestBubbleId }
    afterPaint(() => measure('juno.chat-send', at))
    const context = contextOf?.()
    junoCommands.send(text, { ...(context === undefined ? {} : { context }), ...(quote === undefined ? {} : { replyTo: quote.target }), ...(files.length === 0 ? {} : { files }), ...(mentions.length === 0 ? {} : { mentions }) })
    setQuote(undefined)
    toBottom()
    onSent?.(context)
  }
  return { toBottom, send }
}

/** ⌘J, Ask Juno and the sidebar's item ask for focus; the chat they name takes each request once, now or when it shows. */
export function useFocusRequest(column: 'page' | 'panel', inputRef: RefObject<HTMLTextAreaElement | null>): void {
  const focusRequest = useAtomValue(junoFocusAtom)
  const focusTaken = useRef(0)
  useEffect(() => {
    if (focusRequest.where !== (column === 'page' ? 'tab' : 'panel') || focusRequest.n <= focusTaken.current) return
    focusTaken.current = focusRequest.n
    // The open panel already has focus: a later frame must not take it back from the chip.
    if (column === 'panel' && document.activeElement === inputRef.current) return
    // After the input that asked: a sidebar item acts on pointerdown, and the mousedown that follows focuses the item.
    const frame = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [column, focusRequest, inputRef])
}

/** An owner image's thumbnail, from the agent or from the send that is on its way. */
function OwnerThumb({ opId, file }: { readonly opId: OpId; readonly file: OwnerImageFile }) {
  const src = useAtomValue(junoThumbAtom(`${opId}:${file.n}`), (result) => (result._tag === 'Success' && result.value !== null ? result.value : undefined))
  return <OwnerImage file={file} src={src} />
}

const reactionBadge = chunk(() => import('./WorkspaceReactionBadge'))
const WorkspaceReactionBadge = reactionBadge.component((module) => module.default)
const renderReactions = (reactions: ReadonlyArray<Reaction>, corner: 'start' | 'end') => reactions.length === 0 ? null : (
  <Suspense fallback={<ReactionBadge reactions={reactions} corner={corner} />}><WorkspaceReactionBadge reactions={reactions} corner={corner} /></Suspense>
)

const renderOwnerImage = (opId: OpId, file: OwnerImageFile) => <OwnerThumb opId={opId} file={file} />

/** The remove sheet a message's menu opens, and the removal it confirms. */
export function useRemoval(now: number) {
  const [removal, setRemoval] = useState<Removal | undefined>(undefined)
  const [removing, setRemoving] = useState(false)
  const sheet =
    removal === undefined ? null : (
      <SheetLayer onClose={() => { if (!removing) setRemoval(undefined) }}>
        <RemoveSheet sheet={removal.sheet} now={now} onKeep={() => { if (!removing) setRemoval(undefined) }} onRemove={(alsoReply) => {
          if (removing) return
          setRemoving(true)
          void messages.remove(removal.messageId, alsoReply).then((done) => { setRemoving(false); if (done) setRemoval(undefined) })
        }} />
      </SheetLayer>
    )
  return { setRemoval, sheet }
}

interface ActionsInput {
  readonly items: ReadonlyArray<ChatItem>
  readonly scrollRef: RefObject<HTMLElement | null>
  readonly pinnedRef: RefObject<boolean>
  readonly inputRef: RefObject<HTMLTextAreaElement | null>
  readonly setQuote: Dispatch<SetStateAction<Quote | undefined>>
  readonly setRemoval: Dispatch<SetStateAction<Removal | undefined>>
  /** A link to a Juno page ("Show in Activity"): in the chat's own tab or panel. */
  readonly openPage: (page: JunoPage) => void
}

/** Callbacks every row gets, stable for the chat's life (performance 5.1); they read the latest state through refs. */
export function useChatActions({ items, scrollRef, pinnedRef, inputRef, setQuote, setRemoval, openPage }: ActionsInput): ChatActions {
  const itemsRef = useRef(items)
  const openPageRef = useRef(openPage)
  useLayoutEffect(() => {
    itemsRef.current = items
    openPageRef.current = openPage
  })
  return useMemo<ChatActions>(
    () => ({
      // A `signIn` outcome is the container's: main's T3 Code sign-in window, which comes with WP18.
      onCard: (id, command) => void junoCommands.onCard(id, command),
      onOpen: (target, event: ActivateEvent) => {
        switch (target._tag) {
          case 'topic':
            return openTopic(target.topicId, { newTab: event.metaKey })
          case 'chatMessage':
            return scrollToRow(scrollRef, pinnedRef, { _tag: 'message', id: target.messageId })
          case 'message':
            return void openSlackMessage(target.channelId, target.ts, { newTab: event.metaKey })
          case 'url':
            return openWebLink(target.url, event)
          case 'page':
            return openPageRef.current(target.page)
        }
      },
      onRetry: (opId: OpId) => junoCommands.onRetry(opId),
      onReply: (target) => {
        setQuote(quoteOf(itemsRef.current, target))
        inputRef.current?.focus()
      },
      onQuote: (target) => scrollToRow(scrollRef, pinnedRef, target),
      onUndoNote: messages.undo,
      onUndoMemory: messages.undoMemory,
      onAsk: (id, choice) => void messages.ask(id, choice),
      onGroupLabel: () => {},
      // The menu opens when the right-click completes over the same message (`openOnRelease`).
      onContextMenu: (target: ChatMenuTarget, event: MouseEvent<HTMLElement>) => {
        event.preventDefault()
        const bubble = event.currentTarget
        const span = selectedSpan(bubble)
        openOnRelease(event, (under) => bubble.contains(under), (at) =>
          withMenus((menus) =>
            menus.openChatMenu(target, { x: at.clientX, y: at.clientY }, itemsRef.current, span, setRemoval, (reply) => {
              setQuote(quoteOf(itemsRef.current, reply))
              inputRef.current?.focus()
            }),
          ),
        )
      },
      renderOwnerImage,
      renderReactions,
    }),
    [scrollRef, pinnedRef, inputRef, setQuote, setRemoval],
  )
}

function quoteOf(items: ReadonlyArray<ChatItem>, target: ReactionTarget): Quote {
  const item = items.find((i) => (target._tag === 'bubble' ? i._tag === 'juno' && i.id === target.id : i._tag === 'card' && i.card.id === target.id))
  const preview = item?._tag === 'juno' ? junoText(item.body).trim().split('\n', 1)[0] ?? '' : item?._tag === 'card' ? item.card._tag : ''
  return { target, preview }
}

/** The range selected in the message's words, read before the menu takes focus. */
function selectedSpan(root: HTMLElement): ChatSpan | undefined {
  const selection = globalThis.getSelection()
  const words = root.querySelector('p')
  if (words === null || selection === null || selection.rangeCount === 0 || selection.isCollapsed) return undefined
  const range = selection.getRangeAt(0)
  if (!words.contains(range.startContainer) || !words.contains(range.endContainer)) return undefined
  const prefix = range.cloneRange()
  prefix.selectNodeContents(words)
  prefix.setEnd(range.startContainer, range.startOffset)
  const text = range.toString()
  const startByte = new TextEncoder().encode(prefix.toString()).length
  return { text, startByte, endByte: startByte + new TextEncoder().encode(text).length }
}
