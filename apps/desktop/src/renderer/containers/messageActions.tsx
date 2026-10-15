/**
 * What a topic's messages do (SPEC section 7: the hover toolbar, More,
 * Keyboard, Quoting and reactions), wired to the engine.
 *
 * - The toolbar: the three quick reactions, the emoji picker, Quote, Reply
 *   in thread (Main) and More, the message menu.
 * - Your own messages: Edit turns the body into a field in place; Delete
 *   asks once in the toolbar's place (ADR 0010). Neither has an undo.
 * - The keyboard: ↑ in an empty composer selects the newest message, ↑ and
 *   ↓ move, Esc goes back to the composer. On your own selected message E
 *   edits, and Delete or Backspace asks to delete; Enter confirms and Esc
 *   cancels.
 * - Quote: the whole message from the toolbar, or the selected text from
 *   the floating Quote button, as "> " lines at the end of the draft.
 *
 * Every change is a command that writes locally and answers at once; the
 * list shows it from the engine's next window. The edit field stays until
 * that window has the new text, so the old text never flashes back.
 */
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import type { MessageRef, MessageView, TopicDetail } from '@juno/contract'
import { deleteMessage, editMessage, reactToMessage, registry, type MessageWindow } from '@juno/state'
import { Floating, InlineEdit, SelectionQuote, type MenuAnchor, type MessageActions } from '@juno/views'
import { openTopic } from './navigation'
import { showMessageMenu } from './topicActions'

const EmojiPickerPanel = lazy(() => import('./EmojiPickerPanel'))

/** What the composer lets the topic do to it. Filled by `TopicComposer` once its draft has loaded. */
export interface ComposerHandle {
  readonly focus: () => void
  /** Adds `> ` lines at the end of the draft, on their own lines, with the caret after them, and focuses the field. */
  readonly quote: (text: string) => void
}

const ROW = '[data-message-row]'
const rowOf = (scroller: HTMLElement | null, ts: string) => scroller?.querySelector<HTMLElement>(`${ROW}[data-message-row="${CSS.escape(ts)}"]`) ?? null

/** The picker's height and the gap under its anchor, for choosing whether it opens below or above (`--emoji-picker-height`). */
const PICKER_ROOM = 368
/** Frequently used reactions this session, newest first. */
const RECENT_MAX = 18
let recentReactions: ReadonlyArray<string> = ['+1', 'white_check_mark', 'eyes']
const noteRecent = (name: string) => {
  recentReactions = [name, ...recentReactions.filter((other) => other !== name)].slice(0, RECENT_MAX)
}

/** Fetch the picker's chunk once a topic has painted, so the first open does not wait for it. */
let pickerLoaded = false
const loadPicker = () => void import('./EmojiPickerPanel')
function preloadPicker(): void {
  if (pickerLoaded) return
  pickerLoaded = true
  window.requestIdleCallback(loadPicker)
}

/** The node is inside a message's text in this list. */
const inMessageText = (node: Node | null, scroller: HTMLElement) => (node instanceof Element ? node : node?.parentElement)?.closest('[data-msg-text]') != null && scroller.contains(node)

const refOf = (channel: string, message: MessageView): MessageRef => ({
  channelId: channel,
  ts: message.ts,
  ...(message.clientMsgId === undefined ? {} : { clientMsgId: message.clientMsgId }),
})

/** The message can be edited and deleted by the user: their own, shown as a message, and not a failed send (that one has Delete draft). */
export const isOwnEditable = (message: MessageView): boolean => message.fromMe && message.kind === 'message' && message.pending !== 'failed' && message.editText !== undefined

/** The text a whole-message quote takes: the body as the list draws it, mentions as their names. */
function textOf(scroller: HTMLElement | null, ts: string): string {
  const body = rowOf(scroller, ts)?.querySelector<HTMLElement>('[data-msg-text]')
  return body?.innerText.trim() ?? ''
}

export interface MessageActionsInput {
  readonly detail: TopicDetail
  readonly list: MessageWindow
  readonly scrollRef: RefObject<HTMLElement | null>
  readonly composer: RefObject<ComposerHandle | null>
}

