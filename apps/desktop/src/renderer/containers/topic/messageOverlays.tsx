/**
 * What a topic's message actions draw over the list (see `../messageActions`):
 * the selection's bar (Quote, Ask Juno). Its hooks stay out of the React
 * Compiler, as `useMessageActions` does.
 */
import { useEffect, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { Floating, SelectionToolbar } from '@juno/views'
import { askJunoAboutSelection } from '../juno/actions'
import type { ComposerHandle } from '../messageActions'
import { middleOf } from './messageCommands'

/** The node is inside a message's text in this list. */
const inMessageText = (node: Node | null, scroller: HTMLElement) => (node instanceof Element ? node : node?.parentElement)?.closest('[data-msg-text]') != null && scroller.contains(node)

type Selection = { readonly x: number; readonly y: number }

/** The selection's bar: shown when a drag or a Shift-arrow selection ends inside a message's text. */
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

/** The selection's bar, for `TopicView`'s floating slot. Ask Juno shows only while `juno` (AI assist on). */
export function selectionBar(selection: Selection | undefined, setSelection: Dispatch<SetStateAction<Selection | undefined>>, composer: RefObject<ComposerHandle | null>, juno: boolean) {
  if (selection === undefined) return null
  const quoteSelection = () => {
    const current = window.getSelection()
    const text = current?.toString().trim() ?? ''
    current?.removeAllRanges()
    setSelection(undefined)
    if (text !== '') composer.current?.quote(text)
  }
  const askJuno = () => {
    setSelection(undefined)
    askJunoAboutSelection()
  }
  return (
    <Floating x={selection.x} y={selection.y}>
      <SelectionToolbar onQuote={quoteSelection} {...(juno ? { onAskJuno: askJuno } : {})} />
    </Floating>
  )
}
