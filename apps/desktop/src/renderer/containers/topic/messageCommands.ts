/**
 * The commands behind a topic's message actions (see `../messageActions`):
 * the handlers the rows get, created once per topic, and the row keys.
 */
import { useMemo, type Dispatch, type KeyboardEvent, type RefObject, type SetStateAction } from 'react'
import type { MessageView, TopicDetail } from '@juno/contract'
import { deleteMessage, reactToMessage, registry, type MessageWindow } from '@juno/state'
import type { MenuAnchor, MessageActions } from '@juno/views'
import type { ComposerHandle } from '../messageActions'
import { isOwnEditable, landedTs, refOf } from '../messageRows'
import { openTopic } from '../navigation'
import { noteRecentEmoji } from '../recentEmoji'
import { showMessageMenu } from '../topicActions'

const ROW = '[data-message-row]'
const rowOf = (scroller: HTMLElement | null, ts: string) => scroller?.querySelector<HTMLElement>(`${ROW}[data-message-row="${CSS.escape(ts)}"]`) ?? null

/** The picker's height and the gap under its anchor, for choosing whether it opens below or above (`--emoji-picker-height`). */
const PICKER_ROOM = 368

/** The topic's middle area, which the floating picker and Quote button are placed in. */
export const middleOf = (scrollRef: RefObject<HTMLElement | null>) => scrollRef.current?.closest<HTMLElement>('[data-topic-middle]') ?? null

export function focusRow(scrollRef: RefObject<HTMLElement | null>, ts: string): void {
  const row = rowOf(scrollRef.current, ts)
  if (row === null) return
  row.focus({ preventScroll: true })
  row.scrollIntoView({ block: 'nearest', behavior: 'instant' })
}

/** The text a whole-message quote takes: the body as the list draws it, mentions as their names. */
function textOf(scroller: HTMLElement | null, ts: string): string {
  const body = rowOf(scroller, ts)?.querySelector<HTMLElement>('[data-msg-text]')
  return body?.innerText.trim() ?? ''
}

export interface Editing {
  readonly ts: string
  readonly text: string
  /** Saved: the field stays until the row's `rev` moves past this. */
  readonly savedRev?: number
}

export interface Confirming {
  readonly ts: string
  readonly sent: boolean
}

export interface Picker {
  readonly ts: string
  readonly x: number
  readonly y: number
  readonly placement: 'below-end' | 'above-end'
}

/** The latest window and state, for callbacks created once. */
export type Latest = RefObject<{ readonly list: MessageWindow; readonly editing: Editing | undefined; readonly confirming: Confirming | undefined; readonly detail: TopicDetail }>

interface CommandsInput {
  readonly channel: string
  readonly scrollRef: RefObject<HTMLElement | null>
  readonly composer: RefObject<ComposerHandle | null>
  readonly latest: Latest
  readonly setEditing: Dispatch<SetStateAction<Editing | undefined>>
  readonly setConfirming: Dispatch<SetStateAction<Confirming | undefined>>
  readonly setPicker: Dispatch<SetStateAction<Picker | undefined>>
  readonly setMenuMessage: Dispatch<SetStateAction<string | undefined>>
}