export interface MessageActionsOutput {
  readonly actions: MessageActions
  readonly confirmingDelete: string | undefined
  readonly editing: { readonly ts: string; readonly editor: ReactNode } | undefined
  readonly onRowKey: (ts: string, event: KeyboardEvent<HTMLElement>) => void
  readonly onToggleReaction: (ts: string, name: string) => void
  /** A right-click on a row, or on its sender's name or avatar. */
  readonly onMessageMenu: (ts: string, at: { readonly clientX: number; readonly clientY: number }, onSender: boolean) => void
  /** ↑ in an empty composer. */
  readonly selectNewest: () => void
  /** The emoji picker or the selection's Quote button, for `TopicView`'s floating slot. */
  readonly floating: ReactNode
}

interface Editing {
  readonly ts: string
  readonly text: string
  /** Saved: the field stays until the row's `rev` moves past this. */
  readonly savedRev?: number
}

interface Picker {
  readonly ts: string
  readonly x: number
  readonly y: number
  readonly placement: 'below-end' | 'above-end'
}

export function useMessageActions({ detail, list, scrollRef, composer }: MessageActionsInput): MessageActionsOutput {
  const channel = detail.channel.id
  const [editing, setEditing] = useState<Editing | undefined>(undefined)
  const [confirming, setConfirming] = useState<{ readonly ts: string; readonly sent: boolean } | undefined>(undefined)
  const [picker, setPicker] = useState<Picker | undefined>(undefined)
  const [selection, setSelection] = useState<{ readonly x: number; readonly y: number } | undefined>(undefined)

  // The latest window and state, for callbacks created once.
  const latest = useRef({ list, editing, confirming, detail })
  useLayoutEffect(() => {
    latest.current = { list, editing, confirming, detail }
  })

  // A saved edit ends when the window shows the new text; a sent delete when the row has left.
  const editedRev = editing?.savedRev === undefined ? undefined : list.rows.get(editing.ts)?.rev
  useLayoutEffect(() => {
    if (editing?.savedRev !== undefined && editedRev !== editing.savedRev) setEditing(undefined)
  }, [editing, editedRev])
  const confirmingGone = confirming?.sent === true && !list.rows.has(confirming.ts)
  useLayoutEffect(() => {
    if (confirmingGone) setConfirming(undefined)
  }, [confirmingGone])

  useEffect(preloadPicker, [])

  const middle = () => scrollRef.current?.closest<HTMLElement>('[data-topic-middle]') ?? null

  const focusRow = (ts: string) => {
    const row = rowOf(scrollRef.current, ts)
    if (row === null) return
    row.focus({ preventScroll: true })
    row.scrollIntoView({ block: 'nearest', behavior: 'instant' })
  }

  const actions = useMemo(() => {
    const react = (message: MessageView, name: string, on?: boolean) => {
      const mine = message.reactions.find((reaction) => reaction.name === name)?.me === true
      const want = on ?? !mine
      if (want) noteRecent(name)
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
      focusRow(message.ts)
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
        const area = middle()
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
        if (ts !== undefined) focusRow(ts)
      },
    }
    const menu = async (message: MessageView, at: MenuAnchor, onSender = false) => {
      const people = latest.current.list.refs.people
      const sender = message.senderId === undefined ? undefined : { id: message.senderId, name: people.get(message.senderId)?.name ?? message.senderId }
      const chosen = await showMessageMenu(latest.current.detail, message, isOwnEditable(message), at, sender, onSender)
      // The message may have been edited or deleted while the menu was open: act on it as it is now.
      const now = latest.current.list.rows.get(message.ts)
      if (now === undefined) return
      if (chosen === 'edit' && isOwnEditable(now)) startEdit(now)
      else if (chosen === 'delete' && isOwnEditable(now)) askDelete(now)
      else if (chosen === 'reply') handlers.onReply?.(now)
    }
    return { ...handlers, menu }
    // `channel` is fixed for a topic tab; the rest is read through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel])

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

  // The selection's Quote button: shown when a drag or a Shift-arrow selection ends inside a message's text.
  useEffect(() => {
    const scroller = scrollRef.current
    if (scroller === null) return
    const place = () => {
      const current = window.getSelection()
      if (current === null || current.isCollapsed || current.rangeCount === 0) return setSelection(undefined)
      const range = current.getRangeAt(0)
      if (!inMessageText(range.startContainer, scroller) || !inMessageText(range.endContainer, scroller) || current.toString().trim() === '') return setSelection(undefined)
      const area = middle()
      if (area === null) return
      const box = range.getBoundingClientRect()
      const origin = area.getBoundingClientRect()
      setSelection({ x: box.left + box.width / 2 - origin.left, y: box.top - origin.top })
    }
    const onKeyUp = (event: globalThis.KeyboardEvent) => {
      if (event.shiftKey || event.key === 'Shift') place()
    }
    const onSelectionChange = () => {
      const current = window.getSelection()
      if (current === null || current.isCollapsed) setSelection(undefined)
    }
    const hide = () => setSelection(undefined)
    scroller.addEventListener('pointerup', place)
    scroller.addEventListener('keyup', onKeyUp)
    scroller.addEventListener('wheel', hide, { passive: true })
    document.addEventListener('selectionchange', onSelectionChange)
    return () => {
      scroller.removeEventListener('pointerup', place)
      scroller.removeEventListener('keyup', onKeyUp)
      scroller.removeEventListener('wheel', hide)
      document.removeEventListener('selectionchange', onSelectionChange)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRef])

  // The picker closes on a press outside it and when the list scrolls under it.
  useEffect(() => {
    if (picker === undefined) return
    const outside = (event: Event) => {
      if (!(event.target instanceof Element) || event.target.closest('[data-floating="picker"]') === null) setPicker(undefined)
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('wheel', outside, { capture: true, passive: true })
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('wheel', outside, true)
    }
  }, [picker])

  const quoteSelection = () => {
    const current = window.getSelection()
    const text = current?.toString().trim() ?? ''
    current?.removeAllRanges()
    setSelection(undefined)
    if (text !== '') composer.current?.quote(text)
  }

  const closePicker = () => {
    const ts = picker?.ts
    setPicker(undefined)
    if (ts !== undefined) focusRow(ts)
  }
  const pick = (name: string) => {
    const message = picker === undefined ? undefined : rowMessage(picker.ts)
    setPicker(undefined)
    if (message !== undefined) actions.react(message, name)
  }

  const floating =
    picker !== undefined ? (
      <Floating x={picker.x} y={picker.y} placement={picker.placement} layer="picker">
        <Suspense fallback={null}>
          <EmojiPickerPanel recent={recentReactions} onPick={pick} onClose={closePicker} />
        </Suspense>
      </Floating>
    ) : selection !== undefined ? (
      <Floating x={selection.x} y={selection.y} placement="above-center" layer="selection">
        <SelectionQuote onQuote={quoteSelection} />
      </Floating>
    ) : null

  const editingRow =
    editing === undefined
      ? undefined
      : {
          ts: editing.ts,
          editor: (
            <InlineEdit
              value={editing.text}
              onChange={(text) => setEditing((current) => (current === undefined || current.savedRev !== undefined ? current : { ...current, text }))}
              onCancel={() => {
                setEditing(undefined)
                composer.current?.focus()
              }}
              onSave={() => {
                const message = rowMessage(editing.ts)
                if (message === undefined || editing.savedRev !== undefined || editing.text.trim() === '') return
                composer.current?.focus()
                if (editing.text === message.editText) return setEditing(undefined)
                setEditing({ ...editing, savedRev: message.rev })
                void editMessage(registry, refOf(channel, message), editing.text).then((exit) => {
                  if (exit._tag === 'Failure') setEditing(undefined)
                })
              }}
            />
          ),
        }

  return {
    actions,
    confirmingDelete: confirming?.ts,
    editing: editingRow,
    onRowKey,
    onToggleReaction,
    onMessageMenu,
    selectNewest,
    floating,
  }
}
