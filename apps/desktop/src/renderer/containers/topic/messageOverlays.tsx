/**
 * What a topic's message actions draw over the list (see `../messageActions`):
 * the emoji picker, the selection's Quote button and the edit field. Its
 * hooks stay out of the React Compiler, as `useMessageActions` does.
 */
import { lazy, Suspense, useEffect, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import type { MessageView } from '@juno/contract'
import { editMessage, registry } from '@juno/state'
import { Floating, InlineEdit, SelectionQuote } from '@juno/views'
import type { ComposerHandle } from '../messageActions'
import { refOf } from '../messageRows'
import { recentEmoji } from '../recentEmoji'
import { focusRow, middleOf, type Editing, type Picker } from './messageCommands'

const EmojiPickerPanel = lazy(() => import('../EmojiPickerPanel'))

/** Fetch the picker's chunk once a topic has painted, so the first open does not wait for it. */
let pickerLoaded = false
const loadPicker = () => void import('../EmojiPickerPanel')
export function preloadPicker(): void {
  if (pickerLoaded) return
  pickerLoaded = true
  window.requestIdleCallback(loadPicker)
}

/** The node is inside a message's text in this list. */
const inMessageText = (node: Node | null, scroller: HTMLElement) => (node instanceof Element ? node : node?.parentElement)?.closest('[data-msg-text]') != null && scroller.contains(node)

type Selection = { readonly x: number; readonly y: number }

/** The selection's Quote button: shown when a drag or a Shift-arrow selection ends inside a message's text. */
export function useSelectionQuote(scrollRef: RefObject<HTMLElement | null>) {
  'use no memo'
  const [selection, setSelection] = useState<Selection | undefined>(undefined)
  useEffect(() => {
    const scroller = scrollRef.current
    if (scroller === null) return
    const place = () => {
      const current = window.getSelection()
      if (current === null || current.isCollapsed || current.rangeCount === 0) return setSelection(undefined)
      const range = current.getRangeAt(0)
      if (!inMessageText(range.startContainer, scroller) || !inMessageText(range.endContainer, scroller) || current.toString().trim() === '') return setSelection(undefined)
      const area = middleOf(scrollRef)
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
  }, [scrollRef])
  return [selection, setSelection] as const
}

/** The picker closes on a press outside it and when the list scrolls under it. */
export function usePickerDismiss(picker: Picker | undefined, setPicker: Dispatch<SetStateAction<Picker | undefined>>): void {
  'use no memo'
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
  }, [picker, setPicker])
}

interface FloatingInput {
  readonly picker: Picker | undefined
  readonly setPicker: Dispatch<SetStateAction<Picker | undefined>>
  readonly selection: Selection | undefined
  readonly setSelection: Dispatch<SetStateAction<Selection | undefined>>
  readonly rowMessage: (ts: string) => MessageView | undefined
  readonly react: (message: MessageView, name: string) => void
  readonly scrollRef: RefObject<HTMLElement | null>
  readonly composer: RefObject<ComposerHandle | null>
}

/** The emoji picker or the selection's Quote button, for `TopicView`'s floating slot. */
export function floatingOf({ picker, setPicker, selection, setSelection, rowMessage, react, scrollRef, composer }: FloatingInput) {
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
    if (ts !== undefined) focusRow(scrollRef, ts)
  }
  const pick = (name: string) => {
    const message = picker === undefined ? undefined : rowMessage(picker.ts)
    setPicker(undefined)
    if (message !== undefined) react(message, name)
  }

  return picker !== undefined ? (
    <Floating x={picker.x} y={picker.y} placement={picker.placement} layer="picker">
      <Suspense fallback={null}>
        <EmojiPickerPanel recent={recentEmoji()} onPick={pick} onClose={closePicker} />
      </Suspense>
    </Floating>
  ) : selection !== undefined ? (
    <Floating x={selection.x} y={selection.y} placement="above-center" layer="selection">
      <SelectionQuote onQuote={quoteSelection} />
    </Floating>
  ) : null
}

interface EditorInput {
  readonly channel: string
  readonly editing: Editing | undefined
  readonly setEditing: Dispatch<SetStateAction<Editing | undefined>>
  readonly rowMessage: (ts: string) => MessageView | undefined
  readonly composer: RefObject<ComposerHandle | null>
}

/** The edit field in place of the row's body. Saving keeps it until the window has the new text. */
export function editingRowOf({ channel, editing, setEditing, rowMessage, composer }: EditorInput) {
  return editing === undefined
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
}
