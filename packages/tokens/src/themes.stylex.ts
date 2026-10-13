/**
 * Theme overrides. Apply the classes with stylex.props(...) to <html> so every
 * token under it switches, including portals attached to <body>. Tints and
 * --hl-soft are mixed from the base variables on the same element, so they
 * follow whichever theme is applied without their own overrides.
 *
 * Dark is the near-black palette. Each accent has a light and a dark theme
 * on the `accent` group, because the fill that reads as Coral on paper is
 * too dark to glow on ink; applyTheme() picks the one for the current theme.
 * Coral light is the default and needs no class, but has one so the gallery
 * and the app can switch back to it.
 */
import * as stylex from '@stylexjs/stylex'
import { accent, accentSwatches, colors, shadows } from './tokens.stylex'

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

  '--overlay': 'rgba(0, 0, 0, 0.45)',

  '--warm-soft': 'color-mix(in oklch, #E39A3B 22%, var(--background))',
  // The dark toast is paper on ink, so the check takes more of the green.
  '--toast-success': 'color-mix(in oklch, #00674F 80%, var(--background))',
})

export const darkShadows = stylex.createTheme(shadows, {
  '--shadow-sm': '0 1px 2px 0 rgba(0, 0, 0, 0.30)',
  '--shadow-md': '0 2px 6px 0 rgba(0, 0, 0, 0.40)',
  '--shadow-card': '0 0 12px 0 rgba(0, 0, 0, 0.45)',
  '--shadow-lg': '0 8px 24px 0 rgba(0, 0, 0, 0.50)',
  '--card-ring': '0 1px 2px 0 oklch(0 0 0 / 0.3), 0 6px 20px -4px oklch(0 0 0 / 0.35)',
  '--pop-shadow': '0 2px 6px -1px oklch(0 0 0 / 0.3), 0 14px 36px -8px oklch(0 0 0 / 0.5)',
})

/** The accent picker's swatches in dark: the dark fills of the accent themes below. */
export const darkAccentSwatches = stylex.createTheme(accentSwatches, {
  '--swatch-coral': '#FF8A73',
  '--swatch-coral-fg': '#2A0D06',
  '--swatch-ink': 'hsla(48, 30%, 90%, 1)',
  '--swatch-ink-fg': 'hsla(48, 10%, 2%, 1)',
  '--swatch-marigold': '#F5B83A',
  '--swatch-marigold-fg': '#2B1E00',
  '--swatch-teal': '#45C2BB',
  '--swatch-teal-fg': '#04201E',
  '--swatch-midnight': '#B3A5EA',
  '--swatch-midnight-fg': '#1A1238',
  '--swatch-emerald': '#4FC4A1',
  '--swatch-emerald-fg': '#04261B',
  '--swatch-claret': '#F08BA0',
  '--swatch-claret-fg': '#3B0A18',
  '--swatch-cyan': '#5AC6EC',
  '--swatch-cyan-fg': '#04212E',
})

/** Everything that changes in dark mode. Spread into stylex.props(). */
export const dark = [darkColors, darkShadows, darkAccentSwatches] as const

/*
 * Accent themes. Each sets the fill, the text on it, the accent text, and
 * the mixes. The soft tint is mixed over --background and the nav fill over
 * --background-subtle; dark uses a stronger mix because a tint of a light
 * fill fades into ink faster than a tint of a dark fill fades into paper.
 * The focus ring is the accent text colour, which is held to 4.5:1 on the
 * page in both themes. Contrast for every pair is measured and recorded in
 * docs/design/tokens.md 1.3.
 */

