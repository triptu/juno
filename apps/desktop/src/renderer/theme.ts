import * as stylex from '@stylexjs/stylex'
import type { Theme } from '@juno/state'
import { dark } from '@juno/tokens/themes.stylex'

const darkClassNames = (stylex.props(...dark).className ?? '').split(' ').filter(Boolean)

/**
 * Applies the theme to <html>, so every token under it (including portals
 * attached to <body>) switches in one frame.
 */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  for (const name of darkClassNames) root.classList.toggle(name, theme === 'dark')
  root.style.colorScheme = theme
}
