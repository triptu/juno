/**
 * Opening and closing ⌘K (spec section 10). In the first bundle, for the
 * Search button and the menu; what the rows do is in the palette's chunk
 * (`PaletteContent.tsx`).
 */
import { PALETTE_TABS, paletteOpenAtom, paletteTabAtom, registry } from '@juno/state'
import { mark } from '@juno/state/perf'

/** Where focus was before the palette opened, to give it back on close. */
let returnFocus: HTMLElement | undefined

export function openPalette(): void {
  if (registry.get(paletteOpenAtom)) return
  mark('juno.palette-open', undefined, { replace: true })
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
  registry.set(paletteTabAtom, 'all')
  registry.set(paletteOpenAtom, true)
}

/** The message selected when the palette opened (a focused message row), for Start thread. Not a message still sending. */
export function messageBeforePalette(): string | undefined {
  const row = returnFocus?.closest<HTMLElement>('[data-message-row]')
  if (row === null || row === undefined || row.hasAttribute('data-pending')) return undefined
  return row.getAttribute('data-message-row') ?? undefined
}

/** Closes the palette. `restoreFocus` is false when a row opened something that takes focus itself. */
export function closePalette(restoreFocus = true): void {
  if (!registry.get(paletteOpenAtom)) return
  registry.set(paletteOpenAtom, false)
  const target = returnFocus
  returnFocus = undefined
  if (restoreFocus && target?.isConnected === true) target.focus({ preventScroll: true })
}

/** ⌘1 to ⌘4 from the app menu: while the palette is open they pick its tab, not a window tab. Returns whether it took the command. */
export function paletteTakesTabNumber(number: number): boolean {
  const tab = PALETTE_TABS[number - 1]
  if (!registry.get(paletteOpenAtom) || tab === undefined) return false
  registry.set(paletteTabAtom, tab)
  return true
}

/** ⌘K toggles: it opens the palette, and closes it again. */
export function togglePalette(): void {
  if (registry.get(paletteOpenAtom)) closePalette()
  else openPalette()
}
