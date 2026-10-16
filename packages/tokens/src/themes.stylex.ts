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
import { accent, accentSwatches, art, colors, density, hues, shadows, tints } from './tokens.stylex'

export const darkColors = stylex.createTheme(colors, {
  // A warm-neutral near-black (OKLCH hue 85, chroma 0.006), so dark is the
  // same paper seen at night rather than a cool system grey. Three clear
  // layers: the sidebar sits lowest (L 0.19), the page above it (0.215), and
  // cards, inputs and the composer on top (0.26); popovers go one step
  // higher again (0.33). Borders are two steps above what they sit on so
  // they still separate. Values and contrast: docs/design/tokens.md 1.2.
  '--background': '#1B1916',
  '--background-subtle': '#151411',
  '--surface-default': '#252421',
  '--surface-hover': '#2D2B28',
  '--surface-active': '#32302D',
  '--surface-raised': '#373532',

  // A step above the page (L 0.215) and under the field (0.26).
  '--panel-surface': '#201E1B',
  '--panel-bubble': '#2D2B28',

  '--secondary-default': '#302F2C',
  '--secondary-hover': '#383633',
  '--secondary-active': '#403E3B',

  '--border-subtle': '#2B2A27',
  '--border-default': '#32302D',
  '--border-strong': '#3C3A37',
  '--border-strongest': '#4C4A47',
  '--input-border': '#464541',

  '--foreground-default': '#EEEBE2',
  '--foreground-subtle': '#C6C4BE',
  '--foreground-muted': '#A09E9A',

  '--accent-default': 'hsla(48, 30%, 90%, 1)',
  '--accent-hover': 'hsla(48, 30%, 95%, 1)',
  '--accent-active': 'hsla(48, 30%, 99%, 1)',
  '--accent-foreground': 'hsla(48, 10%, 2%, 1)',
  '--accent-foreground-subtle': 'hsla(48, 10%, 5%, 1)',
  '--accent-foreground-muted': 'hsla(48, 10%, 10%, 1)',

  '--overlay': 'rgba(0, 0, 0, 0.5)',
  '--overlay-viewer': 'rgba(27, 25, 22, 0.94)',

  // The light danger red is 3.0:1 on ink; this one is 6.6:1.
  '--danger': '#F8767E',

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
  // On ink a dark ring cannot separate; a faint light edge inside does, as on macOS.
  '--panel-shadow': 'inset 0 0 0 1px oklch(1 0 0 / 0.06), 0 0 0 1px oklch(0 0 0 / 0.5), 0 1px 2px 0 oklch(0 0 0 / 0.3), 0 8px 24px -6px oklch(0 0 0 / 0.4), 0 24px 56px -12px oklch(0 0 0 / 0.5)',
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

/**
 * The resolved chip's text: 70% of the green over the light text is 4.3:1 on
 * its tint in dark, so dark takes less of it. The other tints pass as mixed.
 */
export const darkTints = stylex.createTheme(tints, {
  '--tint-resolved-fg': `color-mix(in oklch, ${colors['--success']} 52%, ${colors['--foreground-default']})`,
})

/**
 * Tiles and initials on ink. A dark hue (midnight, claret) at 24% barely
 * tints a dark surface, so the tile takes more of it; and 62% of that hue
 * over the light text is a mid tone, so the initials take less.
 */
export const darkHues = stylex.createTheme(hues, {
  '--avatar-bg-mix': '32%',
  '--avatar-fg-mix': '46%',
})


/**
 * Topic art on ink. Lines are a pale warm neutral a step below the text,
 * the soft fill and the accents sit near neutral. The Tide tones step in
 * lightness from 0.33, lifted from the study's 0.285 because the pebbles
 * read too dim on the near-black sidebar; the dark `pale` dot takes the
 * `deep` value, so it reads as a shadow where the light dot is a highlight.
 */
export const darkArt = stylex.createTheme(art, {
  '--art-coral-ink': 'oklch(0.78 0.028 32)',
  '--art-coral-soft': 'oklch(0.36 0.032 32)',
  '--art-coral-accent': 'oklch(0.72 0.085 32)',
  '--art-coral-accent2': 'oklch(0.56 0.05 32)',
  '--art-amber-ink': 'oklch(0.78 0.028 72)',
  '--art-amber-soft': 'oklch(0.36 0.032 72)',
  '--art-amber-accent': 'oklch(0.72 0.085 72)',
  '--art-amber-accent2': 'oklch(0.56 0.05 72)',
  '--art-olive-ink': 'oklch(0.78 0.028 112)',
  '--art-olive-soft': 'oklch(0.36 0.032 112)',
  '--art-olive-accent': 'oklch(0.72 0.085 112)',
  '--art-olive-accent2': 'oklch(0.56 0.05 112)',
  '--art-sage-ink': 'oklch(0.78 0.028 150)',
  '--art-sage-soft': 'oklch(0.36 0.032 150)',
  '--art-sage-accent': 'oklch(0.72 0.085 150)',
  '--art-sage-accent2': 'oklch(0.56 0.05 150)',
  '--art-teal-ink': 'oklch(0.78 0.028 185)',
  '--art-teal-soft': 'oklch(0.36 0.032 185)',
  '--art-teal-accent': 'oklch(0.72 0.085 185)',
  '--art-teal-accent2': 'oklch(0.56 0.05 185)',
  '--art-sky-ink': 'oklch(0.78 0.028 235)',
  '--art-sky-soft': 'oklch(0.36 0.032 235)',
  '--art-sky-accent': 'oklch(0.72 0.085 235)',
  '--art-sky-accent2': 'oklch(0.56 0.05 235)',
  '--art-periwinkle-ink': 'oklch(0.78 0.028 275)',
  '--art-periwinkle-soft': 'oklch(0.36 0.032 275)',
  '--art-periwinkle-accent': 'oklch(0.72 0.085 275)',
  '--art-periwinkle-accent2': 'oklch(0.56 0.05 275)',
  '--art-plum-ink': 'oklch(0.78 0.028 320)',
  '--art-plum-soft': 'oklch(0.36 0.032 320)',
  '--art-plum-accent': 'oklch(0.72 0.085 320)',
  '--art-plum-accent2': 'oklch(0.56 0.05 320)',

  '--tide-coral-base': 'oklch(0.33 0.012 32)',
  '--tide-coral-soft': 'oklch(0.37 0.017 32)',
  '--tide-coral-mid': 'oklch(0.415 0.022 32)',
  '--tide-coral-deep': 'oklch(0.48 0.026 32)',
  '--tide-coral-pale': 'oklch(0.48 0.026 32)',
  '--tide-amber-base': 'oklch(0.33 0.012 72)',
  '--tide-amber-soft': 'oklch(0.37 0.017 72)',
  '--tide-amber-mid': 'oklch(0.415 0.022 72)',
  '--tide-amber-deep': 'oklch(0.48 0.026 72)',
  '--tide-amber-pale': 'oklch(0.48 0.026 72)',
  '--tide-olive-base': 'oklch(0.33 0.012 112)',
  '--tide-olive-soft': 'oklch(0.37 0.017 112)',
  '--tide-olive-mid': 'oklch(0.415 0.022 112)',
  '--tide-olive-deep': 'oklch(0.48 0.026 112)',
  '--tide-olive-pale': 'oklch(0.48 0.026 112)',
  '--tide-sage-base': 'oklch(0.33 0.012 150)',
  '--tide-sage-soft': 'oklch(0.37 0.017 150)',
  '--tide-sage-mid': 'oklch(0.415 0.022 150)',
  '--tide-sage-deep': 'oklch(0.48 0.026 150)',
  '--tide-sage-pale': 'oklch(0.48 0.026 150)',
  '--tide-teal-base': 'oklch(0.33 0.012 185)',
  '--tide-teal-soft': 'oklch(0.37 0.017 185)',
  '--tide-teal-mid': 'oklch(0.415 0.022 185)',
  '--tide-teal-deep': 'oklch(0.48 0.026 185)',
  '--tide-teal-pale': 'oklch(0.48 0.026 185)',
  '--tide-sky-base': 'oklch(0.33 0.012 235)',
  '--tide-sky-soft': 'oklch(0.37 0.017 235)',
  '--tide-sky-mid': 'oklch(0.415 0.022 235)',
  '--tide-sky-deep': 'oklch(0.48 0.026 235)',
  '--tide-sky-pale': 'oklch(0.48 0.026 235)',
  '--tide-periwinkle-base': 'oklch(0.33 0.012 275)',
  '--tide-periwinkle-soft': 'oklch(0.37 0.017 275)',
  '--tide-periwinkle-mid': 'oklch(0.415 0.022 275)',
  '--tide-periwinkle-deep': 'oklch(0.48 0.026 275)',
  '--tide-periwinkle-pale': 'oklch(0.48 0.026 275)',
  '--tide-plum-base': 'oklch(0.33 0.012 320)',
  '--tide-plum-soft': 'oklch(0.37 0.017 320)',
  '--tide-plum-mid': 'oklch(0.415 0.022 320)',
  '--tide-plum-deep': 'oklch(0.48 0.026 320)',
  '--tide-plum-pale': 'oklch(0.48 0.026 320)',
})

/** Everything that changes in dark mode. Spread into stylex.props(). */
export const dark = [darkColors, darkShadows, darkAccentSwatches, darkTints, darkHues, darkArt] as const

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
  '--hl-bubble': `color-mix(in oklch, #CC4628 16%, ${colors['--background']})`,
  '--hl-nav': `color-mix(in oklch, #CC4628 9%, ${colors['--background-subtle']})`,
  '--hl-count': '#F7DED4',
  '--hl-count-fg': '#B3371B',
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
  '--hl-bubble': `color-mix(in oklch, #FF8A73 22%, ${colors['--background']})`,
  '--hl-nav': `color-mix(in oklch, #FF8A73 16%, ${colors['--background-subtle']})`,
  '--hl-count': '#462E26',
  '--hl-count-fg': '#F8846D',
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
  '--hl-bubble': `color-mix(in oklch, #F2A900 16%, ${colors['--background']})`,
  '--hl-nav': `color-mix(in oklch, #F2A900 11%, ${colors['--background-subtle']})`,
  '--hl-count': '#F9E1BD',
  '--hl-count-fg': '#895A00',
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
  '--hl-bubble': `color-mix(in oklch, #F5B83A 22%, ${colors['--background']})`,
  '--hl-nav': `color-mix(in oklch, #F5B83A 16%, ${colors['--background-subtle']})`,
  '--hl-count': '#43361F',
  '--hl-count-fg': '#DEA213',
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
  '--hl-bubble': `color-mix(in oklch, #0B7A75 16%, ${colors['--background']})`,
  '--hl-nav': `color-mix(in oklch, #0B7A75 9%, ${colors['--background-subtle']})`,
  '--hl-count': '#D8E4DF',
  '--hl-count-fg': '#006E69',
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
  '--hl-bubble': `color-mix(in oklch, #45C2BB 22%, ${colors['--background']})`,
  '--hl-nav': `color-mix(in oklch, #45C2BB 16%, ${colors['--background-subtle']})`,
  '--hl-count': '#253834',
  '--hl-count-fg': '#38B8B2',
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
  '--hl-bubble': `color-mix(in oklch, #2E1F64 16%, ${colors['--background']})`,
  '--hl-nav': `color-mix(in oklch, #2E1F64 9%, ${colors['--background-subtle']})`,
  '--hl-count': '#D5D4DE',
  '--hl-count-fg': '#2E1F64',
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
  '--hl-bubble': `color-mix(in oklch, #B3A5EA 22%, ${colors['--background']})`,
  '--hl-nav': `color-mix(in oklch, #B3A5EA 16%, ${colors['--background-subtle']})`,
  '--hl-count': '#36333E',
  '--hl-count-fg': '#AA9CE0',
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
  '--hl-bubble': `color-mix(in oklch, #00674F 16%, ${colors['--background']})`,
  '--hl-nav': `color-mix(in oklch, #00674F 9%, ${colors['--background-subtle']})`,
  '--hl-count': '#D5E1D8',
  '--hl-count-fg': '#00674F',
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
  '--hl-bubble': `color-mix(in oklch, #4FC4A1 22%, ${colors['--background']})`,
  '--hl-nav': `color-mix(in oklch, #4FC4A1 16%, ${colors['--background-subtle']})`,
  '--hl-count': '#26392F',
  '--hl-count-fg': '#44BA98',
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
  '--hl-bubble': `color-mix(in oklch, #7F1734 16%, ${colors['--background']})`,
  '--hl-nav': `color-mix(in oklch, #7F1734 9%, ${colors['--background-subtle']})`,
  '--hl-count': '#E9D4D3',
  '--hl-count-fg': '#7F1734',
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
  '--hl-bubble': `color-mix(in oklch, #F08BA0 22%, ${colors['--background']})`,
  '--hl-nav': `color-mix(in oklch, #F08BA0 16%, ${colors['--background-subtle']})`,
  '--hl-count': '#432E2F',
  '--hl-count-fg': '#ED889D',
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
  '--hl-bubble': `color-mix(in oklch, #008AB3 16%, ${colors['--background']})`,
  '--hl-nav': `color-mix(in oklch, #008AB3 9%, ${colors['--background-subtle']})`,
  '--hl-count': '#D7E6EA',
  '--hl-count-fg': '#006B8F',
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
  '--hl-bubble': `color-mix(in oklch, #5AC6EC 22%, ${colors['--background']})`,
  '--hl-nav': `color-mix(in oklch, #5AC6EC 16%, ${colors['--background-subtle']})`,
  '--hl-count': '#28393E',
  '--hl-count-fg': '#48B6DB',
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
  '--hl-bubble': `color-mix(in oklch, hsla(48, 30%, 8%, 1) 12%, ${colors['--background']})`,
  '--hl-nav': colors['--secondary-default'],
  '--hl-count': '#D2D0CB',
  '--hl-count-fg': '#1B180E',
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
  '--hl-bubble': `color-mix(in oklch, hsla(48, 30%, 90%, 1) 14%, ${colors['--background']})`,
  '--hl-nav': colors['--secondary-default'],
  '--hl-count': '#41403B',
  '--hl-count-fg': '#B9B6AB',
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

/** Compact density (inventory 3.3): less padding, a 36px tile, tighter message groups. */
export const compact = stylex.createTheme(density, {
  '--density-row-padding-block': '8px',
  '--density-row-line-gap': '0px',
  '--density-row-tile-zoom': '0.8182',
  '--density-row-estimate': '64px',
  '--density-message-padding-block': '2px',
  '--density-message-group-gap': '6px',
})
