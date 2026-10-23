/**
 * What a topic's messages do (SPEC section 7: the message menu, Keyboard,
 * Quoting and reactions), wired to the engine.
 *
 * - The menu, on a right-click, the context-menu key or ⇧F10: the emoji
 *   grid (the quick reactions from Settings › Appearance first) and More
 *   reactions, then the message's actions (`topic/messageMenu.ts`).
 * - Your own messages: Edit turns the body into a field in place; Delete…
 *   asks once at the message's top right (ADR 0010). Neither has an undo.
 * - The keyboard: ↑ in an empty composer selects the newest message, ↑ and
 *   ↓ move, Esc goes back to the composer. Q quotes the selected message.
 *   On your own selected message E
 *   edits, and Delete or Backspace asks to delete; Enter confirms and Esc
 *   cancels.
 * - Quote: the whole message from the menu, or the selected text from the
 *   menu or the selection's bar, as "> " lines at the end of the draft.
 *   Ask Juno takes it to the Juno panel instead.
 *
 * Every change is a command that writes locally and answers at once; the
 * list shows it from the engine's next window. The edit field stays until
 * that window has the new text, so the old text never flashes back.
 */
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import type { TopicDetail } from '@juno/contract'
import { resolveMessageAction, editMessage, junoAvailableAtom, registry, type MessageWindow } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import type { MenuAt, MessageActions } from '@juno/views'
import { chunk, usePreloaded } from './chunks'
import { landedTs, refOf } from './messageRows'
import { preloadMessageMenu, useMessageMenuOpen } from './messageMenu'
import { rowHandlers, useMessageCommands, type Confirming, type Editing, type SeeingReactions } from './topic/messageCommands'
import { useSentSuggestions } from './topic/sentSuggestion'
import { selectionBar, useSelectionQuote } from './topic/messageOverlays'

// The edit field shows only after Edit or E, so it loads when idle once a topic has mounted.
const editField = chunk(() => import('./EditFieldPanel'))
const EditField = editField.component((module) => module.EditField)
// The reactions dialog opens from a card's See all, so it loads when idle too.
const reactionsDialog = chunk(() => import('./ReactionsDialogPanel'))
const ReactionsDialog = reactionsDialog.component((module) => module.ReactionsDialogPanel)

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
  readonly suggestions: ReturnType<typeof useSentSuggestions>
  readonly actions: MessageActions
  readonly activeMessage: string | undefined
  readonly confirmingDelete: string | undefined
  readonly editing: { readonly ts: string; readonly editor: ReactNode } | undefined
  readonly onRowKey: (ts: string, event: KeyboardEvent<HTMLElement>) => void
  readonly onToggleReaction: (ts: string, name: string) => void
  /** Retry (`on` as asked) or Dismiss (the opposite) on a reaction Slack refused. */
  /** A right-click on a row, or on its sender's name or avatar, or a press on its menu button (`at.trigger`). */
  readonly onMessageMenu: (ts: string, at: MenuAt, onSender: boolean) => void
  /** ↑ in an empty composer. */
  readonly selectNewest: () => void
  /** The selection's bar and the reactions dialog, for `TopicView`'s floating slot. */
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
  const suggestions = useSentSuggestions(list, setEditing, editing)
  const [menuMessage, setMenuMessage] = useState<string | undefined>(undefined)
  const [reactions, setReactions] = useState<SeeingReactions | undefined>(undefined)
  useEffect(preloadMessageMenu, [])
  const reactionsReady = usePreloaded(reactionsDialog, reactions !== undefined)

  const commands = useMessageCommands({ channel, scrollRef, composer, latest, setEditing, setConfirming, setMenuMessage, setReactions })
  // Ask Juno on a selection shows only while AI assist is on.
  const juno = useAtomValue(junoAvailableAtom)
  const actions = useMemo(() => ({ ...commands, onResolveAction: (id: number, retry: boolean) => { void resolveMessageAction(registry, id, retry) } }), [commands])
  const rowMessage = (ts: string) => latest.current.list.rows.get(ts)
  // The hooks below run their effects after the ones above, as when this was one function.
  const [selection, setSelection] = useSelectionQuote(scrollRef)
  // The selection's bar steps aside while a message menu is open.
  const menuOpen = useMessageMenuOpen()
  const editReady = usePreloaded(editField, editing !== undefined)

  // The edit field in place of the row's body, once its chunk is here. Saving keeps it until the window has the new text.
  const editingRow =
    editing === undefined || !editReady
      ? undefined
      : {
          ts: editing.ts,
          editor: (
            <Suspense fallback={null}>
              <EditField
                value={editing.text}
                body={rowMessage(editing.ts)?.body}
                onChange={(text) => setEditing((current) => (current === undefined || current.savedRev !== undefined ? current : { ...current, text }))}
                onCancel={() => {
                  setEditing(undefined)
                  composer.current?.focus()
                }}
                onSave={(encoded) => {
                  const message = rowMessage(editing.ts)
                  if (message === undefined || editing.savedRev !== undefined || editing.text.trim() === '') return
                  composer.current?.focus()
                  if (editing.text === message.editText) return setEditing(undefined)
                  setEditing({ ...editing, savedRev: message.rev })
                  void editMessage(registry, refOf(channel, message), encoded).then((exit) => {
                    if (exit._tag === 'Failure') setEditing(undefined)
                  })
                }}
              />
            </Suspense>
          ),
        }

  const handlers = rowHandlers(actions, rowMessage, latest, scrollRef, composer)
  return {
    actions,
    suggestions,
    ...handlers,
    // ↑ selects a message, which E then edits: the field's chunk comes now if the idle preload has not run.
    selectNewest: () => {
      void editField.load()
      handlers.selectNewest()
    },
    activeMessage: menuMessage,
    confirmingDelete: confirming?.ts,
    editing: editingRow,
    floating: (
      <>
        {menuOpen ? null : selectionBar(selection, setSelection, composer, juno)}
        {reactions !== undefined && reactionsReady ? <ReactionsDialog key={reactions.ts} channel={channel} seeing={reactions} message={rowMessage(reactions.ts)} people={latest.current.list.refs.people} onSelect={(name) => setReactions((now) => (now === undefined ? now : { ...now, name }))} onClose={() => setReactions(undefined)} /> : null}
      </>
    ),
  }
}
