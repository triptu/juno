import * as stylex from '@stylexjs/stylex'
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { colors, spacing, z } from '@juno/tokens/tokens.stylex'

/**
 * Told when a sheet opens and closes, so the app can hold what is behind it
 * (the sidebar's order, SPEC 5). The app provides it once; without it,
 * nothing is told.
 */
export const SheetOpenContext = createContext<{ readonly opened: () => void; readonly closed: () => void } | undefined>(undefined)

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'

/**
 * Dims the page under a centred sheet. Escape calls `onClose`; a click
 * outside does nothing, so a sheet is never lost by accident. Like a macOS
 * sheet it holds the keyboard: Tab and Shift Tab go round its controls and
 * never reach the page under the dim, and on close focus goes back to what
 * opened it.
 */
export function SheetLayer({ onClose, children }: { readonly onClose: () => void; readonly children: ReactNode }) {
  const close = useRef(onClose)
  const layer = useRef<HTMLDivElement>(null)
  // Read on the first render, before the sheet's own autofocused button takes focus.
  const [opener] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null))
  const told = useContext(SheetOpenContext)
  // Before the first paint, so nothing behind the sheet moves in the frame it opens.
  useLayoutEffect(() => {
    if (told === undefined) return
    told.opened()
    return told.closed
  }, [told])
  useEffect(() => {
    close.current = onClose
  })
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') return close.current()
      if (event.key !== 'Tab' || layer.current === null) return
      const stops = [...layer.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
      const first = stops[0]
      const last = stops.at(-1)
      if (first === undefined || last === undefined) return
      const inside = layer.current.contains(document.activeElement)
      if (event.shiftKey && (!inside || document.activeElement === first)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (!inside || document.activeElement === last)) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (opener?.isConnected === true) opener.focus()
    }
  }, [opener])
  return (
    <div ref={layer} {...stylex.props(styles.layer)}>
      {children}
    </div>
  )
}

const styles = stylex.create({
  layer: {
    position: 'fixed',
    inset: 0,
    zIndex: z['--z-palette'],
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing['--space-6'],
    backgroundColor: colors['--overlay'],
    // Over the title bars' drag strips, which would otherwise take the press (as the palette's overlay).
    WebkitAppRegion: 'no-drag',
  },
})
