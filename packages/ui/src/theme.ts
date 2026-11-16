import * as stylex from '@stylexjs/stylex'
import { accentNames, accents, compact, dark, windowsTitlebar, type AccentName } from '@juno/tokens/themes.stylex'
import { isWindows } from './platform'

export type ThemeName = 'light' | 'dark'
/** What the owner picks: System follows macOS. */
export type ThemePreference = 'system' | ThemeName
/** Settings › Appearance › Density (inventory 3.3). */
export type DensityName = 'comfortable' | 'compact'
export type { AccentName }

export const themeNames: ReadonlyArray<ThemeName> = ['light', 'dark']
export { accentNames }

/** Coral. Matches `DEFAULT_ACCENT` in `@juno/contract`. */
export const defaultAccent: AccentName = 'coral'

/** What the picker calls each accent. */
export const accentLabels: Readonly<Record<AccentName, string>> = {
  coral: 'Coral',
  ink: 'Near-black',
  marigold: 'Marigold',
  teal: 'Teal',
  midnight: 'Midnight blue',
  emerald: 'Dark emerald',
  claret: 'Claret',
  cyan: 'Cyan',
}

export function isThemeName(value: unknown): value is ThemeName {
  return value === 'light' || value === 'dark'
}

export function isAccentName(value: unknown): value is AccentName {
  return typeof value === 'string' && accentNames.includes(value as AccentName)
}

/**
 * Compact density for one subtree, whatever the app's density: pass it to
 * `stylex.props` on the root. Peek reads its messages in compact rows.
 */
export const compactDensity = compact

let previous: ReadonlyArray<string> = []

/**
 * Puts the theme classes on <html>, so every token under it switches,
 * including portals attached to <body> and the tints mixed on the root.
 * The accent has a theme per colour scheme, so the pair is chosen here,
 * Compact density overrides the `density` group, and Windows the title bar's
 * room for the window buttons.
 * Transitions are suppressed for two frames while the classes swap
 * (`data-theme-switching`, see tokens/global.css), so the theme changes in
 * one frame instead of cross-fading element by element.
 */
export function applyTheme(theme: ThemeName, accent: AccentName = defaultAccent, density: DensityName = 'comfortable'): void {
  const root = document.documentElement
  root.setAttribute('data-theme-switching', '')
  for (const name of previous) root.classList.remove(name)
  const { className } = stylex.props(theme === 'dark' && dark, accents[accent][theme], density === 'compact' && compact, isWindows && windowsTitlebar)
  previous = (className ?? '').split(' ').filter(Boolean)
  for (const name of previous) root.classList.add(name)
  root.style.colorScheme = theme
  root.dataset['theme'] = theme
  root.dataset['accent'] = accent
  root.dataset['density'] = density
  requestAnimationFrame(() => requestAnimationFrame(() => root.removeAttribute('data-theme-switching')))
}

/**
 * Privacy mode (SPEC section 5): `data-privacy` on <html> blurs every element
 * marked `data-sensitive` (tokens/global.css). One attribute, so turning it
 * on or off re-renders nothing.
 */
export function applyPrivacy(on: boolean): void {
  document.documentElement.toggleAttribute('data-privacy', on)
}
