/**
 * An emoji picker floated under the button that opened it, as a popover
 * fixed in place (Settings' quick reactions, the status sheet's emoji
 * button): where it goes, and how it closes and hands focus back.
 */
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

/**
 * A picker that closes with focus in it (Esc, or a pick) gives focus back to
 * the button in `anchorRef`. A press outside, focus moving outside, or a
 * scroll outside it (the page moving under it) closes it.
 */
export function usePickerFocus(anchorRef: RefObject<HTMLElement | null>, pickerRef: RefObject<HTMLElement | null>, pickerOpen: boolean, onClosePicker: (() => void) | undefined) {
  const wasOpen = useRef(false)
  useLayoutEffect(() => {
    const active = document.activeElement
    if (wasOpen.current && !pickerOpen && (active === null || active === document.body)) anchorRef.current?.querySelector('button')?.focus()
    wasOpen.current = pickerOpen
  }, [anchorRef, pickerOpen])

  useEffect(() => {
    if (!pickerOpen || onClosePicker === undefined) return
    const inside = (target: EventTarget | null) =>
      target instanceof Node && ((anchorRef.current?.contains(target) ?? false) || (pickerRef.current?.contains(target) ?? false))
    const outside = (event: Event) => {
      if (!inside(event.target)) onClosePicker()
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('focusin', outside)
    document.addEventListener('scroll', outside, true)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('focusin', outside)
      document.removeEventListener('scroll', outside, true)
    }
  }, [anchorRef, pickerRef, pickerOpen, onClosePicker])
}

/** The picker's gap from its anchor, and from the window's edges (`--space-1`, `--space-2`). */
const GAP = 4
const EDGE = 8

/**
 * Places the open picker under its anchor, its start on the anchor's start,
 * moved in to stay inside the window (or the gallery's frame); over the
 * anchor when there is no room below. Read once, then written, before the first paint, and again
 * when the window resizes.
 */
export function usePickerPlace(anchorRef: RefObject<HTMLElement | null>, pickerRef: RefObject<HTMLElement | null>, pickerOpen: boolean) {
  useLayoutEffect(() => {
    if (!pickerOpen) return
    const place = () => {
      const anchorElement = anchorRef.current
      const picker = pickerRef.current
      if (anchorElement === null || picker === null) return
      const anchor = anchorElement.getBoundingClientRect()
      const box = picker.getBoundingClientRect()
      const bounds = anchorElement.closest('[data-tooltip-bounds]')?.getBoundingClientRect() ?? { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
      const x = Math.max(bounds.left + EDGE, Math.min(anchor.left, bounds.right - EDGE - box.width))
      const below = anchor.bottom + GAP
      const above = anchor.top - GAP - box.height
      const y = below + box.height <= bounds.bottom - EDGE ? below : above >= bounds.top + EDGE ? above : Math.max(bounds.top + EDGE, bounds.bottom - EDGE - box.height)
      picker.style.translate = `${Math.round(x)}px ${Math.round(y)}px`
    }
    place()
    // The picker's chunk may arrive after the first layout; place it again when it has a size.
    const observer = new ResizeObserver(place)
    if (pickerRef.current !== null) observer.observe(pickerRef.current)
    window.addEventListener('resize', place)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', place)
    }
  }, [anchorRef, pickerRef, pickerOpen])
}
