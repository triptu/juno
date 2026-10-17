/**
 * The emoji picker as topics and the Juno chat float it: its own chunk, so
 * the catalog is not in the first bundle, fetched when idle after a list
 * paints, and closed by a press outside it or a scroll under it.
 */
import { useEffect } from 'react'
import { chunk } from './chunks'

const emojiPicker = chunk(() => import('./EmojiPickerPanel'))
export const EmojiPickerPanel = emojiPicker.component((module) => module.default)

/** Fetch the picker's chunk once a list has painted, so the first open does not wait for it. */
let pickerLoaded = false
const loadPicker = () => void emojiPicker.load()
export function preloadPicker(): void {
  if (pickerLoaded) return
  pickerLoaded = true
  window.requestIdleCallback(loadPicker)
}

/** While `open`, a press outside the floating picker or a wheel scroll calls `close`. */
export function usePickerDismiss(open: boolean, close: () => void): void {
  'use no memo'
  useEffect(() => {
    if (!open) return
    const outside = (event: Event) => {
      if (!(event.target instanceof Element) || event.target.closest('[data-floating="picker"]') === null) close()
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('wheel', outside, { capture: true, passive: true })
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('wheel', outside, true)
    }
  }, [open, close])
}
