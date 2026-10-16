import { useState } from 'react'

/**
 * A picker list's rows, kept while the next query's rows load, so typing
 * never draws an empty list (inventory 8). `loading` says the rows are an
 * earlier query's. Closing the list drops them, so it opens on fresh rows.
 */
export function useHeld<A>(value: A | undefined, open: boolean): { readonly value: A | undefined; readonly loading: boolean } {
  const [held, setHeld] = useState<A | undefined>(undefined)
  if (!open && held !== undefined) setHeld(undefined)
  else if (open && value !== undefined && value !== held) setHeld(value)
  return { value: open ? (value ?? held) : undefined, loading: open && value === undefined }
}
