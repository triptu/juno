/**
 * Theme overrides. Apply the classes returned here to a subtree (normally the
 * <html> element) with stylex.props(dark) and every token under it switches.
 *
 * Dark is the cool near-black system palette from colors_and_type.css.
 */
import * as stylex from '@stylexjs/stylex'
import { colors, shadows } from './tokens.stylex'

export const darkColors = stylex.createTheme(colors, {
  '--background': 'hsla(210, 5%, 8%, 1)',
  '--background-subtle': 'hsla(210, 5%, 9%, 1)',
  '--surface-default': 'hsla(210, 5%, 11%, 1)',
  '--surface-hover': 'hsla(210, 5%, 13%, 1)',
  '--surface-active': 'hsla(210, 5%, 15%, 1)',

  '--secondary-default': 'hsla(210, 5%, 16%, 1)',
  '--secondary-hover': 'hsla(210, 5%, 18%, 1)',
  '--secondary-active': 'hsla(210, 5%, 20%, 1)',

  '--border-subtle': 'hsla(210, 5%, 12%, 1)',
  '--border-default': 'hsla(210, 5%, 15%, 1)',
  '--border-strong': 'hsla(210, 5%, 16%, 1)',
  '--border-strongest': 'hsla(210, 5%, 21%, 1)',

  '--foreground-default': 'hsla(45, 30%, 90%, 1)',
  '--foreground-subtle': 'hsla(45, 10%, 80%, 1)',
  '--foreground-muted': 'hsla(45, 2%, 55%, 1)',

  '--accent-default': 'hsla(48, 30%, 90%, 1)',
  '--accent-hover': 'hsla(48, 30%, 95%, 1)',
  '--accent-active': 'hsla(48, 30%, 99%, 1)',
  '--accent-foreground': 'hsla(48, 10%, 2%, 1)',
  '--accent-foreground-subtle': 'hsla(48, 10%, 5%, 1)',
  '--accent-foreground-muted': 'hsla(48, 10%, 10%, 1)',

  '--selection-background': 'hsla(200, 97%, 20%, 1)',
})

export const darkShadows = stylex.createTheme(shadows, {
  '--shadow-sm': '0 1px 2px 0 rgba(0, 0, 0, 0.30)',
  '--shadow-md': '0 2px 6px 0 rgba(0, 0, 0, 0.40)',
  '--shadow-card': '0 0 12px 0 rgba(0, 0, 0, 0.45)',
  '--shadow-lg': '0 8px 24px 0 rgba(0, 0, 0, 0.50)',
})

/** Everything that changes in dark mode. Pass to stylex.props(). */
export const dark = [darkColors, darkShadows] as const
