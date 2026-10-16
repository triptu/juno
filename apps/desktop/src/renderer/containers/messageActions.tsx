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
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import type { TopicDetail } from '@juno/contract'
import { editMessage, registry, type MessageWindow } from '@juno/state'
import { InlineEdit, type InlineEditProps, type MessageActions } from '@juno/views'
import { useEmojiSuggestions } from './emojiSuggestions'
import { landedTs, refOf } from './messageRows'
import { rowHandlers, useMessageCommands, type Confirming, type Editing, type Picker } from './topic/messageCommands'
import { floatingOf, preloadPicker, usePickerDismiss, useSelectionQuote } from './topic/messageOverlays'

/** What the composer lets the topic do to it. Filled by `TopicComposer` once its draft has loaded. */
export interface ComposerHandle {
  readonly focus: () => void
  /** Adds `> ` lines at the end of the draft, on their own lines, with the caret after them, and focuses the field. */
  readonly quote: (text: string) => void
}

export interface MessageActionsInput {
  readonly detail: TopicDetail
  readonly list: MessageWindow
  readonly scrollRef: RefObject<HTMLElement | null>
  readonly composer: RefObject<ComposerHandle | null>
}

export interface MessageActionsOutput {
  readonly actions: MessageActions
  readonly activeMessage: string | undefined
  readonly confirmingDelete: string | undefined
  readonly editing: { readonly ts: string; readonly editor: ReactNode } | undefined
  readonly onRowKey: (ts: string, event: KeyboardEvent<HTMLElement>) => void
  readonly onToggleReaction: (ts: string, name: string) => void
  /** Retry (`on` as asked) or Dismiss (the opposite) on a reaction Slack refused. */
  readonly onSetReaction: (ts: string, name: string, on: boolean) => void
  /** A right-click on a row, or on its sender's name or avatar. */
  readonly onMessageMenu: (ts: string, at: { readonly clientX: number; readonly clientY: number }, onSender: boolean) => void
  /** ↑ in an empty composer. */
  readonly selectNewest: () => void
  /** The emoji picker or the selection's Quote button, for `TopicView`'s floating slot. */
  readonly floating: ReactNode
}

/** The edit field and the delete question, which end when the window shows the change. */
function useEditState(detail: TopicDetail, list: MessageWindow) {
  'use no memo'
  const [editing, setEditing] = useState<Editing | undefined>(undefined)
  const [confirming, setConfirming] = useState<Confirming | undefined>(undefined)

  // The latest window and state, for callbacks created once.
  const latest = useRef({ list, editing, confirming, detail })
  useLayoutEffect(() => {
    latest.current = { list, editing, confirming, detail }
  })

  // These effects follow the engine's window before paint. The checker skipped them while this was one hook (see below).
  /* oxlint-disable react/set-state-in-effect */
  // A message still sending takes Slack's ts when it lands: an editor open on it moves with it, text and all.
  const landed = editing === undefined || list.rows.has(editing.ts) ? undefined : landedTs(list.rows, editing.ts)
  useLayoutEffect(() => {
    if (landed !== undefined) setEditing((current) => (current === undefined ? current : { ...current, ts: landed }))
  }, [landed])

  // A saved edit ends when the window shows the new text; a sent delete when the row has left.
  const editedRev = editing?.savedRev === undefined ? undefined : list.rows.get(editing.ts)?.rev
  useLayoutEffect(() => {
    if (editing?.savedRev !== undefined && editedRev !== editing.savedRev) setEditing(undefined)
  }, [editing, editedRev])
  const confirmingGone = confirming?.sent === true && !list.rows.has(confirming.ts)
  useLayoutEffect(() => {
    if (confirmingGone) setConfirming(undefined)
  }, [confirmingGone])
  /* oxlint-enable react/set-state-in-effect */
  return { editing, setEditing, confirming, setConfirming, latest }
}

/**
 * The React Compiler skipped this hook while it was one function (its lint
 * suppression, now in `useMessageCommands`), so it and its parts stay out
 * (`'use no memo'`): the list's props change identity as they did.
 */
export function useMessageActions({ detail, list, scrollRef, composer }: MessageActionsInput): MessageActionsOutput {
  'use no memo'
  const channel = detail.channel.id
  const { editing, setEditing, confirming, setConfirming, latest } = useEditState(detail, list)
  const [picker, setPicker] = useState<Picker | undefined>(undefined)
  const [menuMessage, setMenuMessage] = useState<string | undefined>(undefined)
  useEffect(preloadPicker, [])

  const actions = useMessageCommands({ channel, scrollRef, composer, latest, setEditing, setConfirming, setPicker, setMenuMessage })
  const rowMessage = (ts: string) => latest.current.list.rows.get(ts)
  // The hooks below run their effects after the ones above, as when this was one function.
  const [selection, setSelection] = useSelectionQuote(scrollRef)
  usePickerDismiss(picker, setPicker)

  // The edit field in place of the row's body. Saving keeps it until the window has the new text.
  const editingRow =
    editing === undefined
      ? undefined
      : {
          ts: editing.ts,
          editor: (
            <EditField
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
    ...rowHandlers(actions, rowMessage, latest, scrollRef, composer),
    activeMessage: picker?.ts ?? menuMessage,
    confirmingDelete: confirming?.ts,
    editing: editingRow,
    floating: floatingOf(picker, setPicker, selection, setSelection, rowMessage, actions.react, scrollRef, composer),
  }
}

/** The inline edit field with the composer's `:emoji:` suggestions (SPEC 8). */
function EditField({ value, onChange, onSave, onCancel }: Pick<InlineEditProps, 'value' | 'onSave' | 'onCancel'> & { readonly onChange: (value: string) => void }) {
  const field = useRef<HTMLTextAreaElement>(null)
  const emoji = useEmojiSuggestions({ text: value, onChange, field })
  return (
    <InlineEdit
      value={value}
      onChange={emoji.onChange}
      onSave={onSave}
      onCancel={onCancel}
      fieldRef={field}
      onFieldKey={emoji.onFieldKey}
      onCaret={emoji.onCaret}
      {...(emoji.mention === undefined ? {} : { mention: emoji.mention })}
    />
  )
}
