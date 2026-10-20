// Slack's markup rules and keys, in a chunk of their own (`composerMarkup.ts`).
import { toggleMarkup, type MarkupStyle } from '@juno/contract'
import { editField } from './suggestionKeys'

export { markupLayout } from '@juno/contract'

/** A key pressed in a composer's field. */
export interface Press {
  readonly key: string
  readonly code: string
  readonly metaKey: boolean
  readonly shiftKey: boolean
  readonly ctrlKey: boolean
  readonly altKey: boolean
  readonly field: HTMLTextAreaElement
}

/** The formatting key `press` is, as in Slack (spec section 8): ⌘B, ⌘I, ⌘⇧X, ⌘⇧C and ⌘⇧9. */
function styleOf(press: Press): MarkupStyle | 'quote' | undefined {
  if (!press.metaKey || press.ctrlKey || press.altKey) return undefined
  const key = press.key.toLowerCase()
  if (!press.shiftKey) return key === 'b' ? 'bold' : key === 'i' ? 'italic' : undefined
  if (key === 'x') return 'strike'
  if (key === 'c') return 'code'
  // ⌘⇧9 by its place on the keyboard: with Shift the key reads "(" on most layouts.
  return press.code === 'Digit9' ? 'quote' : undefined
}

/** A formatting key puts the markers on the selection or takes them off, as one edit typed into the field, so ⌘Z undoes it. True when `press` was one. */
export function formatKey(press: Press): boolean {
  const style = styleOf(press)
  if (style === undefined) return false
  const { field } = press
  const edit = toggleMarkup(field.value, { start: field.selectionStart, end: field.selectionEnd }, style)
  if (edit === undefined) return true
  editField(field, edit.start, edit.end, edit.insert)
  field.setSelectionRange(edit.selection.start, edit.selection.end)
  return true
}
