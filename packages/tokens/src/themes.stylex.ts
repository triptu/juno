/**
 * Theme overrides. Apply the classes with stylex.props(...) to <html> so every
 * token under it switches, including portals attached to <body>. Tints and
 * --hl-soft are mixed from the base variables on the same element, so they
 * follow whichever theme is applied without their own overrides.
 *
 * Dark is the cool near-black system palette. The accent themes are the four
 * optional brand colours; the default accent is the near-black ink and needs
 * no class.
 */
import * as stylex from '@stylexjs/stylex'
import { accent, colors, shadows } from './tokens.stylex'

export const darkColors = stylex.createTheme(colors, {
  '--background': 'hsla(210, 5%, 8%, 1)',
  '--background-subtle': 'hsla(210, 5%, 9%, 1)',
  '--surface-default': 'hsla(210, 5%, 11%, 1)',
  '--surface-hover': 'hsla(210, 5%, 13%, 1)',
  '--surface-active': 'hsla(210, 5%, 15%, 1)',
  '--surface-raised': 'hsla(210, 5%, 18%, 1)',

  '--secondary-default': 'hsla(210, 5%, 16%, 1)',
  '--secondary-hover': 'hsla(210, 5%, 18%, 1)',
  '--secondary-active': 'hsla(210, 5%, 20%, 1)',

  '--border-subtle': 'hsla(210, 5%, 12%, 1)',
  '--border-default': 'hsla(210, 5%, 15%, 1)',
  '--border-strong': 'hsla(210, 5%, 16%, 1)',
  '--border-strongest': 'hsla(210, 5%, 21%, 1)',
  '--input-border': 'hsla(210, 5%, 24%, 1)',

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
  '--focus-ring': 'hsla(200, 80%, 65%, 1)',
  '--overlay': 'rgba(0, 0, 0, 0.45)',
})

export const darkShadows = stylex.createTheme(shadows, {
  '--shadow-sm': '0 1px 2px 0 rgba(0, 0, 0, 0.30)',
  '--shadow-md': '0 2px 6px 0 rgba(0, 0, 0, 0.40)',
  '--shadow-card': '0 0 12px 0 rgba(0, 0, 0, 0.45)',
  '--shadow-lg': '0 8px 24px 0 rgba(0, 0, 0, 0.50)',
  '--card-ring': '0 0 0 1px oklch(1 0 0 / 0.08)',
  '--pop-shadow': '0 0 0 1px oklch(1 0 0 / 0.1), 0 8px 24px oklch(0 0 0 / 0.5)',
})

/** Everything that changes in dark mode. Spread into stylex.props(). */
export const dark = [darkColors, darkShadows] as const

/**
 * Accent themes. Each overrides --hl and --hl-fg; the soft, rule and ring
 * variants are mixed from --hl at use time. Cyan is the one accent whose
 * off-white text would fail 4.5:1 (3.8:1), so it takes near-black text.
 */
export const accentMidnight = stylex.createTheme(accent, {
  '--hl': '#2E1F64',
  '--hl-fg': '#FFFAEB',
  '--hl-soft': `color-mix(in oklch, #2E1F64 9%, ${colors['--background']})`,
  '--hl-rule': 'color-mix(in oklch, #2E1F64 30%, transparent)',
  '--hl-ring': 'color-mix(in oklch, #2E1F64 45%, transparent)',
})

export const accentEmerald = stylex.createTheme(accent, {
  '--hl': '#00674F',
  '--hl-fg': '#FFFAEB',
  '--hl-soft': `color-mix(in oklch, #00674F 9%, ${colors['--background']})`,
  '--hl-rule': 'color-mix(in oklch, #00674F 30%, transparent)',
  '--hl-ring': 'color-mix(in oklch, #00674F 45%, transparent)',
})

export const accentClaret = stylex.createTheme(accent, {
  '--hl': '#7F1734',
  '--hl-fg': '#FFFAEB',
  '--hl-soft': `color-mix(in oklch, #7F1734 9%, ${colors['--background']})`,
  '--hl-rule': 'color-mix(in oklch, #7F1734 30%, transparent)',
  '--hl-ring': 'color-mix(in oklch, #7F1734 45%, transparent)',
})

export const accentCyan = stylex.createTheme(accent, {
  '--hl': '#008AB3',
  '--hl-fg': 'hsla(48, 10%, 2%, 1)',
  '--hl-soft': `color-mix(in oklch, #008AB3 9%, ${colors['--background']})`,
  '--hl-rule': 'color-mix(in oklch, #008AB3 30%, transparent)',
  '--hl-ring': 'color-mix(in oklch, #008AB3 45%, transparent)',
})

export type AccentName = 'ink' | 'midnight' | 'emerald' | 'claret' | 'cyan'

/** Accent name to theme. Ink is the default and has no override. */
export const accents = {
  ink: null,
  midnight: accentMidnight,
  emerald: accentEmerald,
  claret: accentClaret,
  cyan: accentCyan,
} as const
