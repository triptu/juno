/**
 * What a topic's message actions draw over the list (see `../messageActions`):
 * the emoji picker and the selection's Quote button. Its
 * hooks stay out of the React Compiler, as `useMessageActions` does.
 */
import { Suspense, useEffect, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import type { MessageView, QuickReaction } from '@juno/contract'
import { Floating, SelectionQuote } from '@juno/views'
import { chunk } from '../chunks'
import type { ComposerHandle } from '../messageActions'
import { frequentEmoji } from '../recentEmoji'
import { focusRow, middleOf, type Picker } from './messageCommands'

const emojiPicker = chunk(() => import('../EmojiPickerPanel'))
const EmojiPickerPanel = emojiPicker.component((module) => module.default)

/** Fetch the picker's chunk once a topic has painted, so the first open does not wait for it. */
let pickerLoaded = false
const loadPicker = () => void emojiPicker.load()
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

/** The emoji picker or the selection's Quote button, for `TopicView`'s floating slot. */
export function floatingOf(
  picker: Picker | undefined,
  setPicker: Dispatch<SetStateAction<Picker | undefined>>,
  selection: Selection | undefined,
  setSelection: Dispatch<SetStateAction<Selection | undefined>>,
  rowMessage: (ts: string) => MessageView | undefined,
  react: (message: MessageView, name: string) => void,
  scrollRef: RefObject<HTMLElement | null>,
  composer: RefObject<ComposerHandle | null>,
  quick: ReadonlyArray<QuickReaction>,
) {
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
    <Suspense fallback={null}>
      <Floating x={picker.x} y={picker.y} placement={picker.placement} layer="picker">
        <EmojiPickerPanel recent={frequentEmoji(quick)} onPick={pick} onClose={closePicker} />
      </Floating>
    </Suspense>
  ) : selection !== undefined ? (
    <Floating x={selection.x} y={selection.y} placement="above-center" layer="selection">
      <SelectionQuote onQuote={quoteSelection} />
    </Floating>
  ) : null
}
