/**
 * The emoji picker as topics and the Juno chat float it: its own chunk, so
 * the catalog is not in the first bundle, fetched when idle after a list
 * paints, and closed by a press outside it or a scroll under it.
 */
import { useEffect } from 'react'
import { afterPaint, mark, measure } from '@juno/state/perf'
import { chunk } from './chunks'

const emojiPicker = chunk(() => import('./EmojiPickerPanel'))
export const EmojiPickerPanel = emojiPicker.component((module) => module.default)

/** Fetch the picker's chunk once a list has painted, so the first open does not wait for it. */
let pickerLoaded = false
const loadPicker = () => {
  const started = mark('juno.emoji-preload')
  void emojiPicker.load().then((module) => module.workspaceEmojiReady).then(() => measure('juno.emoji-preload', started))
}
export function preloadPicker(): void {
  if (pickerLoaded) return
  pickerLoaded = true
  afterPaint(() => window.requestIdleCallback(loadPicker))
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
