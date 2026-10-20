// Slack's markup rules and keys, in a chunk of their own (`composerMarkup.ts`).
import { toggleMarkup, type MarkupStyle } from '@juno/contract'
export { prepareTextareaFormatting } from '@juno/views'
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
  readonly value: string
  readonly start: number
  readonly end: number
  readonly atomic: ReadonlyArray<{ readonly start: number; readonly end: number }>
}

/** The app's shortcuts take ⌘ on the Mac and Ctrl elsewhere, as the menu's `CommandOrControl` does (the test machines run Linux). */
const MAC = navigator.platform.startsWith('Mac')

/** The formatting key `press` is, as in Slack (spec section 8): ⌘B, ⌘I, ⌘⇧X, ⌘⇧C and ⌘⇧9. */
function styleOf(press: Press): MarkupStyle | 'quote' | undefined {
  if ((MAC ? !press.metaKey || press.ctrlKey : !press.ctrlKey || press.metaKey) || press.altKey) return undefined
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
  if (document.activeElement !== field || field.value !== press.value) return true
  const edit = toggleMarkup(press.value, { start: press.start, end: press.end }, style, press.atomic)
  if (edit === undefined) return true
  editField(field, edit.start, edit.end, edit.insert)
  field.setSelectionRange(edit.selection.start, edit.selection.end)
  return true
}
