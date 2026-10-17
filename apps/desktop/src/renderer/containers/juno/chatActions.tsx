/**
 * What the chat's rows and composer do (see `JunoChat`): sending, focus
 * requests, the remove sheet and the row callbacks.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type MouseEvent, type RefObject, type SetStateAction } from 'react'
import { chatCopy, junoText, type ChatItem, type ChatPage, type JunoFileInput, type JunoPage, type MessageMenu, type OpId, type Quote, type SendContext } from '@juno/agent-contract'
import { copyText, junoFocusAtom, popupContextMenu, registry } from '@juno/state'
import { junoThumbAtom, messageActions } from '@juno/state/agent'
import { afterPaint, measure } from '@juno/state/perf'
import { useAtomValue } from '@juno/state/react'
import { OwnerImage, RemoveSheet, SheetLayer, type ActivateEvent, type ChatActions, type ChatMenuTarget, type OwnerImageFile, type ReactionTarget } from '@juno/views'
import { openSlackMessage, openTopic } from '../navigation'
import { openWebLink } from '../slackLinks'
import { junoCommands } from './actions'
import { scrollToRow } from './chatScroll'
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
    if (scroller !== null) scroller.scrollTop = scroller.scrollHeight
  }

  const send = (text: string, files: ReadonlyArray<JunoFileInput> = []) => {
    const at = performance.now()
    sentAtRef.current = { at, newest: newestBubbleId }
    afterPaint(() => measure('juno.chat-send', at))
    const context = contextOf?.()
    junoCommands.send(text, { ...(context === undefined ? {} : { context }), ...(quote === undefined ? {} : { replyTo: quote.target }), ...(files.length === 0 ? {} : { files }) })
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
  /** Opens the reactions of a bubble or card under (or over) this box (`useReactionPicker`). */
  readonly openPicker: (target: ReactionTarget, box: DOMRect) => void
  readonly setRemoval: Dispatch<SetStateAction<Removal | undefined>>
  /** A link to a Juno page ("Show in Activity"): in the chat's own tab or panel. */
  readonly openPage: (page: JunoPage) => void
}

/** Callbacks every row gets, stable for the chat's life (performance 5.1); they read the latest state through refs. */
export function useChatActions({ items, scrollRef, pinnedRef, inputRef, setQuote, openPicker, setRemoval, openPage }: ActionsInput): ChatActions {
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
      onReactions: (target, event: MouseEvent<HTMLElement>) => openPicker(target, event.currentTarget.getBoundingClientRect()),
      onReply: (target) => {
        setQuote(quoteOf(itemsRef.current, target))
        inputRef.current?.focus()
      },
      onQuote: (target) => scrollToRow(scrollRef, pinnedRef, target),
      onUndoNote: messages.undo,
      onUndoMemory: messages.undoMemory,
      onAsk: (id, choice) => void messages.ask(id, choice),
      onGroupLabel: () => {},
      onContextMenu: (target: ChatMenuTarget, event: MouseEvent<HTMLElement>) => {
        event.preventDefault()
        const box = event.currentTarget.getBoundingClientRect()
        void showChatMenu(target, itemsRef.current, selectedSpan(event.currentTarget), setRemoval, (reaction) => openPicker(reaction, box), (reply) => {
          setQuote(quoteOf(itemsRef.current, reply))
          inputRef.current?.focus()
        })
      },
      renderOwnerImage,
    }),
    [scrollRef, pinnedRef, inputRef, setQuote, openPicker, setRemoval],
  )
}

function quoteOf(items: ReadonlyArray<ChatItem>, target: ReactionTarget): Quote {
  const item = items.find((i) => (target._tag === 'bubble' ? i._tag === 'juno' && i.id === target.id : i._tag === 'card' && i.card.id === target.id))
  const preview = item?._tag === 'juno' ? junoText(item.body).trim().split('\n', 1)[0] ?? '' : item?._tag === 'card' ? item.card._tag : ''
  return { target, preview }
}

/** Capture a range in the message's words before the native menu takes focus. */
function selectedSpan(root: HTMLElement): { text: string; startByte: number; endByte: number } | undefined {
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

async function showChatMenu(target: ChatMenuTarget, items: ReadonlyArray<ChatItem>, selection: ReturnType<typeof selectedSpan>, remove: (message: typeof MessageMenu.Type) => void, react: (target: ReactionTarget) => void, reply: (target: ReactionTarget) => void): Promise<void> {
  const copy = chatCopy.contextMenu
  const juno = target.kind !== 'owner'
  const reaction: ReactionTarget | undefined = target.kind === 'juno' ? { _tag: 'bubble', id: target.id } : target.kind === 'card' ? { _tag: 'card', id: target.id } : undefined
  const message = await messages.menu(target.kind === 'owner' ? { _tag: 'owner', opId: target.opId } : target.kind === 'juno' ? { _tag: 'bubble', id: target.id } : { _tag: 'card', id: target.id })
  const item = items.find((i) => (target.kind === 'owner' ? i._tag === 'owner' && i.opId === target.opId : target.kind === 'juno' ? i._tag === 'juno' && i.id === target.id : false))
  const text = item?._tag === 'owner' ? item.text : item?._tag === 'juno' ? junoText(item.body) : ''
  const span = selection ?? { text, startByte: 0, endByte: new TextEncoder().encode(text).length }
  const chosen = await popupContextMenu([
    { id: 'copy', label: copy.copy },
    ...(juno ? [{ id: 'react', label: chatCopy.react.react }, { id: 'reply', label: chatCopy.react.reply }] : [{ id: 'remember', label: copy.remember, enabled: message !== null && span.endByte - span.startByte > 0 && span.endByte - span.startByte <= 280 }]),
    { separator: true },
    { id: 'remove', label: copy.remove, enabled: message !== null },
  ])
  switch (chosen) {
    case 'copy': return copyText(span.text)
    case 'remember':
      if (message !== null) await messages.pin(message, span.startByte, span.endByte)
      return
    case 'remove':
      if (message !== null) remove(message)
      return
    case 'react':
      if (reaction !== undefined) react(reaction)
      return
    case 'reply':
      if (reaction !== undefined) reply(reaction)
      return
  }
}
