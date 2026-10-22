/**
 * The commands behind a topic's message actions (see `../messageActions`):
 * the handlers the rows get and the message menu's, created once per topic,
 * and the row keys.
 */
import { useMemo, type Dispatch, type KeyboardEvent, type RefObject, type SetStateAction } from 'react'
import type { MessageView, TopicDetail } from '@juno/contract'
import { deleteMessage, noteRecentEmoji, reactToMessage, registry, type MessageWindow } from '@juno/state'
import type { MenuAt, MenuPoint, MessageActions } from '@juno/views'
import type { ComposerHandle } from '../messageActions'
import { withMenus } from '../messageMenu'
import { isOwnEditable, refOf } from '../messageRows'
import { openTopic, openTopicInBackground } from '../navigation'
import type { MenuInput } from './messageMenu'

const ROW = '[data-message-row]'
export const rowOf = (scroller: HTMLElement | null, ts: string) => scroller?.querySelector<HTMLElement>(`${ROW}[data-message-row="${CSS.escape(ts)}"]`) ?? null

/** The topic's middle area, which the floating picker and Quote button are placed in. */
export const middleOf = (scrollRef: RefObject<HTMLElement | null>) => scrollRef.current?.closest<HTMLElement>('[data-topic-middle]') ?? null

export function focusRow(scrollRef: RefObject<HTMLElement | null>, ts: string): void {
  const row = rowOf(scrollRef.current, ts)
  if (row === null) return
  row.focus({ preventScroll: true })
  row.scrollIntoView({ block: 'nearest', behavior: 'instant' })
}

/** The text a whole-message quote or copy takes: the body as the list draws it, mentions as their names. */
export function textOf(scroller: HTMLElement | null, ts: string): string {
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

/** The reactions dialog: on which message and emoji, under which chip. */
export interface SeeingReactions {
  readonly ts: string
  readonly name: string
  readonly anchor: HTMLElement
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
  readonly setMenuMessage: Dispatch<SetStateAction<string | undefined>>
  readonly setReactions: Dispatch<SetStateAction<SeeingReactions | undefined>>
}

/**
 * Where a message's menu opens: at the pointer for a right-click, and from
 * the keyboard under the row's first line, at its text. A context-menu key
 * press reports a point that may be anywhere; inside the row it is kept.
 */
export function anchorFor(row: HTMLElement, at: MenuAt | undefined): MenuPoint {
  const box = row.getBoundingClientRect()
  if (at !== undefined && at.clientX > box.left && at.clientX < box.right && at.clientY > box.top && at.clientY < box.bottom) return { x: at.clientX, y: at.clientY }
  const text = row.querySelector<HTMLElement>('[data-msg-text]')
  const top = text?.getBoundingClientRect() ?? box
  const line = text === null ? 0 : Number.parseFloat(getComputedStyle(text).lineHeight) || 0
  return { x: top.left, y: Math.min(box.bottom, top.top + line) }
}

/** View reactions in the message menu: the dialog on the first emoji, under its chip. */
export function firstReaction(scrollRef: RefObject<HTMLElement | null>, message: MessageView): SeeingReactions | undefined {
  const chip = rowOf(scrollRef.current, message.ts)?.querySelector<HTMLElement>('[data-reaction]')
  const first = message.reactions[0]
  return chip === null || chip === undefined || first === undefined ? undefined : { ts: message.ts, name: first.name, anchor: chip }
}

/** The rows' handlers, created once per topic (performance 5.1); they read the latest state through `latest`. */
export function useMessageCommands({ channel, scrollRef, composer, latest, setEditing, setConfirming, setMenuMessage, setReactions }: CommandsInput) {
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
    // ⌘-click or ⌘Enter opens the thread in a background tab: this tab, its scroll and its focus stay (SPEC 7).
    const reply = (message: MessageView, options?: { readonly newTab: boolean }) => (options?.newTab === true ? openTopicInBackground : openTopic)(`t:${channel}:${message.ts}`)
    const handlers: MessageActions & {
      readonly react: typeof react
      readonly startEdit: typeof startEdit
      readonly askDelete: typeof askDelete
    } = {
      react,
      startEdit,
      askDelete,
      onSeeReactions: (message, name, chip) => setReactions({ ts: message.ts, name, anchor: chip }),
      onConfirmDelete: confirmDelete,
      onCancelDelete: () => {
        const ts = latest.current.confirming?.ts
        setConfirming(undefined)
        if (ts !== undefined) focusRow(scrollRef, ts)
      },
    }
    // The menu and what its rows do load when idle (`../messageMenu.tsx`).
    const input: MenuInput = { channel, scrollRef, composer, latest, setMenuMessage, setReactions, react, startEdit, askDelete, reply }
    const menu = (message: MessageView, anchor: MenuPoint, onSender = false) => withMenus((menus) => menus.topicMenu(input, message, anchor, onSender))
    return { ...handlers, menu }
    // `channel` is fixed for a topic tab; the rest is read through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel])
}

type MessageCommands = ReturnType<typeof useMessageCommands>

/** The row keys, the reaction toggle, the row menu and ↑ in an empty composer. */
export function rowHandlers(actions: MessageCommands, rowMessage: (ts: string) => MessageView | undefined, latest: Latest, scrollRef: RefObject<HTMLElement | null>, composer: RefObject<ComposerHandle | null>) {
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
      // ⇧F10 opens the selected message's menu, as the context-menu key does.
      case 'F10': {
        const row = rowOf(scrollRef.current, ts)
        if (!event.shiftKey || row === null) return
        event.preventDefault()
        actions.menu(message, anchorFor(row, undefined))
        return
      }
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

  const onMessageMenu = (ts: string, at: MenuAt, onSender: boolean) => {
    const message = rowMessage(ts)
    const row = rowOf(scrollRef.current, ts)
    if (message !== undefined && row !== null) actions.menu(message, anchorFor(row, at), onSender)
  }

  return { onRowKey, selectNewest, onToggleReaction, onMessageMenu }
}