export const accentCoralLight = stylex.createTheme(accent, {
  '--hl': '#CC4628',
  '--hl-fg': '#FFFFFF',
  '--hl-text': '#B4351F',
  '--hl-soft': `color-mix(in oklch, #CC4628 10%, ${colors['--background']})`,
  '--hl-nav': `color-mix(in oklch, #CC4628 9%, ${colors['--background-subtle']})`,
  '--hl-rule': 'color-mix(in oklch, #CC4628 30%, transparent)',
  '--hl-ring': 'color-mix(in oklch, #CC4628 45%, transparent)',
  '--focus-ring': '#B4351F',
  '--selection-background': `color-mix(in oklch, #CC4628 28%, ${colors['--background']})`,
})
export const accentCoralDark = stylex.createTheme(accent, {
  '--hl': '#FF8A73',
  '--hl-fg': '#2A0D06',
  '--hl-text': '#FF9C87',
  '--hl-soft': `color-mix(in oklch, #FF8A73 14%, ${colors['--background']})`,
  '--hl-nav': `color-mix(in oklch, #FF8A73 16%, ${colors['--background-subtle']})`,
  '--hl-rule': 'color-mix(in oklch, #FF8A73 30%, transparent)',
  '--hl-ring': 'color-mix(in oklch, #FF8A73 45%, transparent)',
  '--focus-ring': '#FF9C87',
  '--selection-background': `color-mix(in oklch, #FF8A73 28%, ${colors['--background']})`,
})
export const accentMarigoldLight = stylex.createTheme(accent, {
  '--hl': '#F2A900',
  '--hl-fg': '#2B1E00',
  '--hl-text': '#7F5200',
  '--hl-soft': `color-mix(in oklch, #F2A900 12%, ${colors['--background']})`,
  '--hl-nav': `color-mix(in oklch, #F2A900 11%, ${colors['--background-subtle']})`,
  '--hl-rule': 'color-mix(in oklch, #F2A900 30%, transparent)',
  '--hl-ring': 'color-mix(in oklch, #F2A900 45%, transparent)',
  '--focus-ring': '#7F5200',
  '--selection-background': `color-mix(in oklch, #F2A900 28%, ${colors['--background']})`,
})
export const accentMarigoldDark = stylex.createTheme(accent, {
  '--hl': '#F5B83A',
  '--hl-fg': '#2B1E00',
  '--hl-text': '#F5B83A',
  '--hl-soft': `color-mix(in oklch, #F5B83A 14%, ${colors['--background']})`,
  '--hl-nav': `color-mix(in oklch, #F5B83A 16%, ${colors['--background-subtle']})`,
  '--hl-rule': 'color-mix(in oklch, #F5B83A 30%, transparent)',
  '--hl-ring': 'color-mix(in oklch, #F5B83A 45%, transparent)',
  '--focus-ring': '#F5B83A',
  '--selection-background': `color-mix(in oklch, #F5B83A 28%, ${colors['--background']})`,
})
export const accentTealLight = stylex.createTheme(accent, {
  '--hl': '#0B7A75',
  '--hl-fg': '#FFFFFF',
  '--hl-text': '#096762',
  '--hl-soft': `color-mix(in oklch, #0B7A75 10%, ${colors['--background']})`,
  '--hl-nav': `color-mix(in oklch, #0B7A75 9%, ${colors['--background-subtle']})`,
  '--hl-rule': 'color-mix(in oklch, #0B7A75 30%, transparent)',
  '--hl-ring': 'color-mix(in oklch, #0B7A75 45%, transparent)',
  '--focus-ring': '#096762',
  '--selection-background': `color-mix(in oklch, #0B7A75 28%, ${colors['--background']})`,
})
export const accentTealDark = stylex.createTheme(accent, {
  '--hl': '#45C2BB',
  '--hl-fg': '#04201E',
  '--hl-text': '#5ED0CA',
  '--hl-soft': `color-mix(in oklch, #45C2BB 14%, ${colors['--background']})`,
  '--hl-nav': `color-mix(in oklch, #45C2BB 16%, ${colors['--background-subtle']})`,
  '--hl-rule': 'color-mix(in oklch, #45C2BB 30%, transparent)',
  '--hl-ring': 'color-mix(in oklch, #45C2BB 45%, transparent)',
  '--focus-ring': '#5ED0CA',
  '--selection-background': `color-mix(in oklch, #45C2BB 28%, ${colors['--background']})`,
})
export const accentMidnightLight = stylex.createTheme(accent, {
  '--hl': '#2E1F64',
  '--hl-fg': '#FFFAEB',
  '--hl-text': '#2E1F64',
  '--hl-soft': `color-mix(in oklch, #2E1F64 10%, ${colors['--background']})`,
  '--hl-nav': `color-mix(in oklch, #2E1F64 9%, ${colors['--background-subtle']})`,
  '--hl-rule': 'color-mix(in oklch, #2E1F64 30%, transparent)',
  '--hl-ring': 'color-mix(in oklch, #2E1F64 45%, transparent)',
  '--focus-ring': '#2E1F64',
  '--selection-background': `color-mix(in oklch, #2E1F64 24%, ${colors['--background']})`,
})
export const accentMidnightDark = stylex.createTheme(accent, {
  '--hl': '#B3A5EA',
  '--hl-fg': '#1A1238',
  '--hl-text': '#BDB0F0',
  '--hl-soft': `color-mix(in oklch, #B3A5EA 14%, ${colors['--background']})`,
  '--hl-nav': `color-mix(in oklch, #B3A5EA 16%, ${colors['--background-subtle']})`,
  '--hl-rule': 'color-mix(in oklch, #B3A5EA 30%, transparent)',
  '--hl-ring': 'color-mix(in oklch, #B3A5EA 45%, transparent)',
  '--focus-ring': '#BDB0F0',
  '--selection-background': `color-mix(in oklch, #B3A5EA 28%, ${colors['--background']})`,
})
export const accentEmeraldLight = stylex.createTheme(accent, {
  '--hl': '#00674F',
  '--hl-fg': '#FFFAEB',
  '--hl-text': '#00674F',
  '--hl-soft': `color-mix(in oklch, #00674F 10%, ${colors['--background']})`,
  '--hl-nav': `color-mix(in oklch, #00674F 9%, ${colors['--background-subtle']})`,
  '--hl-rule': 'color-mix(in oklch, #00674F 30%, transparent)',
  '--hl-ring': 'color-mix(in oklch, #00674F 45%, transparent)',
  '--focus-ring': '#00674F',
  '--selection-background': `color-mix(in oklch, #00674F 28%, ${colors['--background']})`,
})
export const accentEmeraldDark = stylex.createTheme(accent, {
  '--hl': '#4FC4A1',
  '--hl-fg': '#04261B',
  '--hl-text': '#63D0AF',
  '--hl-soft': `color-mix(in oklch, #4FC4A1 14%, ${colors['--background']})`,
  '--hl-nav': `color-mix(in oklch, #4FC4A1 16%, ${colors['--background-subtle']})`,
  '--hl-rule': 'color-mix(in oklch, #4FC4A1 30%, transparent)',
  '--hl-ring': 'color-mix(in oklch, #4FC4A1 45%, transparent)',
  '--focus-ring': '#63D0AF',
  '--selection-background': `color-mix(in oklch, #4FC4A1 28%, ${colors['--background']})`,
})
export const accentClaretLight = stylex.createTheme(accent, {
  '--hl': '#7F1734',
  '--hl-fg': '#FFFAEB',
  '--hl-text': '#7F1734',
  '--hl-soft': `color-mix(in oklch, #7F1734 10%, ${colors['--background']})`,
  '--hl-nav': `color-mix(in oklch, #7F1734 9%, ${colors['--background-subtle']})`,
  '--hl-rule': 'color-mix(in oklch, #7F1734 30%, transparent)',
  '--hl-ring': 'color-mix(in oklch, #7F1734 45%, transparent)',
  '--focus-ring': '#7F1734',
  '--selection-background': `color-mix(in oklch, #7F1734 26%, ${colors['--background']})`,
})
export const accentClaretDark = stylex.createTheme(accent, {
  '--hl': '#F08BA0',
  '--hl-fg': '#3B0A18',
  '--hl-text': '#F59DB0',
  '--hl-soft': `color-mix(in oklch, #F08BA0 14%, ${colors['--background']})`,
  '--hl-nav': `color-mix(in oklch, #F08BA0 16%, ${colors['--background-subtle']})`,
  '--hl-rule': 'color-mix(in oklch, #F08BA0 30%, transparent)',
  '--hl-ring': 'color-mix(in oklch, #F08BA0 45%, transparent)',
  '--focus-ring': '#F59DB0',
  '--selection-background': `color-mix(in oklch, #F08BA0 28%, ${colors['--background']})`,
})
export const accentCyanLight = stylex.createTheme(accent, {
  '--hl': '#008AB3',
  '--hl-fg': 'hsla(48, 10%, 2%, 1)',
  '--hl-text': '#006A8A',
  '--hl-soft': `color-mix(in oklch, #008AB3 10%, ${colors['--background']})`,
  '--hl-nav': `color-mix(in oklch, #008AB3 9%, ${colors['--background-subtle']})`,
  '--hl-rule': 'color-mix(in oklch, #008AB3 30%, transparent)',
  '--hl-ring': 'color-mix(in oklch, #008AB3 45%, transparent)',
  '--focus-ring': '#006A8A',
  '--selection-background': `color-mix(in oklch, #008AB3 28%, ${colors['--background']})`,
})
export const accentCyanDark = stylex.createTheme(accent, {
  '--hl': '#5AC6EC',
  '--hl-fg': '#04212E',
  '--hl-text': '#6CCFF2',
  '--hl-soft': `color-mix(in oklch, #5AC6EC 14%, ${colors['--background']})`,
  '--hl-nav': `color-mix(in oklch, #5AC6EC 16%, ${colors['--background-subtle']})`,
  '--hl-rule': 'color-mix(in oklch, #5AC6EC 30%, transparent)',
  '--hl-ring': 'color-mix(in oklch, #5AC6EC 45%, transparent)',
  '--focus-ring': '#6CCFF2',
  '--selection-background': `color-mix(in oklch, #5AC6EC 28%, ${colors['--background']})`,
})
// The original near-black. Its nav fill is the plain secondary grey, so
// nothing in the sidebar is tinted, and the focus ring stays the info blue.
export const accentInkLight = stylex.createTheme(accent, {
  '--hl': 'hsla(48, 30%, 8%, 1)',
  '--hl-fg': 'hsla(48, 20%, 95%, 1)',
  '--hl-text': 'hsla(48, 30%, 8%, 1)',
  '--hl-soft': `color-mix(in oklch, hsla(48, 30%, 8%, 1) 9%, ${colors['--background']})`,
  '--hl-nav': colors['--secondary-default'],
  '--hl-rule': 'color-mix(in oklch, hsla(48, 30%, 8%, 1) 30%, transparent)',
  '--hl-ring': 'color-mix(in oklch, hsla(48, 30%, 8%, 1) 45%, transparent)',
  '--focus-ring': '#008AB3',
  '--selection-background': `color-mix(in oklch, hsla(48, 30%, 8%, 1) 18%, ${colors['--background']})`,
})

