/**
 * The names the renderer writes. Values live in `@juno/tokens` as CSS
 * variables (`--art-<hue>-<role>`, `--tide-<hue>-<tone>`), tuned per theme,
 * so one SVG string serves light and dark and a theme switch repaints
 * through CSS. The hue angles are the design study's (`docs/design/topic-art/v2/palette.mjs`).
 */
export const HUES = {
  coral: 32,
  amber: 72,
  olive: 112,
  sage: 150,
  teal: 185,
  sky: 235,
  periwinkle: 275,
  plum: 320,
} as const

export type HueName = keyof typeof HUES
export const HUE_NAMES = Object.keys(HUES) as ReadonlyArray<HueName>

export const isHueName = (value: string): value is HueName => Object.hasOwn(HUES, value)

/** The colour roles a recipe may name. `none` is no paint. */
export const ROLES = ['ink', 'soft', 'accent', 'accent2', 'none'] as const
export type Role = (typeof ROLES)[number]

/** The CSS variable for a role of a hue, as `@juno/tokens` declares it. */
export function artVar(hue: HueName, role: Exclude<Role, 'none'>): string {
  return `var(--art-${hue}-${role})`
}

/** The Tide tones of the placeholder, as `@juno/tokens` declares them. */
export const TIDE_TONES = ['base', 'soft', 'mid', 'deep', 'pale'] as const
export type TideTone = (typeof TIDE_TONES)[number]

export function tideVar(hue: HueName, tone: TideTone): string {
  return `var(--tide-${hue}-${tone})`
}
