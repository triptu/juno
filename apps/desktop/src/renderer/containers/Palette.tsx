/**
 * ⌘K's place in the window (spec section 10): nothing while it is closed,
 * the palette (`PaletteContent.tsx`, its own chunk) while it is open. The
 * chunk loads on idle after the first paint, so ⌘K does not wait for it
 * and the first paint does not either (performance 2.1).
 */
import { Suspense, useEffect } from 'react'
import { onMenuCommand, paletteOpenAtom } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { chunk } from './chunks'
import { editLinkInComposer } from './composerLinks'
import { togglePalette } from './paletteActions'

const palette = chunk(() => import('./PaletteContent'))
const loadPalette = palette.load
const OpenPalette = palette.component((module) => module.OpenPalette)

/** ⌘K toggles it, except with words selected in a composer, where it edits their link. */
export function Palette() {
  const open = useAtomValue(paletteOpenAtom)
  useEffect(() => onMenuCommand((command) => command === 'palette.toggle' && !editLinkInComposer() && togglePalette()), [])
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
