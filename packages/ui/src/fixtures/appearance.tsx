import { createContext, useContext } from 'react'
import type { AccentName, ThemeName } from '../theme'

/** The theme and accent the gallery draws a fixture in. */
export interface FixtureAppearance {
  readonly theme: ThemeName
  readonly accent: AccentName
}

/**
 * Set by the gallery around each state's frame. A fixture that shows the
 * theme or accent controls reads it, so the selected segment and swatch
 * match the colours the page is drawn in. Light and coral outside the gallery.
 */
export const FixtureAppearanceContext = createContext<FixtureAppearance>({ theme: 'light', accent: 'coral' })

export function useFixtureAppearance(): FixtureAppearance {
  return useContext(FixtureAppearanceContext)
}
