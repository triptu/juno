import * as stylex from '@stylexjs/stylex'
import { accents, dark, type AccentName } from '@juno/tokens/themes.stylex'

export type ThemeName = 'light' | 'dark'

export const accentNames: ReadonlyArray<AccentName> = ['ink', 'midnight', 'emerald', 'claret', 'cyan']
export const themeNames: ReadonlyArray<ThemeName> = ['light', 'dark']

export function isThemeName(value: string | null): value is ThemeName {
  return value === 'light' || value === 'dark'
}

export function isAccentName(value: string | null): value is AccentName {
  return accentNames.includes(value as AccentName)
}

let previous: string[] = []

/**
 * Puts the theme classes on <html>, the way the app does, so tokens mixed on
 * the root (tints, --hl-soft) follow the theme. Transitions are suppressed
 * for two frames while the classes swap.
 */
export function applyTheme(theme: ThemeName, accent: AccentName): void {
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
