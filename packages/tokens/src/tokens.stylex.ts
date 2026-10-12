/**
 * Juno design tokens.
 *
 * Light-theme values come from docs/design/handoff/prototype/colors_and_type.css
 * (the Littlebird product tokens). The dark theme lives in themes.stylex.ts.
 *
 * Every key starts with `--`, so StyleX emits a CSS variable with exactly that
 * name (for example `--background`). That keeps the variables readable in
 * devtools, usable from plain CSS as `var(--background)`, and stable for tests.
 *
 * This file must keep the `.stylex.ts` suffix and be imported through the
 * `@juno/tokens/tokens.stylex` subpath. StyleX refuses to resolve variables
 * through a barrel file.
 */
import * as stylex from '@stylexjs/stylex'

export const colors = stylex.defineVars({
  // Backgrounds and surfaces. Warm paper.
  '--background': 'hsla(48, 50%, 98%, 1)',
  '--background-subtle': 'hsla(48, 35%, 97%, 1)',
  '--surface-default': 'hsla(48, 30%, 98%, 1)',
  '--surface-hover': 'hsla(48, 30%, 94%, 1)',
  '--surface-active': 'hsla(48, 30%, 92%, 1)',

  '--secondary-default': 'hsla(48, 30%, 92%, 1)',
  '--secondary-hover': 'hsla(48, 30%, 90%, 1)',
  '--secondary-active': 'hsla(48, 30%, 88%, 1)',

  // Borders. Nearly invisible.
  '--border-subtle': 'hsla(48, 30%, 92%, 1)',
  '--border-default': 'hsla(48, 30%, 91%, 1)',
  '--border-strong': 'hsla(48, 30%, 88%, 1)',
  '--border-strongest': 'hsla(48, 30%, 82%, 1)',

  // Foreground. Warm neutrals, never pure black.
  '--foreground-default': 'hsla(48, 15%, 12%, 1)',
  '--foreground-subtle': 'hsla(48, 8%, 35%, 1)',
  '--foreground-muted': 'hsla(48, 4%, 52%, 1)',

  // Accent. Near-black on light.
  '--accent-default': 'hsla(48, 30%, 8%, 1)',
  '--accent-hover': 'hsla(48, 30%, 10%, 1)',
  '--accent-active': 'hsla(48, 30%, 13%, 1)',
  '--accent-foreground': 'hsla(48, 20%, 95%, 1)',
  '--accent-foreground-subtle': 'hsla(48, 20%, 90%, 1)',
  '--accent-foreground-muted': 'hsla(48, 20%, 70%, 1)',

  // Focus and selection.
  '--selection-background': 'hsla(200, 50%, 80%, 1)',

  // Status.
  '--danger': '#C41E3A',
  '--success': '#00674F',
  '--warning': '#E0A500',
  '--info': '#008AB3',
})

export const shadows = stylex.defineVars({
  '--shadow-sm': '0 1px 2px 0 rgba(27, 28, 21, 0.04)',
  '--shadow-md': '0 2px 6px 0 rgba(27, 28, 21, 0.06)',
  '--shadow-card': '0 0 12px 0 rgba(27, 28, 21, 0.12)',
  '--shadow-lg': '0 8px 24px 0 rgba(27, 28, 21, 0.10)',
})

export const radii = stylex.defineVars({
  '--radius-sm': '0.25rem',
  '--radius-md': '0.375rem',
  '--radius-lg': '0.5rem',
  '--radius-xl': '0.625rem',
})

export const spacing = stylex.defineVars({
  '--space-1': '0.25rem',
  '--space-2': '0.5rem',
  '--space-3': '0.75rem',
  '--space-4': '1rem',
  '--space-5': '1.25rem',
  '--space-6': '1.5rem',
  '--space-8': '2rem',
  '--space-10': '2.5rem',
  '--space-12': '3rem',
  '--space-16': '4rem',
  '--space-24': '6rem',
})

export const fonts = stylex.defineVars({
  // Inter stands in for Söhne and Instrument Serif for Meraki. Both are
  // bundled from @fontsource (OFL) by the app. Never load fonts remotely.
  '--font-sans': "'Inter Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  '--font-serif': "'Instrument Serif', ui-serif, 'Iowan Old Style', Georgia, serif",
  '--font-mono': "ui-monospace, 'SF Mono', Menlo, monospace",
})

export const type = stylex.defineVars({
  '--text-xs': '0.75rem',
  '--text-sm': '0.875rem',
  '--text-sm-plus': '0.9375rem',
  '--text-base': '1rem',
  '--text-md': '1.0625rem',
  '--text-lg': '1.125rem',
  '--text-xl': '1.25rem',
  '--text-2xl': '1.5rem',
  '--text-3xl': '1.875rem',
  '--text-4xl': '2.25rem',
  '--text-5xl': '3rem',
  '--text-6xl': '4rem',

  '--tracking-tight': '-0.01em',
  '--tracking-normal': '0.02em',
  '--tracking-wide': '0.06em',

  '--leading-tight': '1.2',
  '--leading-snug': '1.4',
  '--leading-normal': '1.6',
  '--leading-relaxed': '1.75',
})

export const motion = stylex.defineVars({
  // Instant feedback: at most 150ms on background colour for hover and press.
  '--duration-fast': '150ms',
  '--duration-normal': '200ms',
  '--duration-slow': '300ms',
  '--ease-standard': 'cubic-bezier(0.2, 0, 0, 1)',
  '--ease-out': 'cubic-bezier(0, 0, 0.2, 1)',
})

export const layout = stylex.defineVars({
  // Height of the window drag strip at the top. The macOS traffic lights are
  // positioned by the main process to sit centred in this strip.
  '--titlebar-height': '44px',
  '--sidebar-width': '384px',
  '--reading-width': '800px',
})
