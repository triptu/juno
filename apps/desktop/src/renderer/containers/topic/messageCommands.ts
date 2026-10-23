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
import { isOwnEditable, opensThread, refOf } from '../messageRows'
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
 * From the row's menu button, under the button.
 */
export function anchorFor(row: HTMLElement, at: MenuAt | undefined): MenuPoint {
  if (at?.trigger !== undefined) return { x: at.clientX, y: at.clientY, trigger: at.trigger }
  const box = row.getBoundingClientRect()
  if (at !== undefined && at.clientX > box.left && at.clientX < box.right && at.clientY > box.top && at.clientY < box.bottom) return { x: at.clientX, y: at.clientY }
  const text = row.querySelector<HTMLElement>('[data-msg-text]')
  const top = text?.getBoundingClientRect() ?? box
  const line = text === null ? 0 : Number.parseFloat(getComputedStyle(text).lineHeight) || 0
  return { x: top.left, y: Math.min(box.bottom, top.top + line) }
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
      readonly reply: typeof reply
    } = {
      react,
      startEdit,
      askDelete,
      reply,
      onSeeReactions: (message, name, chip) => setReactions({ ts: message.ts, name, anchor: chip }),
      onConfirmDelete: confirmDelete,
      onCancelDelete: () => {
        const ts = latest.current.confirming?.ts
        setConfirming(undefined)
        if (ts !== undefined) focusRow(scrollRef, ts)
      },
    }
    // The menu and what its rows do load when idle (`../messageMenu.tsx`).
    const input: MenuInput = { channel, scrollRef, composer, latest, setMenuMessage, react, startEdit, askDelete, reply }
    const menu = (message: MessageView, anchor: MenuPoint, onSender = false, picking = false) => withMenus((menus) => menus.topicMenu(input, message, anchor, onSender, picking))
    const forward = (message: MessageView) => withMenus((menus) => menus.topicForward(input, message))
    return { ...handlers, menu, forward }
    // `channel` is fixed for a topic tab; the rest is read through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel])
}

type MessageCommands = ReturnType<typeof useMessageCommands>

interface RowKeyInput {
  readonly actions: MessageCommands
  readonly latest: Latest
  readonly scrollRef: RefObject<HTMLElement | null>
  readonly composer: RefObject<ComposerHandle | null>
}

/**
 * What a key does on a focused message, or undefined when it does nothing there, with Slack's keys where Juno has
 * the action. The menu shows the letters and ⌫ beside their rows (`topicMenuItems`); R is More reactions' key. A letter held with ⌘, ⌃ or ⌥ is the app's or the system's (⌘Q quits).
 */
function rowKeyAction(event: KeyboardEvent<HTMLElement>, message: MessageView, { actions, latest, scrollRef, composer }: RowKeyInput): (() => void) | undefined {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
  if (event.key.length === 1 && (event.metaKey || event.ctrlKey || event.altKey)) return undefined
  const own = isOwnEditable(message)
  switch (key) {
    // Q quotes the whole message in the composer, as the menu's Quote row does.
    case 'q': {
      const text = textOf(scrollRef.current, message.ts)
      return text === '' ? undefined : () => composer.current?.quote(text)
    }
    // F forwards it, as the menu's Forward… does, when Slack has it.
    case 'f':
      return message.pending === undefined && message.kind === 'message' ? () => actions.forward(message) : undefined
    // R opens its menu as the full emoji picker, where ⇧F10 opens the menu, with the search focused.
    case 'r': {
      const row = rowOf(scrollRef.current, message.ts)
      return row !== null && message.kind === 'message' ? () => actions.menu(message, anchorFor(row, undefined), false, true) : undefined
    }
    // T starts or opens the message's thread, as the menu's row does, where it has that row.
    case 't':
      return opensThread(latest.current.detail.kind, message) ? () => actions.reply(message) : undefined
    case 'e':
      return own ? () => actions.startEdit(message) : undefined
    case 'Delete':
    case 'Backspace':
      return own ? () => actions.askDelete(message) : undefined
    case 'Escape':
      return () => composer.current?.focus()
    // ⇧F10 opens the selected message's menu, as the context-menu key does.
    case 'F10': {
      const row = rowOf(scrollRef.current, message.ts)
      return event.shiftKey && row !== null ? () => actions.menu(message, anchorFor(row, undefined)) : undefined
    }
  }
  return undefined
}

/** The row keys (`rowKeyAction`), the reaction toggle, the row menu, ↑ in an empty composer and ↓ from the newest message back to it. */
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
    const run = rowKeyAction(event, message, { actions, latest, scrollRef, composer })
    if (run === undefined) return
    event.preventDefault()
    run()
  }

  const selectNewest = () => {
    const rows = scrollRef.current?.querySelectorAll<HTMLElement>(ROW)
    const last = rows?.[rows.length - 1]
    if (last === undefined) return
    last.focus({ preventScroll: true })
    last.scrollIntoView({ block: 'nearest', behavior: 'instant' })
  }

  const focusComposer = () => composer.current?.focus()

  const onToggleReaction = (ts: string, name: string) => {
    const message = rowMessage(ts)
    if (message !== undefined) actions.react(message, name)
  }

  const onMessageMenu = (ts: string, at: MenuAt, onSender: boolean) => {
    const message = rowMessage(ts)
    const row = rowOf(scrollRef.current, ts)
    if (message !== undefined && row !== null) actions.menu(message, anchorFor(row, at), onSender)
  }

  return { onRowKey, selectNewest, focusComposer, onToggleReaction, onMessageMenu }
}
