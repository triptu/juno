/**
 * ⌘K's place in the window (spec section 10): nothing while it is closed,
 * the palette (`PaletteContent.tsx`, its own chunk) while it is open. The
 * chunk loads on idle after the first paint, so ⌘K does not wait for it
 * and the first paint does not either (performance 2.1).
 */
import { lazy, Suspense, useEffect } from 'react'
import { onMenuCommand, paletteOpenAtom } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { togglePalette } from './paletteActions'

const loadPalette = (() => {
  let loading: Promise<typeof import('./PaletteContent')> | undefined
  return () => (loading ??= import('./PaletteContent'))
})()

const OpenPalette = lazy(() => loadPalette().then((chunk) => ({ default: chunk.OpenPalette })))

/** ⌘K toggles it. */
export function Palette() {
  const open = useAtomValue(paletteOpenAtom)
  useEffect(() => onMenuCommand((command) => command === 'palette.toggle' && togglePalette()), [])
  useEffect(() => {
    const idle = requestIdleCallback(() => void loadPalette(), { timeout: 5_000 })
    return () => cancelIdleCallback(idle)
  }, [])
  return open ? (
    <Suspense fallback={null}>
      <OpenPalette />
    </Suspense>
  ) : null
}
