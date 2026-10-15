/**
 * Opening and closing ⌘K (spec section 10). In the first bundle, for the
 * Search button and the menu; what the rows do is in the palette's chunk
 * (`PaletteContent.tsx`).
 */
import { paletteOpenAtom, registry } from '@juno/state'
import { mark } from '@juno/state/perf'

/** Where focus was before the palette opened, to give it back on close. */
let returnFocus: HTMLElement | undefined

export function openPalette(): void {
  if (registry.get(paletteOpenAtom)) return
  mark('juno.palette-open', undefined, { replace: true })
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
  registry.set(paletteOpenAtom, true)
}

/** Closes the palette. `restoreFocus` is false when a row opened something that takes focus itself. */
export function closePalette(restoreFocus = true): void {
  if (!registry.get(paletteOpenAtom)) return
  registry.set(paletteOpenAtom, false)
  const target = returnFocus
  returnFocus = undefined
  if (restoreFocus && target?.isConnected === true) target.focus({ preventScroll: true })
}

/** ⌘K toggles: it opens the palette, and closes it again. */
export function togglePalette(): void {
  if (registry.get(paletteOpenAtom)) closePalette()
  else openPalette()
}
