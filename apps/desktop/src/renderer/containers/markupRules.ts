// Slack's markup rules and keys, in a chunk of their own (`composerMarkup.ts`).
import { toggleMarkup, type MarkupStyle } from '@juno/contract'
import { editField } from './suggestionKeys'
import { isWindows } from '@juno/views'

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

/** The formatting key `press` is, as in Slack (spec section 8): ⌘B, ⌘I, ⌘⇧X, ⌘⇧C and ⌘⇧9. */
function styleOf(press: Press): MarkupStyle | 'quote' | undefined {
  if ((isWindows ? !press.ctrlKey || press.metaKey : !press.metaKey || press.ctrlKey) || press.altKey) return undefined
  const key = press.key.toLowerCase()
  if (!press.shiftKey) return key === 'b' ? 'bold' : key === 'i' ? 'italic' : undefined
  if (key === 'x') return 'strike'
  if (key === 'c') return 'code'
  // ⌘⇧9 by its place on the keyboard: with Shift the key reads "(" on most layouts.
  return press.code === 'Digit9' ? 'quote' : undefined
}

/** A formatting key puts the markers on the selection or takes them off, as one edit typed into the field, so ⌘Z undoes it. Returns the edit for rebasing queued selections. */
export function formatKey(press: Press) {
  const style = styleOf(press)
  if (style === undefined) return undefined
  const { field } = press
  if (document.activeElement !== field || field.value !== press.value) return undefined
  const edit = toggleMarkup(press.value, { start: press.start, end: press.end }, style, press.atomic)
  if (edit === undefined) return undefined
  editField(field, edit.start, edit.end, edit.insert)
  field.setSelectionRange(edit.selection.start, edit.selection.end)
  return edit
}

/** Rebase later keydown selections through earlier formatting edits in the same cold batch. */
export function formatKeys(captured: ReadonlyArray<Press>): void {
  const presses = [...captured]
  for (let i = 0; i < presses.length; i++) {
    const press = presses[i]!
    const edit = formatKey(press)
    if (edit === undefined) continue
    const value = press.field.value
    const delta = edit.insert.length - (edit.end - edit.start)
    const position = (at: number) => at <= edit.start ? at : at >= edit.end ? at + delta : edit.selection.start + at - press.start
    for (let j = i + 1; j < presses.length; j++) {
      const next = presses[j]!
      if (next.value !== press.value) continue
      const range = next.start === press.start && next.end === press.end ? edit.selection : { start: position(next.start), end: position(next.end) }
      presses[j] = { ...next, ...range, value, atomic: next.atomic.map((range) => range.start === edit.start && range.end === edit.end ? edit.selection : { start: position(range.start), end: position(range.end) }) }
    }
  }
}
