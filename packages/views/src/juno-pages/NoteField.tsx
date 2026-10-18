import type { KeyboardEvent } from 'react'
import { Textarea } from '@juno/ui'

export interface NoteFieldProps {
  readonly label: string
  readonly draft: string
  readonly onDraftChange: (draft: string) => void
  readonly onSave: () => void
  readonly onCancel: () => void
}

/**
 * The field for a note or pin under edit on What Juno remembers (SPEC 13.8).
 * It wraps and grows with the text, so the whole note shows when it opens.
 * Return and ⌘Return save, Shift+Return adds a line, Escape cancels. An
 * empty draft does not save, as its dimmed Save button does not.
 */
export function NoteField({ label, draft, onDraftChange, onSave, onCancel }: NoteFieldProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onCancel()
    } else if (event.key === 'Enter' && (event.metaKey || !event.shiftKey)) {
      event.preventDefault()
      event.stopPropagation()
      if (draft.trim().length > 0) onSave()
    }
  }
  return <Textarea variant="field" label={label} value={draft} onChange={(event) => onDraftChange(event.currentTarget.value)} onKeyDown={onKeyDown} autoFocus dir="auto" />
}