export const accentInkDark = stylex.createTheme(accent, {
  '--hl': 'hsla(48, 30%, 90%, 1)',
  '--hl-fg': 'hsla(48, 10%, 2%, 1)',
  '--hl-text': 'hsla(48, 30%, 90%, 1)',
  '--hl-soft': `color-mix(in oklch, hsla(48, 30%, 90%, 1) 9%, ${colors['--background']})`,
  '--hl-nav': colors['--secondary-default'],
  '--hl-rule': 'color-mix(in oklch, hsla(48, 30%, 90%, 1) 30%, transparent)',
  '--hl-ring': 'color-mix(in oklch, hsla(48, 30%, 90%, 1) 45%, transparent)',
  '--focus-ring': 'hsla(200, 80%, 65%, 1)',
  '--selection-background': `color-mix(in oklch, hsla(48, 30%, 90%, 1) 18%, ${colors['--background']})`,
})

export type AccentName = 'coral' | 'ink' | 'marigold' | 'teal' | 'midnight' | 'emerald' | 'claret' | 'cyan'

export const accentNames: ReadonlyArray<AccentName> = ['coral', 'ink', 'marigold', 'teal', 'midnight', 'emerald', 'claret', 'cyan']

/** Accent name to its light and dark theme. */
export const accents: Readonly<Record<AccentName, { readonly light: stylex.Theme<typeof accent>; readonly dark: stylex.Theme<typeof accent> }>> = {
  coral: { light: accentCoralLight, dark: accentCoralDark },
  ink: { light: accentInkLight, dark: accentInkDark },
  marigold: { light: accentMarigoldLight, dark: accentMarigoldDark },
  teal: { light: accentTealLight, dark: accentTealDark },
  midnight: { light: accentMidnightLight, dark: accentMidnightDark },
  emerald: { light: accentEmeraldLight, dark: accentEmeraldDark },
  claret: { light: accentClaretLight, dark: accentClaretDark },
  cyan: { light: accentCyanLight, dark: accentCyanDark },
}
