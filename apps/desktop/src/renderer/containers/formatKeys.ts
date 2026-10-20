import type { KeyboardEvent } from 'react'
import { toggleMarkup, type MarkupStyle } from '@juno/contract'
import { editField } from './suggestionKeys'

/** The formatting key `event` is, as in Slack (spec section 8): ⌘B, ⌘I, ⌘⇧X, ⌘⇧C and ⌘⇧9. */
function styleOf(event: KeyboardEvent<HTMLTextAreaElement>): MarkupStyle | 'quote' | undefined {
  if (!event.metaKey || event.ctrlKey || event.altKey) return undefined
  const key = event.key.toLowerCase()
  if (!event.shiftKey) return key === 'b' ? 'bold' : key === 'i' ? 'italic' : undefined
  if (key === 'x') return 'strike'
  if (key === 'c') return 'code'
  // ⌘⇧9 by its place on the keyboard: with Shift the key reads "(" on most layouts.
  return event.code === 'Digit9' ? 'quote' : undefined
}

/**
 * A formatting key in a composer's field (spec section 8): the markers go
 * on or come off the selection as one edit typed into the field, so ⌘Z
 * undoes it. True when it took the key.
 */
export function formatKey(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
  if (event.nativeEvent.isComposing) return false
  const style = styleOf(event)
  if (style === undefined) return false
  event.preventDefault()
  const element = event.currentTarget
  const edit = toggleMarkup(element.value, { start: element.selectionStart, end: element.selectionEnd }, style)
  if (edit === undefined) return true
  editField(element, edit.start, edit.end, edit.insert)
  element.setSelectionRange(edit.selection.start, edit.selection.end)
  return true
}
