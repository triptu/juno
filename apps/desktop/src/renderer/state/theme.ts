import * as stylex from '@stylexjs/stylex'
import * as Atom from 'effect/reactivity/Atom'
import { dark } from '@juno/tokens/themes.stylex'

export type Theme = 'light' | 'dark'

/** The current theme. Light is the default; the OS setting is not read yet. */
export const themeAtom = Atom.make<Theme>('light')

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
