/**
 * Whether the share sheet is open (SPEC 20, "Sharing your own"). Share
 * screen in the bar or the tab, Huddle › Share Screen… and ⌘K open it; the
 * sheet itself (`SharePicker.tsx`) is a lazy chunk.
 */
let open = false
const listeners = new Set<() => void>()

function set(next: boolean): void {
  if (next === open) return
  open = next
  for (const listener of listeners) listener()
}

export const openSharePicker = (): void => set(true)
export const closeSharePicker = (): void => set(false)
export const sharePickerOpen = (): boolean => open

export function subscribeSharePicker(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
