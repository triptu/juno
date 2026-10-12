import * as stylex from '@stylexjs/stylex'
import { accents, dark, type AccentName } from '@juno/tokens/themes.stylex'

export type ThemeName = 'light' | 'dark'
export type { AccentName }

export const themeNames: ReadonlyArray<ThemeName> = ['light', 'dark']
export const accentNames: ReadonlyArray<AccentName> = ['ink', 'midnight', 'emerald', 'claret', 'cyan']

export function isThemeName(value: unknown): value is ThemeName {
  return value === 'light' || value === 'dark'
}

export function isAccentName(value: unknown): value is AccentName {
  return typeof value === 'string' && accentNames.includes(value as AccentName)
}

let previous: ReadonlyArray<string> = []

/**
 * Puts the theme classes on <html>, so every token under it switches,
 * including portals attached to <body> and the tints mixed on the root.
 * Transitions are suppressed for two frames while the classes swap
 * (`data-theme-switching`, see tokens/global.css), so the theme changes in
 * one frame instead of cross-fading element by element.
 */
export function applyTheme(theme: ThemeName, accent: AccentName = 'ink'): void {
  const root = document.documentElement
  root.setAttribute('data-theme-switching', '')
  for (const name of previous) root.classList.remove(name)
  const accentTheme = accents[accent]
  const { className } = stylex.props(theme === 'dark' && dark, accentTheme ?? null)
  previous = (className ?? '').split(' ').filter(Boolean)
  for (const name of previous) root.classList.add(name)
  root.style.colorScheme = theme
  root.dataset['theme'] = theme
  requestAnimationFrame(() => requestAnimationFrame(() => root.removeAttribute('data-theme-switching')))
}
