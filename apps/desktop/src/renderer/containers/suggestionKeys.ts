import type { KeyboardEvent } from 'react'

/** The open list's keys: ↑ ↓ move, Enter or Tab picks, Esc closes. True when the key was taken. */
export function listKey(
  event: KeyboardEvent<HTMLTextAreaElement>,
  ids: ReadonlyArray<string>,
  activeId: string,
  on: { readonly move: (id: string) => void; readonly pick: (id: string) => void; readonly close: () => void },
): boolean {
  const index = ids.indexOf(activeId)
  switch (event.key) {
    case 'ArrowDown':
    case 'ArrowUp':
      event.preventDefault()
      on.move(ids[(index + (event.key === 'ArrowDown' ? 1 : -1) + ids.length) % ids.length]!)
      return true
    case 'Enter':
    case 'Tab':
      if (event.shiftKey) return false
      event.preventDefault()
      on.pick(activeId)
      return true
    case 'Escape':
      event.preventDefault()
      on.close()
      return true
    default:
      return false
  }
}

/** Replaces `from`..`to` in the field the way typing would, so ⌘Z undoes it. */
export function editField(element: HTMLTextAreaElement | null, from: number, to: number, insert: string): void {
  if (element === null) return
  element.setSelectionRange(from, to)
  if (insert === '') document.execCommand('delete')
  else document.execCommand('insertText', false, insert)
}