/** The rows' handlers, created once per topic (performance 5.1); they read the latest state through `latest`. */
export function useMessageCommands({ channel, scrollRef, composer, latest, setEditing, setConfirming, setPicker, setMenuMessage }: CommandsInput) {
  return useMemo(() => {
    const react = (message: MessageView, name: string, on?: boolean) => {
      const mine = message.reactions.find((reaction) => reaction.name === name)?.me === true
      const want = on ?? !mine
      if (want) noteRecentEmoji(name)
      void reactToMessage(registry, refOf(channel, message), name, want)
    }
    const startEdit = (message: MessageView) => {
      if (!isOwnEditable(message)) return
      setConfirming(undefined)
      setEditing({ ts: message.ts, text: message.editText ?? '' })
    }
    const askDelete = (message: MessageView) => {
      if (!isOwnEditable(message)) return
      setEditing(undefined)
      setConfirming({ ts: message.ts, sent: false })
      focusRow(scrollRef, message.ts)
    }
    const confirmDelete = (message: MessageView) => {
      setConfirming({ ts: message.ts, sent: true })
      composer.current?.focus()
      void deleteMessage(registry, refOf(channel, message)).then((exit) => {
        if (exit._tag === 'Failure') setConfirming(undefined)
      })
    }
    const handlers: MessageActions & {
      readonly react: typeof react
      readonly startEdit: typeof startEdit
      readonly askDelete: typeof askDelete
    } = {
      react,
      startEdit,
      askDelete,
      onReact: (message, name) => react(message, name),
      onMoreReactions: (message, at: MenuAnchor) => {
        const area = middleOf(scrollRef)
        const toolbar = rowOf(scrollRef.current, message.ts)?.querySelector('[role="toolbar"]')
        if (area === null) return
        const origin = area.getBoundingClientRect()
        const box = toolbar?.getBoundingClientRect() ?? { right: at.x, bottom: at.y, top: at.y }
        const below = box.bottom + PICKER_ROOM <= origin.bottom
        setPicker({ ts: message.ts, x: box.right - origin.left, y: (below ? box.bottom : box.top) - origin.top, placement: below ? 'below-end' : 'above-end' })
      },
      onQuote: (message) => composer.current?.quote(textOf(scrollRef.current, message.ts)),
      onReply: (message) => openTopic(`t:${channel}:${message.ts}`),
      onMore: (message, at) => void menu(message, at),
      onConfirmDelete: confirmDelete,
      onCancelDelete: () => {
        const ts = latest.current.confirming?.ts
        setConfirming(undefined)
        if (ts !== undefined) focusRow(scrollRef, ts)
      },
    }
    const menu = async (message: MessageView, at: MenuAnchor, onSender = false) => {
      const people = latest.current.list.refs.people
      const sender = message.senderId === undefined ? undefined : { id: message.senderId, name: people.get(message.senderId)?.name ?? message.senderId }
      setMenuMessage(message.ts)
      let chosen: Awaited<ReturnType<typeof showMessageMenu>>
      try {
        chosen = await showMessageMenu(latest.current.detail, message, isOwnEditable(message), at, sender, onSender)
      } finally {
        setMenuMessage(undefined)
      }
      // The message may have been edited or deleted while the menu was open: act on it as it is now.
      const rows = latest.current.list.rows
      const now = rows.get(message.ts) ?? rows.get(landedTs(rows, message.ts) ?? '')
      if (now === undefined) return
      if (chosen === 'edit' && isOwnEditable(now)) startEdit(now)
      else if (chosen === 'delete' && isOwnEditable(now)) askDelete(now)
      else if (chosen === 'reply') handlers.onReply?.(now)
    }
    return { ...handlers, menu }
    // `channel` is fixed for a topic tab; the rest is read through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel])
}

type MessageCommands = ReturnType<typeof useMessageCommands>

/** The row keys, the reaction toggle, the row menu and ↑ in an empty composer. */
export function rowHandlers(actions: MessageCommands, latest: Latest, scrollRef: RefObject<HTMLElement | null>, composer: RefObject<ComposerHandle | null>) {
  const rowMessage = (ts: string) => latest.current.list.rows.get(ts)

  const onRowKey = (ts: string, event: KeyboardEvent<HTMLElement>) => {
    const message = rowMessage(ts)
    if (message === undefined) return
    const asking = latest.current.confirming
    if (asking?.ts === ts && !asking.sent) {
      if (event.key === 'Enter') {
        event.preventDefault()
        actions.onConfirmDelete(message)
      } else if (event.key === 'Escape') {
        event.preventDefault()
        actions.onCancelDelete()
      }
      return
    }
    switch (event.key) {
      case 'e':
      case 'E':
        if (!isOwnEditable(message)) return
        event.preventDefault()
        actions.startEdit(message)
        return
      case 'Delete':
      case 'Backspace':
        if (!isOwnEditable(message)) return
        event.preventDefault()
        actions.askDelete(message)
        return
      case 'Escape':
        event.preventDefault()
        composer.current?.focus()
        return
    }
  }

  const selectNewest = () => {
    const rows = scrollRef.current?.querySelectorAll<HTMLElement>(ROW)
    const last = rows?.[rows.length - 1]
    if (last === undefined) return
    last.focus({ preventScroll: true })
    last.scrollIntoView({ block: 'nearest', behavior: 'instant' })
  }

  const onToggleReaction = (ts: string, name: string) => {
    const message = rowMessage(ts)
    if (message !== undefined) actions.react(message, name)
  }

  const onMessageMenu = (ts: string, at: { readonly clientX: number; readonly clientY: number }, onSender: boolean) => {
    const message = rowMessage(ts)
    if (message !== undefined) void actions.menu(message, { x: at.clientX, y: at.clientY }, onSender)
  }

  return { rowMessage, onRowKey, selectNewest, onToggleReaction, onMessageMenu }
}
